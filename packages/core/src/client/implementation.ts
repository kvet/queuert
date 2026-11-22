import { truncate } from "@queuert/helpers/serialize-error";
import { type SyncAsync, syncAsync, step } from "@queuert/sync-async";

import type { AnyJobOutcome, AnyJobOutcomeFields } from "../attempt/attempt-handler.types.ts";
import { type Chain, mapStateChainToChain } from "../entities/chain.ts";
import type { DeduplicationOptions } from "../entities/deduplication.ts";
import type { ScheduleOptions } from "../entities/schedule.ts";
import {
  BlockerLimitExceededError,
  ChainNotFoundError,
  ChainTypeMismatchError,
  JobNotFoundError,
} from "../errors.ts";
import type { AnyNewJob } from "../job-types/job-types.resolvers.ts";
import { notifyAfterTransaction } from "../notify-adapter/tx-notifications.ts";
import type {
  BlockerSpanHandle,
  JobSpanHandle,
} from "../observability-adapter/observability-adapter.ts";
import { resolveJobId } from "../state-adapter/adapter-config.ts";
import type {
  BaseTxContext,
  StateChain,
  StateChainInfo,
  StateDependentJob,
  StateJob,
  StateJobInfo,
} from "../state-adapter/state-adapter.ts";
import type { Helpers } from "./setup-helpers.ts";

type BlockerSpan = { blockerChain: StateChain; blockerSpan: BlockerSpanHandle | undefined };

