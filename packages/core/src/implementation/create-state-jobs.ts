import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import {
  BlockerLimitExceededError,
  ChainNotFoundError,
  ChainTypeMismatchError,
  InvalidJobIdError,
  JobNotFoundError,
} from "../errors.js";
import { bufferNotifyJobScheduled } from "../notify-adapter/notify-hooks.js";
import { type ObservabilityHelper } from "../observability-adapter/observability-helper.js";
import {
  bufferObservabilityEvent,
  bufferObservabilityRollback,
} from "../observability-adapter/observability-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import {
  type BaseTxContext,
  type StateChain,
  type StateAttemptFence,
  type StateChainInfo,
  type StateJob,
  type StateJobInfo,
} from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";

type CommonInput = {
  id?: string;
  typeName: string;
  input: unknown;
  blockers?: { id: string; typeName?: string }[];
  schedule?: ScheduleOptions;
};

type PreparedEntry = {
  id: string;
  typeName: string;
  input: unknown;
  blockers: { id: string; typeName?: string }[];
  parsedInput: unknown;
};

type ParsedEntry = Omit<PreparedEntry, "blockers"> & { blockers: StateChain[] };

type JobSpanHandle = ReturnType<ObservabilityHelper["startJobSpan"]>;
type BlockerSpanHandle = ReturnType<ObservabilityHelper["startBlockerSpan"]>;

type CreatedJob = {
  job: StateJobInfo;
  chain: StateChainInfo;
  deduplicated: boolean;
  blockerChains: StateChainInfo[];
  blockerSpanHandles: BlockerSpanHandle[];
};

const assertBlockerLimit = (helpers: Helpers, typeName: string, blockerCount: number): void => {
  const limit = helpers.stateAdapter.config.maxBlockersPerJob;
  if (blockerCount > limit) {
    throw new BlockerLimitExceededError(
      `Job "${typeName}" declares ${blockerCount} blockers, exceeding the limit of ${limit}`,
      { typeName, count: blockerCount, limit },
    );
  }
};

const resolveJobId = (helpers: Helpers, id: string | undefined): string => {
  const { generateId, validateId } = helpers.stateAdapter.config;
  const source = id === undefined ? "generator" : "caller";
  const resolvedId = id ?? generateId();
  if (!validateId(resolvedId)) {
    throw new InvalidJobIdError(
      `Invalid job ID "${resolvedId}" from ${source} — failed validateId predicate`,
      { id: resolvedId, source },
    );
  }
  return resolvedId;
};

const prepareJobs = <TEntry extends CommonInput>(
  helpers: Helpers,
  entries: TEntry[],
  startSpan: (entry: TEntry, index: number) => JobSpanHandle,
): { prepared: PreparedEntry[]; spanHandles: JobSpanHandle[] } => {
  const prepared: PreparedEntry[] = entries.map((entry) => {
    const blockers = entry.blockers ?? [];
    assertBlockerLimit(helpers, entry.typeName, blockers.length);
    return {
      id: resolveJobId(helpers, entry.id),
      typeName: entry.typeName,
      input: entry.input,
      blockers,
      parsedInput: helpers.jobTypes.parseInput(entry.typeName, entry.input),
    };
  });

  const spanHandles = entries.map(startSpan);

  return { prepared, spanHandles };
};

// Blockers are validated against the stored chains, read under lock, so a caller-built
// `{ id, typeName }` (or a stale chain object) is never trusted for type or input.
const lockBlockerChains = async (
  helpers: Helpers,
  { prepared, txCtx }: { prepared: PreparedEntry[]; txCtx: BaseTxContext },
): Promise<ParsedEntry[]> => {
  const blockerChainIds = prepared.flatMap((entry) => entry.blockers.map((blocker) => blocker.id));
  const blockerChains =
    blockerChainIds.length > 0
      ? await helpers.stateAdapter.getChains({
          txCtx,
          chainIds: blockerChainIds,
          lock: "exclusive",
        })
      : [];

  let blockerChainIndex = 0;
  return prepared.map((entry) => {
    const blockers = entry.blockers.map((blocker) => {
      const blockerChain = blockerChains[blockerChainIndex++];
      if (!blockerChain) {
        throw new ChainNotFoundError(`Chain with id ${blocker.id} not found`, {
          chainId: blocker.id,
        });
      }
      if (blocker.typeName !== undefined && blocker.typeName !== blockerChain.typeName) {
        throw new ChainTypeMismatchError(
          `Expected blocker chain ${blocker.id} to have type "${blocker.typeName}" but found "${blockerChain.typeName}"`,
          { expectedTypeName: blocker.typeName, actualTypeName: blockerChain.typeName },
        );
      }
      return blockerChain;
    });
    helpers.jobTypes.validateBlockers(
      entry.typeName,
      blockers.map((blocker) => ({ typeName: blocker.typeName, input: blocker.head.input })),
    );
    return { ...entry, blockers };
  });
};

