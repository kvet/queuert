import { type Chain, mapStateChainToChain } from "./entities/chain.js";
import { type DeduplicationOptions } from "./entities/deduplication.js";
import { type ScheduleOptions } from "./entities/schedule.js";
import {
  BlockerLimitExceededError,
  ChainNotFoundError,
  ChainTypeMismatchError,
  InvalidJobIdError,
  JobNotFoundError,
} from "./errors.js";
import {
  bufferNotifyChainCompletion,
  bufferNotifyJobScheduled,
} from "./notify-adapter/notify-hooks.js";
import { type ObservabilityHelper } from "./observability-adapter/observability-helper.js";
import {
  bufferObservabilityEvent,
  bufferObservabilityRollback,
} from "./observability-adapter/observability-hooks.js";
import { type Helpers } from "./setup-helpers.js";
import {
  type BaseTxContext,
  type StateAttemptFence,
  type StateChain,
  type StateChainInfo,
  type StateJob,
  type StateJobInfo,
} from "./state-adapter/state-adapter.js";
import { type TransactionHooks } from "./transaction-hooks.js";

type CommonInput = {
  id?: string;
  typeName: string;
  input: unknown;
  blockers?: { id: string; typeName?: string }[];
  schedule?: ScheduleOptions;
};

type JobSpanHandle = ReturnType<ObservabilityHelper["startJobSpan"]>;
type BlockerSpanHandle = ReturnType<ObservabilityHelper["startBlockerSpan"]>;
type BlockerSpan = { blockerChain: StateChain; blockerSpan: BlockerSpanHandle };

type CreatedJob = {
  entry: CommonInput;
  job: StateJobInfo;
  chain: StateChainInfo;
  deduplicated: boolean;
  jobSpan: JobSpanHandle;
  blockerChains: StateChain[];
};

