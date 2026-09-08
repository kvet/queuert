import { type AnyChain } from "../entities/chain.js";
import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { BlockerLimitExceededError } from "../errors.js";
import { bufferNotifyJobScheduled } from "../helpers/notify-hooks.js";
import {
  bufferObservabilityEvent,
  bufferObservabilityRollback,
} from "../helpers/observability-hooks.js";
import { type ObservabilityHelper } from "../observability-adapter/observability-helper.js";
import { type Helpers } from "../setup-helpers.js";
import {
  type BaseTxContext,
  type StateChain,
  type StateJob,
  type StateJobInfo,
} from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";

const MAX_BLOCKERS_PER_JOB = 100;

type CommonInput = {
  id?: string;
  typeName: string;
  input: unknown;
  blockers?: AnyChain[];
  schedule?: ScheduleOptions;
};

type ParsedEntry = {
  typeName: string;
  input: unknown;
  blockers?: AnyChain[];
  parsedInput: unknown;
};

type JobSpanHandle = ReturnType<ObservabilityHelper["startJobSpan"]>;

const assertBlockerLimit = (typeName: string, blockerCount: number): void => {
  if (blockerCount > MAX_BLOCKERS_PER_JOB) {
    throw new BlockerLimitExceededError(
      `Job "${typeName}" declares ${blockerCount} blockers, exceeding the limit of ${MAX_BLOCKERS_PER_JOB}`,
      { typeName, count: blockerCount, limit: MAX_BLOCKERS_PER_JOB },
    );
  }
};

const finalizeCreatedJobs = async (
  helpers: Helpers,
  {
    parsed,
    spanHandles,
    createResults,
    isChainHead,
    txCtx,
    transactionHooks,
  }: {
    parsed: ParsedEntry[];
    spanHandles: JobSpanHandle[];
    createResults: (StateChain & { deduplicated: boolean })[];
    isChainHead: boolean;
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
  },
): Promise<(StateChain & { deduplicated: boolean })[]> => {
  try {
    // Mutable copy: head job info may be updated by addJobsBlockers.
    const stateChains: StateChain[] = createResults.map(({ deduplicated: _, ...chain }) => chain);
    const perJobIncompleteBlockerChainIds: string[][] = parsed.map(() => []);

    for (let i = 0; i < createResults.length; i++) {
      if (createResults[i].deduplicated) {
        spanHandles[i]?.end({
          status: "deduplicated",
          chainId: stateChains[i].id,
          jobId: stateChains[i].head.id,
          existingChainTraceContext: stateChains[i].traceContext,
        });
      }
    }

    const blockerIndices: number[] = [];
    const blockerSpanHandlesPerEntry: ReturnType<
      typeof helpers.observabilityHelper.startBlockerSpan
    >[][] = [];

    for (let i = 0; i < parsed.length; i++) {
      if (createResults[i].deduplicated) continue;
      const blockers = parsed[i].blockers;
      if (!blockers || blockers.length === 0) continue;

      blockerIndices.push(i);
      blockerSpanHandlesPerEntry.push(
        spanHandles[i]
          ? blockers.map((blocker, bi) =>
              helpers.observabilityHelper.startBlockerSpan({
                chainId: stateChains[i].id,
                chainTypeName: stateChains[i].typeName,
                jobId: stateChains[i].head.id,
                jobTypeName: parsed[i].typeName,
                jobTraceContext: spanHandles[i]!.getTraceContext(),
                blockerChainId: blocker.id,
                blockerChainTypeName: blocker.typeName,
                blockerIndex: bi,
              }),
            )
          : [],
      );
    }

    if (blockerIndices.length > 0) {
      const blockerParams = blockerIndices.map((i, bi) => ({
        jobId: stateChains[i].head.id,
        blockedByChainIds: parsed[i].blockers!.map((b) => b.id),
        blockerTraceContexts: blockerSpanHandlesPerEntry[bi].map(
          (h) => h?.getTraceContext() ?? null,
        ),
      }));

      const blockerResults = await helpers.stateAdapter.addJobsBlockers({
        txCtx,
        jobBlockers: blockerParams,
      });

      for (let bi = 0; bi < blockerIndices.length; bi++) {
        const i = blockerIndices[bi];
        const result = blockerResults[bi];
        const blockerChains = parsed[i].blockers!;
        const blockerChainIds = blockerChains.map((b) => b.id);
        const blockerSpanHandlesList = blockerSpanHandlesPerEntry[bi];

        // addJobsBlockers returns StateJob & { blockers }; extract the updated job info.
        const { chain: _chain, blockers: resultBlockers, ...updatedJobInfo } = result;
        stateChains[i] = { ...stateChains[i], head: updatedJobInfo };
        const incomplete = resultBlockers.filter((b) => b.completedAt === null);
        perJobIncompleteBlockerChainIds[i] = incomplete.map((b) => b.id);

        const incompleteSet = new Set(perJobIncompleteBlockerChainIds[i]);
        blockerSpanHandlesList.forEach((handle, hi) => {
          if (!handle) return;
          bufferObservabilityEvent(transactionHooks, () => {
            handle.end({
              blockerChainTraceContext: resultBlockers[hi].traceContext,
            });
          });
          if (!incompleteSet.has(blockerChainIds[hi])) {
            bufferObservabilityEvent(transactionHooks, () => {
              helpers.observabilityHelper.completeBlockerSpan({
                traceContext: handle.getTraceContext(),
                blockerChainTypeName: blockerChains[hi].typeName,
              });
            });
          }
        });
      }
    }

    for (let i = 0; i < parsed.length; i++) {
      if (createResults[i].deduplicated) continue;

      const stateChain = stateChains[i];
      const jobInput = parsed[i];
      const blockerChains = jobInput.blockers ?? [];

      const blockerRefs = blockerChains.map((b) => ({ typeName: b.typeName, input: b.input }));
      helpers.jobTypes.validateBlockers(jobInput.typeName, blockerRefs);

      bufferObservabilityEvent(transactionHooks, () =>
        spanHandles[i]?.end({
          status: "created",
          chainId: stateChain.id,
          jobId: stateChain.head.id,
        }),
      );

      if (spanHandles[i]) {
        bufferObservabilityRollback(transactionHooks, () => {
          spanHandles[i]!.end({ status: "error", error: new Error("savepoint rolled back") });
        });
      }

      if (isChainHead) {
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.chainCreated(stateChain, { input: jobInput.input });
        });
      }

      const stateJob: StateJob = { ...stateChain.head, chain: stateChain };
      bufferObservabilityEvent(transactionHooks, () => {
        helpers.observabilityHelper.jobCreated(stateJob, {
          input: jobInput.input,
          blockers: blockerChains,
        });
      });

      const incompleteBlockerChainIds = perJobIncompleteBlockerChainIds[i];
      if (incompleteBlockerChainIds.length > 0) {
        const incompleteBlockerSet = new Set(incompleteBlockerChainIds);
        const incompleteBlockerChains = blockerChains.filter((b) => incompleteBlockerSet.has(b.id));
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.jobBlocked(stateJob, {
            blockedByChains: incompleteBlockerChains,
          });
        });
      }

      bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, stateJob);
    }

    return parsed.map((_, i) => ({
      ...stateChains[i],
      deduplicated: createResults[i].deduplicated,
    }));
  } catch (error) {
    for (let i = 0; i < spanHandles.length; i++) {
      if (!createResults[i]?.deduplicated) {
        spanHandles[i]?.end({ status: "error", error });
      }
    }
    throw error;
  }
};