const addJobsBlockers = async (
  helpers: Helpers,
  {
    parsed,
    spanHandles,
    insertedJobs,
    txCtx,
  }: {
    parsed: ParsedEntry[];
    spanHandles: JobSpanHandle[];
    insertedJobs: { job: StateJobInfo; chain: StateChainInfo; deduplicated: boolean }[];
    txCtx: BaseTxContext;
  },
): Promise<CreatedJob[]> => {
  const createdJobs: CreatedJob[] = insertedJobs.map((insertedJob) => ({
    ...insertedJob,
    blockerChains: [],
    blockerSpanHandles: [],
  }));
  const blockedIndices = createdJobs.flatMap((createdJob, index) =>
    !createdJob.deduplicated && parsed[index].blockers.length > 0 ? [index] : [],
  );
  if (blockedIndices.length === 0) return createdJobs;

  for (const index of blockedIndices) {
    const { job, chain } = createdJobs[index];
    const jobSpanHandle = spanHandles[index];
    if (!jobSpanHandle) continue;
    createdJobs[index].blockerSpanHandles = parsed[index].blockers.map((blocker, blockerIndex) =>
      helpers.observabilityHelper.startBlockerSpan({
        chainId: chain.id,
        chainTypeName: chain.typeName,
        jobId: job.id,
        jobTypeName: job.typeName,
        jobTraceContext: jobSpanHandle.getTraceContext(),
        blockerChainId: blocker.id,
        blockerChainTypeName: blocker.typeName,
        blockerIndex,
      }),
    );
  }

  const blockerResults = await helpers.stateAdapter.addJobsBlockers({
    txCtx,
    jobBlockers: blockedIndices.map((index) => ({
      jobId: createdJobs[index].job.id,
      blockedByChainIds: parsed[index].blockers.map((blocker) => blocker.id),
      blockerTraceContexts: createdJobs[index].blockerSpanHandles.map(
        (blockerSpanHandle) => blockerSpanHandle?.getTraceContext() ?? null,
      ),
    })),
  });

  blockedIndices.forEach((index, resultIndex) => {
    const { chain: _chain, blockers, ...job } = blockerResults[resultIndex];
    createdJobs[index].job = job;
    createdJobs[index].blockerChains = blockers.map((blockerChain, blockerIndex) => {
      if (!blockerChain) {
        const chainId = parsed[index].blockers[blockerIndex].id;
        throw new ChainNotFoundError(`Chain with id ${chainId} not found`, { chainId });
      }
      return blockerChain;
    });
  });

  return createdJobs;
};

const finalizeCreatedJobs = (
  helpers: Helpers,
  {
    parsed,
    spanHandles,
    createdJobs,
    isChainHead,
    transactionHooks,
  }: {
    parsed: ParsedEntry[];
    spanHandles: JobSpanHandle[];
    createdJobs: CreatedJob[];
    isChainHead: boolean;
    transactionHooks: TransactionHooks;
  },
): void => {
  createdJobs.forEach(({ job, chain, deduplicated }, index) => {
    if (!deduplicated) return;
    spanHandles[index]?.end({
      status: "deduplicated",
      chainId: chain.id,
      jobId: job.id,
      existingChainTraceContext: chain.traceContext,
    });
  });

  createdJobs.forEach(({ blockerChains, blockerSpanHandles }, index) => {
    blockerSpanHandles.forEach((blockerSpanHandle, blockerIndex) => {
      if (!blockerSpanHandle) return;
      const blockerChain = blockerChains[blockerIndex];
      bufferObservabilityEvent(transactionHooks, () => {
        blockerSpanHandle.end({ blockerChainTraceContext: blockerChain.traceContext });
      });
      if (blockerChain.completedAt !== null) {
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.completeBlockerSpan({
            traceContext: blockerSpanHandle.getTraceContext(),
            blockerChainTypeName: parsed[index].blockers[blockerIndex].typeName,
          });
        });
      }
    });
  });

  createdJobs.forEach(({ job, chain, deduplicated, blockerChains }, index) => {
    if (deduplicated) return;
    const jobInput = parsed[index];
    const spanHandle = spanHandles[index];

    bufferObservabilityEvent(transactionHooks, () =>
      spanHandle?.end({ status: "created", chainId: chain.id, jobId: job.id }),
    );

    if (spanHandle) {
      bufferObservabilityRollback(transactionHooks, () => {
        spanHandle.end({ status: "error", error: new Error("savepoint rolled back") });
      });
    }

    if (isChainHead) {
      bufferObservabilityEvent(transactionHooks, () => {
        helpers.observabilityHelper.chainCreated(chain, { input: jobInput.input });
      });
    }

    const stateJob: StateJob = { ...job, chain };
    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.jobCreated(stateJob, {
        input: jobInput.input,
        blockers: jobInput.blockers,
      });
    });

    const incompleteBlockerChainIds = new Set(
      blockerChains
        .filter((blockerChain) => blockerChain.completedAt === null)
        .map((blockerChain) => blockerChain.id),
    );
    if (incompleteBlockerChainIds.size > 0) {
      const incompleteBlockerChains = jobInput.blockers.filter((blocker) =>
        incompleteBlockerChainIds.has(blocker.id),
      );
      bufferObservabilityEvent(transactionHooks, () => {
        helpers.observabilityHelper.jobBlocked(stateJob, {
          blockedByChains: incompleteBlockerChains,
        });
      });
    } else {
      bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, stateJob);
    }
  });
};