const endJobSpansWithError = (items: { jobSpan: JobSpanHandle }[], error: unknown): void => {
  for (const { jobSpan } of items) {
    jobSpan?.end({ status: "error", error });
  }
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

// Every entry is validated before any span starts, so a rejected entry leaves no span open.
const prepareJobs = <TEntry extends CommonInput>(
  helpers: Helpers,
  entries: TEntry[],
  origin: { isChainHead: true } | { isChainHead: false; fromJob: StateJob },
): { entry: TEntry; id: string; parsedInput: unknown; jobSpan: JobSpanHandle }[] => {
  const prepared = entries.map((entry) => {
    assertBlockerLimit(helpers, entry.typeName, entry.blockers?.length ?? 0);
    return {
      entry,
      id: resolveJobId(helpers, entry.id),
      parsedInput: helpers.jobTypes.parseInput(entry.typeName, entry.input),
    };
  });

  return prepared.map((item) => ({
    ...item,
    jobSpan: helpers.observabilityHelper.startJobSpan(
      origin.isChainHead
        ? {
            chainTypeName: item.entry.typeName,
            jobTypeName: item.entry.typeName,
            isChainHead: true,
          }
        : {
            chainTypeName: origin.fromJob.chain.typeName,
            jobTypeName: item.entry.typeName,
            isChainHead: false,
            originChainTraceContext: origin.fromJob.chain.traceContext,
            originTraceContext: origin.fromJob.traceContext,
          },
    ),
  }));
};

const requireBlockerChain = (
  blocker: { id: string; typeName?: string },
  blockerChain: StateChain | undefined,
): StateChain => {
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
};

// Blockers are validated against the stored chains, read under lock, so a caller-built
// `{ id, typeName }` (or a stale chain object) is never trusted for type or input.
const lockBlockerChains = async <TItem extends { entry: CommonInput }>(
  helpers: Helpers,
  { items, txCtx }: { items: TItem[]; txCtx: BaseTxContext },
): Promise<(TItem & { blockerChains: StateChain[] })[]> => {
  const blockerChainIds = items.flatMap((item) =>
    (item.entry.blockers ?? []).map((blocker) => blocker.id),
  );
  const blockerChains =
    blockerChainIds.length > 0
      ? await helpers.stateAdapter.getChains({
          txCtx,
          chainIds: blockerChainIds,
          lock: "exclusive",
        })
      : [];

  // `getChains` answers in request order, so each job takes its blockers' chains off the front.
  const fetched = blockerChains.values();
  return items.map((item) => {
    const jobBlockerChains = (item.entry.blockers ?? []).map((blocker) =>
      requireBlockerChain(blocker, fetched.next().value),
    );
    helpers.jobTypes.validateBlockers(
      item.entry.typeName,
      jobBlockerChains.map((blockerChain) => ({
        typeName: blockerChain.typeName,
        input: blockerChain.head.input,
      })),
    );
    return { ...item, blockerChains: jobBlockerChains };
  });
};

const addJobsBlockers = async <TItem extends CreatedJob>(
  helpers: Helpers,
  { items, txCtx }: { items: TItem[]; txCtx: BaseTxContext },
): Promise<(TItem & { blockerSpans: BlockerSpan[] })[]> => {
  const isBlocked = (item: TItem) => !item.deduplicated && item.blockerChains.length > 0;

  const itemsWithBlockerSpans = items.map((item) => {
    const { jobSpan } = item;
    return {
      ...item,
      blockerSpans:
        isBlocked(item) && jobSpan
          ? item.blockerChains.map((blockerChain, blockerIndex) => ({
              blockerChain,
              blockerSpan: helpers.observabilityHelper.startBlockerSpan({
                chainId: item.chain.id,
                chainTypeName: item.chain.typeName,
                jobId: item.job.id,
                jobTypeName: item.job.typeName,
                jobTraceContext: jobSpan.getTraceContext(),
                blockerChainId: blockerChain.id,
                blockerChainTypeName: blockerChain.typeName,
                blockerIndex,
              }),
            }))
          : [],
    };
  });

  const blockedItems = itemsWithBlockerSpans.filter(isBlocked);
  if (blockedItems.length === 0) return itemsWithBlockerSpans;

  const updatedRows = await helpers.stateAdapter.addJobsBlockers({
    txCtx,
    jobBlockers: blockedItems.map((item) => ({
      jobId: item.job.id,
      blockedByChainIds: item.blockerChains.map((blockerChain) => blockerChain.id),
      blockerTraceContexts: item.blockerSpans.map(
        ({ blockerSpan }) => blockerSpan?.getTraceContext() ?? null,
      ),
    })),
  });

  // `addJobsBlockers` answers in request order, so each blocked job takes the next row. Rows are
  // matched by position, not by id, because an adapter may normalize the id it returns.
  const rows = updatedRows.values();
  return itemsWithBlockerSpans.map((item) => {
    const updatedRow = isBlocked(item) ? rows.next().value : undefined;
    if (updatedRow === undefined) return item;
    const { chain: _chain, blockers: _blockers, ...updatedJob } = updatedRow;
    return { ...item, job: updatedJob };
  });
};

const reportCreatedJobs = (
  helpers: Helpers,
  items: (CreatedJob & { blockerSpans: BlockerSpan[] })[],
  { isChainHead, transactionHooks }: { isChainHead: boolean; transactionHooks: TransactionHooks },
): void => {
  // Two loops keep the order a batch flushes in: every job's blocker spans end before any job's
  // creation is reported.
  for (const { job, chain, deduplicated, jobSpan, blockerSpans } of items) {
    if (deduplicated) {
      jobSpan?.end({
        status: "deduplicated",
        chainId: chain.id,
        jobId: job.id,
        existingChainTraceContext: chain.traceContext,
      });
    }
    for (const { blockerChain, blockerSpan } of blockerSpans) {
      if (!blockerSpan) continue;
      bufferObservabilityEvent(transactionHooks, () => {
        blockerSpan.end({ blockerChainTraceContext: blockerChain.traceContext });
      });
      if (blockerChain.completedAt !== null) {
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.completeBlockerSpan({
            traceContext: blockerSpan.getTraceContext(),
            blockerChainTypeName: blockerChain.typeName,
          });
        });
      }
    }
  }

  for (const { entry, job, chain, deduplicated, jobSpan, blockerChains } of items) {
    if (deduplicated) continue;

    bufferObservabilityEvent(transactionHooks, () =>
      jobSpan?.end({ status: "created", chainId: chain.id, jobId: job.id }),
    );
    if (jobSpan) {
      bufferObservabilityRollback(transactionHooks, () => {
        jobSpan.end({ status: "error", error: new Error("savepoint rolled back") });
      });
    }

    if (isChainHead) {
      bufferObservabilityEvent(transactionHooks, () => {
        helpers.observabilityHelper.chainCreated(chain, { input: entry.input });
      });
    }

    const stateJob: StateJob = { ...job, chain };
    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.jobCreated(stateJob, {
        input: entry.input,
        blockers: blockerChains,
      });
    });

    const incompleteBlockerChains = blockerChains.filter(
      (blockerChain) => blockerChain.completedAt === null,
    );
    if (incompleteBlockerChains.length > 0) {
      bufferObservabilityEvent(transactionHooks, () => {
        helpers.observabilityHelper.jobBlocked(stateJob, {
          blockedByChains: incompleteBlockerChains,
        });
      });
    } else {
      bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, stateJob);
    }
  }
};