const prepareJobs = <TEntry extends CommonInput>(
  helpers: Helpers,
  entries: TEntry[],
  startSpan: (entry: TEntry, index: number) => JobSpanHandle,
): { parsed: ParsedEntry[]; spanHandles: JobSpanHandle[] } => {
  for (const entry of entries) {
    assertBlockerLimit(entry.typeName, entry.blockers?.length ?? 0);
  }

  const parsed: ParsedEntry[] = entries.map((entry) => ({
    typeName: entry.typeName,
    input: entry.input,
    blockers: entry.blockers,
    parsedInput: helpers.jobTypes.parseInput(entry.typeName, entry.input),
  }));

  const spanHandles = entries.map(startSpan);

  return { parsed, spanHandles };
};

const runCreate = async <T>(spanHandles: JobSpanHandle[], create: () => Promise<T>): Promise<T> => {
  try {
    return await create();
  } catch (error) {
    for (const spanHandle of spanHandles) {
      spanHandle?.end({ status: "error", error });
    }
    throw error;
  }
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

  const { parsed, spanHandles } = prepareJobs(helpers, chains, (entry) =>
    helpers.observabilityHelper.startJobSpan({
      chainTypeName: entry.typeName,
      jobTypeName: entry.typeName,
      isChainHead: true,
    }),
  );

  const createJobParams = chains.map((chain, i) => ({
    id: chain.id,
    typeName: chain.typeName,
    input: parsed[i].parsedInput,
    schedule: chain.schedule,
    chainTraceContext: spanHandles[i]?.getChainTraceContext() ?? null,
    traceContext: spanHandles[i]?.getTraceContext() ?? null,
    deduplication: chain.deduplication,
  }));

  const createResults = await runCreate(spanHandles, async () =>
    helpers.stateAdapter.createJobs({ txCtx, jobs: createJobParams }),
  );

  return finalizeCreatedJobs(helpers, {
    parsed,
    spanHandles,
    createResults,
    isChainHead: true,
    txCtx,
    transactionHooks,
  });
};

export const continueStateJobs = async (
  helpers: Helpers,
  {
    job,
    fromJob,
    workerId,
    txCtx,
    transactionHooks,
  }: {
    job: CommonInput;
    fromJob: StateJob;
    workerId: string | null;
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
  },
): Promise<{ completedJob: StateJob; continuation: StateJobInfo }> => {
  const { parsed, spanHandles } = prepareJobs(helpers, [job], () =>
    helpers.observabilityHelper.startJobSpan({
      chainTypeName: fromJob.chain.typeName,
      jobTypeName: job.typeName,
      isChainHead: false,
      originChainTraceContext: fromJob.chain.traceContext,
      originTraceContext: fromJob.traceContext,
    }),
  );
  const [spanHandle] = spanHandles;

  const [{ continuation, ...completedJob }] = await runCreate(spanHandles, async () =>
    helpers.stateAdapter.continueJobs({
      txCtx,
      completedBy: workerId,
      jobs: [
        {
          id: job.id,
          typeName: job.typeName,
          input: parsed[0].parsedInput,
          schedule: job.schedule,
          traceContext: spanHandle?.getTraceContext() ?? null,
          continueFromId: fromJob.id,
        },
      ],
    }),
  );

  // The continuation shares the chain of the job it continues.
  const [result] = await finalizeCreatedJobs(helpers, {
    parsed,
    spanHandles,
    createResults: [
      { ...completedJob.chain, head: continuation, tail: undefined, deduplicated: false },
    ],
    isChainHead: false,
    txCtx,
    transactionHooks,
  });
  return { completedJob, continuation: result.head };
};