type CreatedJob = {
  job: StateJobInfo;
  chain: StateChainInfo;
  deduplicated: boolean;
  jobSpan: JobSpanHandle | undefined;
  blockerChains: StateChain[];
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

type PreparedJob = {
  entry: AnyNewJob & { deduplication?: DeduplicationOptions };
  id: string;
  encodedInput: unknown;
  jobSpan: JobSpanHandle | undefined;
};

type LockedJob = PreparedJob & { blockerChains: StateChain[] };

const prepareJobs = (
  helpers: Helpers,
  entries: PreparedJob["entry"][],
  fromJob: StateJob | null,
): PreparedJob[] => {
  const prepared = entries.map((entry): PreparedJob => {
    assertBlockerLimit(helpers, entry.typeName, entry.blockers?.length ?? 0);
    return {
      entry,
      id: resolveJobId(helpers.stateAdapter.config, entry.id),
      encodedInput: helpers.jobTypes.encodeInput(entry.typeName, entry.input),
      jobSpan: undefined,
    };
  });

  for (const item of prepared) {
    item.jobSpan = helpers.observabilityHelper.startJobSpan(item.entry.typeName, fromJob);
  }
  return prepared;
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

const noChains: (StateChain | undefined)[] = [];

const lockBlockerChains = syncAsync(function* (
  helpers: Helpers,
  { items, txCtx }: { items: PreparedJob[]; txCtx: BaseTxContext },
) {
  const blockerChainIds: string[] = [];
  for (const item of items) {
    for (const blocker of item.entry.blockers ?? []) blockerChainIds.push(blocker.id);
  }
  const lockedChains =
    blockerChainIds.length > 0
      ? yield* step(
          helpers.stateAdapter.getChains({
            txCtx,
            chainIds: blockerChainIds,
            lock: "exclusive",
          }),
        )
      : noChains;
  notifyAfterTransaction(helpers, txCtx, {
    lockedPendingJobs: lockedChains.flatMap((chain) =>
      chain?.head.status === "pending" ? [chain.head] : [],
    ),
  });

  const fetched = lockedChains.values();
  return items.map((item): LockedJob => {
    const jobBlockerChains = (item.entry.blockers ?? []).map((blocker) =>
      requireBlockerChain(blocker, fetched.next().value),
    );
    helpers.jobTypes.validateBlockers(
      item.entry.typeName,
      jobBlockerChains.map((blockerChain) => ({
        typeName: blockerChain.typeName,
        input: helpers.jobTypes.decodeInput(blockerChain.head.typeName, blockerChain.head.input),
      })),
    );
    return { ...item, blockerChains: jobBlockerChains };
  });
});

const addJobsBlockers = syncAsync(function* (
  helpers: Helpers,
  { items, txCtx }: { items: CreatedJob[]; txCtx: BaseTxContext },
) {
  const isBlocked = (item: CreatedJob) => !item.deduplicated && item.blockerChains.length > 0;

  const itemsWithBlockerSpans = items.map((item): CreatedJob & { blockerSpans: BlockerSpan[] } => {
    const { jobSpan } = item;
    return {
      ...item,
      blockerSpans:
        isBlocked(item) && jobSpan
          ? item.blockerChains.map((blockerChain, blockerIndex) => ({
              blockerChain,
              blockerSpan: helpers.observabilityHelper.startBlockerSpan(
                { ...item.job, chain: item.chain },
                { jobTraceContext: jobSpan.traceContext, blockerChain, blockerIndex },
              ),
            }))
          : [],
    };
  });

  const blockedItems = itemsWithBlockerSpans.filter(isBlocked);
  if (blockedItems.length === 0) return itemsWithBlockerSpans;

  const blockedRows = yield* step(
    helpers.stateAdapter.addJobsBlockers({
      txCtx,
      jobBlockers: blockedItems.map((item) => ({
        jobId: item.job.id,
        blockedByChainIds: item.blockerChains.map((blockerChain) => blockerChain.id),
        blockerTraceContexts: item.blockerSpans.map(
          ({ blockerSpan }) => blockerSpan?.traceContext ?? null,
        ),
      })),
    }),
  );

  const rows = blockedRows.values();
  return itemsWithBlockerSpans.map((item) => {
    const updatedRow = isBlocked(item) ? rows.next().value : undefined;
    if (updatedRow === undefined) return item;
    const { chain: _chain, blockers: _blockers, ...updatedJob } = updatedRow;
    return { ...item, job: updatedJob };
  });
});

const reportCreatedJobs = (
  helpers: Helpers,
  items: (CreatedJob & { blockerSpans: BlockerSpan[] })[],
  { isChainHead, txCtx }: { isChainHead: boolean; txCtx: BaseTxContext },
): void => {
  for (const item of items) {
    for (const { blockerChain, blockerSpan } of item.blockerSpans) {
      if (!blockerSpan) continue;
      helpers.stateAdapter.onTransactionCommit(txCtx, () => {
        blockerSpan.end({ blockerChainTraceContext: blockerChain.traceContext });
      });
      if (blockerChain.completedAt !== null) {
        helpers.stateAdapter.onTransactionCommit(txCtx, () => {
          helpers.observabilityHelper.completeBlockerSpan(blockerSpan.traceContext, blockerChain);
        });
      }
    }
  }

  const scheduledTypeNames: string[] = [];
  for (const { job, chain, deduplicated, jobSpan, blockerChains } of items) {
    if (deduplicated) {
      jobSpan?.end({
        status: "deduplicated",
        chainId: chain.id,
        jobId: job.id,
        existingChainTraceContext: chain.traceContext,
      });
      continue;
    }

    if (jobSpan !== undefined) {
      helpers.stateAdapter.onTransactionCommit(txCtx, () => {
        jobSpan.end({ status: "created", chainId: chain.id, jobId: job.id });
      });
      helpers.stateAdapter.onTransactionRollback(txCtx, () => {
        jobSpan.end({ status: "error", error: new Error("savepoint rolled back") });
      });
    }

    if (isChainHead) {
      helpers.stateAdapter.onTransactionCommit(txCtx, () => {
        helpers.observabilityHelper.chainCreated(chain, { input: job.input });
      });
    }

    const stateJob: StateJob = { ...job, chain };
    helpers.stateAdapter.onTransactionCommit(txCtx, () => {
      helpers.observabilityHelper.jobCreated(stateJob, {
        blockers: blockerChains,
      });
    });

    if (blockerChains.length === 0) {
      scheduledTypeNames.push(job.typeName);
      continue;
    }
    const incompleteBlockerChains = blockerChains.filter(
      (blockerChain) => blockerChain.completedAt === null,
    );
    if (incompleteBlockerChains.length === 0) {
      scheduledTypeNames.push(job.typeName);
      continue;
    }
    helpers.stateAdapter.onTransactionCommit(txCtx, () => {
      helpers.observabilityHelper.jobBlocked(stateJob, {
        blockedByChains: incompleteBlockerChains,
      });
    });
  }

  notifyAfterTransaction(helpers, txCtx, { jobsScheduled: scheduledTypeNames });
};

type CreateChainsOptions = { chains: PreparedJob["entry"][]; txCtx: BaseTxContext };

export const runCreateChains: SyncAsync<
  [helpers: Helpers, options: CreateChainsOptions],
  (Chain<string, string, unknown, unknown> & { deduplicated: boolean })[]
> = syncAsync(function* (helpers: Helpers, { chains, txCtx }: CreateChainsOptions) {
  if (chains.length === 0) return [];

  for (const chain of chains) {
    helpers.jobTypes.validateEntry(chain.typeName);
  }
  for (const chain of chains) {
    const scope: unknown = chain.deduplication?.scope;
    if (chain.deduplication != null && scope !== "running" && scope !== "any") {
      throw new TypeError(
        `Invalid deduplication scope ${JSON.stringify(scope)}: expected "running" or "any" ("incomplete" was renamed to "running")`,
      );
    }
  }

  const prepared = prepareJobs(helpers, chains, null);
  try {
    const locked = yield* lockBlockerChains.steps(helpers, { items: prepared, txCtx });
    const createdChains = yield* step(
      helpers.stateAdapter.createJobs({
        txCtx,
        jobs: locked.map((item) => ({
          id: item.id,
          typeName: item.entry.typeName,
          input: item.encodedInput,
          schedule: item.entry.schedule,
          chainTraceContext: item.jobSpan?.chainTraceContext ?? null,
          traceContext: item.jobSpan?.traceContext ?? null,
          deduplication: item.entry.deduplication,
        })),
      }),
    );
    const created = yield* addJobsBlockers.steps(helpers, {
      txCtx,
      items: locked.map((item, index) => {
        const { head, tail: _tail, deduplicated, ...chain } = createdChains[index];
        return { ...item, job: head, chain, deduplicated };
      }),
    });
    reportCreatedJobs(helpers, created, { isChainHead: true, txCtx });

    return createdChains.map(
      (createdChain): Chain<string, string, unknown, unknown> & { deduplicated: boolean } => ({
        ...mapStateChainToChain(createdChain, helpers.jobTypes),
        deduplicated: createdChain.deduplicated,
      }),
    );
  } catch (error) {
    for (const { jobSpan } of prepared) {
      jobSpan?.end({ status: "error", error });
    }
    throw error;
  }
});

const reportCompletedJob = syncAsync(function* (
  helpers: Helpers,
  {
    completed,
    encodedOutput,
    txCtx,
  }: { completed: StateJob; encodedOutput: unknown; txCtx: BaseTxContext },
) {
  const { chain } = completed;

  helpers.stateAdapter.onTransactionCommit(txCtx, () => {
    helpers.observabilityHelper.jobCompleted(completed, { output: encodedOutput });
  });
  helpers.stateAdapter.onTransactionCommit(txCtx, () => {
    helpers.observabilityHelper.chainCompleted(chain, { output: encodedOutput });
  });
  notifyAfterTransaction(helpers, txCtx, { chainsCompleted: [completed.chainId] });

  if (!chain.blocking) return;
  const dependentJobs = yield* step(
    helpers.stateAdapter.unblockJobs({
      txCtx,
      blockedByChainId: chain.id,
    }),
  );
  reportUnblockedJobs(helpers, { chain, dependentJobs, txCtx });
});

const reportUnblockedJobs = (
  helpers: Helpers,
  {
    chain,
    dependentJobs,
    txCtx,
  }: { chain: StateChainInfo; dependentJobs: StateDependentJob[]; txCtx: BaseTxContext },
): void => {
  if (dependentJobs.length === 0) return;
  for (const { traceContext } of dependentJobs) {
    if (traceContext === null) continue;
    helpers.stateAdapter.onTransactionCommit(txCtx, () => {
      helpers.observabilityHelper.completeBlockerSpan(traceContext, chain);
    });
  }

  const unblockedJobs = new Map(
    dependentJobs
      .filter((dependentJob) => dependentJob.job.status === "pending")
      .map((dependentJob) => [dependentJob.job.id, dependentJob.job]),
  );

  notifyAfterTransaction(helpers, txCtx, {
    jobsScheduled: [...unblockedJobs.values()].map((stateJob) => stateJob.typeName),
  });
  for (const stateJob of unblockedJobs.values()) {
    helpers.stateAdapter.onTransactionCommit(txCtx, () => {
      helpers.observabilityHelper.jobUnblocked(stateJob, { unblockedByChain: chain });
    });
  }
};

type OutcomeItem = {
  job: StateJob;
  outcome: AnyJobOutcome;
  attemptToken?: string;
  workerId?: string;
};

export type OutcomeJob = StateJob & { continuation?: StateJobInfo };

export const parseJobOutcome = (options: AnyJobOutcomeFields, method: string): AnyJobOutcome => {
  const outcomeCount =
    Number("output" in options) +
    Number("continueWith" in options) +
    Number("reschedule" in options);
  if (outcomeCount !== 1) {
    throw new Error(`${method} requires exactly one of output, continueWith or reschedule`);
  }
  if (options.reason !== undefined && !("reschedule" in options)) {
    throw new Error(`${method} accepts reason only together with reschedule`);
  }
  if ("reschedule" in options) return { reschedule: options.reschedule!, reason: options.reason };
  if ("continueWith" in options) return { continueWith: options.continueWith! };
  return { output: options.output };
};

const completeOutputItems = syncAsync(function* (
  helpers: Helpers,
  {
    items,
    encodedOutputs,
    txCtx,
  }: { items: OutcomeItem[]; encodedOutputs: unknown[]; txCtx: BaseTxContext },
) {
  const completedJobs = yield* step(
    helpers.stateAdapter.completeJobs({
      txCtx,
      jobs: items.map(({ job, attemptToken, workerId }, index) => ({
        jobId: job.id,
        output: encodedOutputs[index],
        attemptToken,
        workerId,
      })),
    }),
  );
  for (const [index, completed] of completedJobs.entries()) {
    if (completed === undefined) continue;
    yield* reportCompletedJob.steps(helpers, {
      completed,
      encodedOutput: encodedOutputs[index],
      txCtx,
    });
  }
  return completedJobs;
});

const continueItems = syncAsync(function* (
  helpers: Helpers,
  { items, txCtx }: { items: OutcomeItem[]; txCtx: BaseTxContext },
) {
  const prepared = items.flatMap(({ job, outcome }) => {
    const { continueWith } = outcome as { continueWith: AnyNewJob };
    helpers.jobTypes.validateContinueWith(job.typeName, {
      typeName: continueWith.typeName,
      input: continueWith.input,
    });
    return prepareJobs(helpers, [continueWith], job);
  });
  try {
    const locked = yield* lockBlockerChains.steps(helpers, { items: prepared, txCtx });
    const continuedJobs = yield* step(
      helpers.stateAdapter.continueJobs({
        txCtx,
        jobs: locked.map((item, index) => ({
          id: item.id,
          typeName: item.entry.typeName,
          input: item.encodedInput,
          schedule: item.entry.schedule,
          traceContext: item.jobSpan?.traceContext ?? null,
          continueFromId: items[index].job.id,
          attemptToken: items[index].attemptToken,
          workerId: items[index].workerId,
        })),
      }),
    );

    const created = yield* addJobsBlockers.steps(helpers, {
      txCtx,
      items: locked.flatMap((item, index) => {
        const continued = continuedJobs[index];
        return continued === undefined
          ? []
          : [{ ...item, job: continued.continuation, chain: continued.chain, deduplicated: false }];
      }),
    });
    reportCreatedJobs(helpers, created, { isChainHead: false, txCtx });

    const continuationById = new Map(created.map(({ job }) => [job.id, job]));
    return continuedJobs.map((continued, index) => {
      if (continued === undefined) {
        locked[index].jobSpan?.end({
          status: "error",
          error: new JobNotFoundError(`Job ${items[index].job.id} not found or already completed`, {
            jobId: items[index].job.id,
          }),
        });
        return undefined;
      }
      const completed = {
        ...continued,
        continuation: continuationById.get(continued.continuation.id)!,
      };
      helpers.stateAdapter.onTransactionCommit(txCtx, () => {
        helpers.observabilityHelper.jobCompleted(completed, {
          output: null,
          continuedWith: completed.continuation,
        });
      });
      return completed;
    });
  } catch (error) {
    for (const { jobSpan } of prepared) {
      jobSpan?.end({ status: "error", error });
    }
    throw error;
  }
});

const rescheduleItems = syncAsync(function* (
  helpers: Helpers,
  { items, txCtx }: { items: OutcomeItem[]; txCtx: BaseTxContext },
) {
  const rescheduledJobs = yield* step(
    helpers.stateAdapter.rescheduleJobs({
      txCtx,
      jobs: items.map(({ job, outcome, attemptToken }) => {
        const { reschedule, reason } = outcome as { reschedule: ScheduleOptions; reason?: string };
        return {
          jobId: job.id,
          schedule: reschedule,
          reason: reason === undefined ? undefined : truncate(reason),
          attemptToken,
        };
      }),
    }),
  );
  reportRescheduledJobs(helpers, {
    rescheduledJobs,
    scheduledJobs: rescheduledJobs.filter((job) => job?.status === "pending"),
    txCtx,
  });
  return rescheduledJobs;
});

export const runApplyJobOutcomes: SyncAsync<
  [helpers: Helpers, options: { items: OutcomeItem[]; txCtx: BaseTxContext }],
  (OutcomeJob | undefined)[]
> = syncAsync(function* (
  helpers: Helpers,
  { items, txCtx }: { items: OutcomeItem[]; txCtx: BaseTxContext },
) {
  const outputItems = items.filter(({ outcome }) => "output" in outcome);
  const continueWithItems = items.filter(({ outcome }) => "continueWith" in outcome);
  const reschedulesItems = items.filter(({ outcome }) => "reschedule" in outcome);
  const encodedOutputs = outputItems.map(({ job, outcome }) =>
    helpers.jobTypes.encodeOutput(job.typeName, (outcome as { output: unknown }).output),
  );

  const written: (OutcomeJob | undefined)[] = [
    ...(continueWithItems.length > 0
      ? yield* continueItems.steps(helpers, { items: continueWithItems, txCtx })
      : []),
    ...(outputItems.length > 0
      ? yield* completeOutputItems.steps(helpers, { items: outputItems, encodedOutputs, txCtx })
      : []),
    ...(reschedulesItems.length > 0
      ? yield* rescheduleItems.steps(helpers, { items: reschedulesItems, txCtx })
      : []),
  ];
  const writtenById = new Map(written.flatMap((job) => (job === undefined ? [] : [[job.id, job]])));
  return items.map(({ job }) => writtenById.get(job.id));
});

const reportRescheduledJobs = (
  helpers: Helpers,
  {
    rescheduledJobs,
    scheduledJobs,
    txCtx,
  }: {
    rescheduledJobs: (StateJob | undefined)[];
    scheduledJobs: (StateJob | undefined)[];
    txCtx: BaseTxContext;
  },
): void => {
  notifyAfterTransaction(helpers, txCtx, {
    jobsScheduled: scheduledJobs.flatMap((job) => (job === undefined ? [] : [job.typeName])),
  });
  for (const job of rescheduledJobs) {
    if (job === undefined) continue;
    helpers.stateAdapter.onTransactionCommit(txCtx, () => {
      helpers.observabilityHelper.jobRescheduled(job);
    });
  }
};