const createStateChains = async (
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

  const prepared = prepareJobs(helpers, chains, { isChainHead: true });
  let created: (CreatedJob & {
    createdChain: StateChain & { deduplicated: boolean };
    blockerSpans: BlockerSpan[];
  })[];
  try {
    const locked = await lockBlockerChains(helpers, { items: prepared, txCtx });
    const createdChains = await helpers.stateAdapter.createJobs({
      txCtx,
      jobs: locked.map((item) => ({
        id: item.id,
        typeName: item.entry.typeName,
        input: item.parsedInput,
        schedule: item.entry.schedule,
        chainTraceContext: item.jobSpan?.getChainTraceContext() ?? null,
        traceContext: item.jobSpan?.getTraceContext() ?? null,
        deduplication: item.entry.deduplication,
      })),
    });
    // `createJobs` returns rows in request order.
    created = await addJobsBlockers(helpers, {
      txCtx,
      items: locked.map((item, index) => {
        const createdChain = createdChains[index];
        const { head, tail: _tail, deduplicated, ...chain } = createdChain;
        return { ...item, job: head, chain, deduplicated, createdChain };
      }),
    });
  } catch (error) {
    endJobSpansWithError(prepared, error);
    throw error;
  }

  reportCreatedJobs(helpers, created, { isChainHead: true, transactionHooks });

  return created.map(({ createdChain, job }) => ({ ...createdChain, head: job }));
};

const continueStateJob = async (
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
): Promise<(StateJob & { continuation: StateJobInfo }) | undefined> => {
  const prepared = prepareJobs(helpers, [job], { isChainHead: false, fromJob });
  let created: (CreatedJob & { completedJob: StateJob; blockerSpans: BlockerSpan[] })[];
  try {
    const locked = await lockBlockerChains(helpers, { items: prepared, txCtx });
    const [continued] = await helpers.stateAdapter.continueJobs({
      txCtx,
      jobs: locked.map((item) => ({
        id: item.id,
        typeName: item.entry.typeName,
        input: item.parsedInput,
        schedule: item.entry.schedule,
        traceContext: item.jobSpan?.getTraceContext() ?? null,
        continueFromId: fromJob.id,
        fence: fence ?? undefined,
      })),
    });
    if (!continued) {
      const error = new JobNotFoundError(`Job ${fromJob.id} not found or already completed`, {
        jobId: fromJob.id,
      });
      endJobSpansWithError(prepared, error);
      return undefined;
    }
    const { continuation, ...completedJob } = continued;
    created = await addJobsBlockers(helpers, {
      txCtx,
      items: locked.map((item) => ({
        ...item,
        job: continuation,
        chain: completedJob.chain,
        deduplicated: false,
        completedJob,
      })),
    });
  } catch (error) {
    endJobSpansWithError(prepared, error);
    throw error;
  }

  reportCreatedJobs(helpers, created, { isChainHead: false, transactionHooks });

  const [{ completedJob, job: continuation }] = created;
  return { ...completedJob, continuation };
};

type ChainInput = {
  typeName: string;
  id?: string;
  input: unknown;
  blockers?: { id: string; typeName?: string }[];
  deduplication?: DeduplicationOptions;
  schedule?: ScheduleOptions;
};

export const createChains = async (
  helpers: Helpers,
  {
    chains,
    txCtx,
    transactionHooks,
  }: {
    chains: ChainInput[];
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
  },
): Promise<(Chain<string, string, unknown, unknown> & { deduplicated: boolean })[]> => {
  if (chains.length === 0) return [];

  for (const chain of chains) {
    helpers.jobTypes.validateEntry(chain.typeName);
  }

  const results = await createStateChains(helpers, {
    chains: chains.map((chain) => ({
      typeName: chain.typeName,
      id: chain.id,
      input: chain.input,
      blockers: chain.blockers,
      deduplication: chain.deduplication,
      schedule: chain.schedule,
    })),
    txCtx,
    transactionHooks,
  });

  return results.map((r) => ({
    ...mapStateChainToChain(r),
    deduplicated: r.deduplicated,
  }));
};

export type AnyContinueWith = {
  typeName: string;
  id?: string;
  input: unknown;
  schedule?: ScheduleOptions;
  blockers?: { id: string; typeName?: string }[];
};