export const createStateChains = async (
  helpers: Helpers,
  {
    chains,
    txCtx,
    transactionHooks,
  }: {
    chains: (CommonInput & {
      deduplication?: DeduplicationOptions;
    })[];
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
  },
): Promise<(StateChain & { deduplicated: boolean })[]> => {
  if (chains.length === 0) return [];

  for (const chain of chains) {
    const scope: unknown = chain.deduplication?.scope;
    if (chain.deduplication != null && scope !== "running" && scope !== "any") {
      throw new TypeError(
        `Invalid deduplication scope ${JSON.stringify(scope)}: expected "running" or "any" ("incomplete" was renamed to "running")`,
      );
    }
  }

  const { prepared, spanHandles } = prepareJobs(helpers, chains, (entry) =>
    helpers.observabilityHelper.startJobSpan({
      chainTypeName: entry.typeName,
      jobTypeName: entry.typeName,
      isChainHead: true,
    }),
  );

  let parsed: ParsedEntry[];
  let createResults: (StateChain & { deduplicated: boolean })[];
  let createdJobs: CreatedJob[];
  try {
    parsed = await lockBlockerChains(helpers, { prepared, txCtx });
    createResults = await helpers.stateAdapter.createJobs({
      txCtx,
      jobs: chains.map((chain, index) => ({
        id: parsed[index].id,
        typeName: chain.typeName,
        input: parsed[index].parsedInput,
        schedule: chain.schedule,
        chainTraceContext: spanHandles[index]?.getChainTraceContext() ?? null,
        traceContext: spanHandles[index]?.getTraceContext() ?? null,
        deduplication: chain.deduplication,
      })),
    });
    createdJobs = await addJobsBlockers(helpers, {
      parsed,
      spanHandles,
      insertedJobs: createResults.map(({ head, tail: _tail, deduplicated, ...chain }) => ({
        job: head,
        chain,
        deduplicated,
      })),
      txCtx,
    });
  } catch (error) {
    for (const spanHandle of spanHandles) {
      spanHandle?.end({ status: "error", error });
    }
    throw error;
  }

  finalizeCreatedJobs(helpers, {
    parsed,
    spanHandles,
    createdJobs,
    isChainHead: true,
    transactionHooks,
  });

  return createResults.map((createResult, index) => ({
    ...createResult,
    head: createdJobs[index].job,
  }));
};

export const continueStateJob = async (
  helpers: Helpers,
  {
    job,
    fromJob,
    fence,
    txCtx,
    transactionHooks,
  }: {
    job: CommonInput;
    fromJob: StateJob;
    fence: StateAttemptFence | null;
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
  },
): Promise<{ completedJob: StateJob; continuation: StateJobInfo }> => {
  const { prepared, spanHandles } = prepareJobs(helpers, [job], () =>
    helpers.observabilityHelper.startJobSpan({
      chainTypeName: fromJob.chain.typeName,
      jobTypeName: job.typeName,
      isChainHead: false,
      originChainTraceContext: fromJob.chain.traceContext,
      originTraceContext: fromJob.traceContext,
    }),
  );

  let parsed: ParsedEntry[];
  let completedJob: StateJob;
  let createdJobs: CreatedJob[];
  try {
    parsed = await lockBlockerChains(helpers, { prepared, txCtx });
    const [continued] = await helpers.stateAdapter.continueJobs({
      txCtx,
      jobs: [
        {
          id: parsed[0].id,
          typeName: job.typeName,
          input: parsed[0].parsedInput,
          schedule: job.schedule,
          traceContext: spanHandles[0]?.getTraceContext() ?? null,
          continueFromId: fromJob.id,
          fence: fence ?? undefined,
        },
      ],
    });
    if (!continued) {
      throw new JobNotFoundError(`Job ${fromJob.id} not found or already completed`, {
        jobId: fromJob.id,
      });
    }
    const { continuation, ...completedJobFields } = continued;
    completedJob = completedJobFields;

    createdJobs = await addJobsBlockers(helpers, {
      parsed,
      spanHandles,
      insertedJobs: [{ job: continuation, chain: completedJob.chain, deduplicated: false }],
      txCtx,
    });
  } catch (error) {
    for (const spanHandle of spanHandles) {
      spanHandle?.end({ status: "error", error });
    }
    throw error;
  }

  finalizeCreatedJobs(helpers, {
    parsed,
    spanHandles,
    createdJobs,
    isChainHead: false,
    transactionHooks,
  });

  return { completedJob, continuation: createdJobs[0].job };
};