const bufferJobCompletedEvents = (
  helpers: Helpers,
  {
    completedJob,
    output,
    continuation,
    transactionHooks,
  }: {
    completedJob: StateJob;
    output: unknown;
    continuation: StateJobInfo | null;
    transactionHooks: TransactionHooks;
  },
): void => {
  bufferObservabilityEvent(transactionHooks, () => {
    helpers.observabilityHelper.jobCompleted(completedJob, {
      output,
      continuedWith: continuation ?? undefined,
    });
    helpers.observabilityHelper.jobDuration(completedJob);
  });
};

const completeChain = async (
  helpers: Helpers,
  {
    job,
    output,
    txCtx,
    transactionHooks,
    fence,
  }: {
    job: StateJob;
    output: unknown;
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
    fence: StateAttemptFence | null;
  },
): Promise<StateJob | undefined> => {
  const parsedOutput = helpers.jobTypes.parseOutput(job.typeName, output);

  const [completed] = await helpers.stateAdapter.completeJobs({
    txCtx,
    jobs: [{ jobId: job.id, output: parsedOutput, fence: fence ?? undefined }],
  });
  if (!completed) return undefined;
  const { chain } = completed;

  bufferJobCompletedEvents(helpers, {
    completedJob: completed,
    output: parsedOutput,
    continuation: null,
    transactionHooks,
  });
  bufferObservabilityEvent(transactionHooks, () => {
    helpers.observabilityHelper.chainCompleted(chain, { output: parsedOutput });
    helpers.observabilityHelper.chainDuration(chain);
  });
  bufferNotifyChainCompletion(transactionHooks, helpers.notifyAdapter, completed);

  const dependentJobs = await helpers.stateAdapter.unblockJobs({
    txCtx,
    blockedByChainId: chain.id,
  });

  for (const dependentJob of dependentJobs) {
    if (dependentJob.traceContext === null) continue;
    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.completeBlockerSpan({
        traceContext: dependentJob.traceContext!,
        blockerChainTypeName: chain.typeName,
      });
    });
  }

  const unblockedJobs = new Map<string, StateJob>();
  for (const dependentJob of dependentJobs) {
    if (dependentJob.job.status !== "pending") continue;
    unblockedJobs.set(dependentJob.job.id, dependentJob.job);
  }

  for (const stateJob of unblockedJobs.values()) {
    bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, stateJob);
    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.jobUnblocked(stateJob, { unblockedByChain: chain });
    });
  }

  return completed;
};

const continueChain = async (
  helpers: Helpers,
  {
    fromJob,
    continueWith,
    txCtx,
    transactionHooks,
    fence,
  }: {
    fromJob: StateJob;
    continueWith: AnyContinueWith;
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
    fence: StateAttemptFence | null;
  },
): Promise<(StateJob & { continuation: StateJobInfo }) | undefined> => {
  helpers.jobTypes.validateContinueWith(fromJob.typeName, {
    typeName: continueWith.typeName,
    input: continueWith.input,
  });

  const continued = await continueStateJob(helpers, {
    job: continueWith,
    fromJob,
    fence,
    txCtx,
    transactionHooks,
  });
  if (!continued) return undefined;

  bufferJobCompletedEvents(helpers, {
    completedJob: continued,
    output: null,
    continuation: continued.continuation,
    transactionHooks,
  });

  return continued;
};

export const completeOrContinueChain = async (
  helpers: Helpers,
  {
    job,
    outcome,
    txCtx,
    transactionHooks,
    fence,
  }: {
    job: StateJob;
    outcome: { output: unknown } | { continueWith: AnyContinueWith };
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
    fence: StateAttemptFence | null;
  },
): Promise<(StateJob & { continuation?: StateJobInfo }) | undefined> =>
  "output" in outcome
    ? completeChain(helpers, { job, output: outcome.output, txCtx, transactionHooks, fence })
    : continueChain(helpers, {
        fromJob: job,
        continueWith: outcome.continueWith,
        txCtx,
        transactionHooks,
        fence,
      });

// `txCtx` is optional because the worker's fallback reschedule after a failed attempt runs as an
// autocommit statement.
export const rescheduleJobs = async (
  helpers: Helpers,
  {
    jobs,
    txCtx,
    transactionHooks,
  }: {
    jobs: {
      jobId: string;
      schedule?: ScheduleOptions;
      error?: string;
      fence?: StateAttemptFence;
    }[];
    txCtx?: BaseTxContext;
    transactionHooks: TransactionHooks;
  },
): Promise<(StateJob | undefined)[]> => {
  const rescheduledJobs = await helpers.stateAdapter.rescheduleJobs({ txCtx, jobs });

  for (const job of rescheduledJobs) {
    if (job === undefined) continue;
    bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, job);
    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.jobRescheduled(job);
    });
  }

  return rescheduledJobs;
};
