import { truncate } from "@queuert/helpers/serialize-error";
import {
  isPromise,
  type MaybePromise,
  type SyncAsync,
  syncAsync,
  silence,
  step,
} from "@queuert/sync-async";

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

export const notifyOnCommit = (
  helpers: Helpers,
  txCtx: BaseTxContext,
  notify: (values: string[]) => MaybePromise<void>,
  values: string[],
): void => {
  if (values.length === 0) return;
  helpers.stateAdapter.onTransactionCommit(
    txCtx,
    helpers.sync
      ? () => {
          const sent = notify(values);
          if (isPromise(sent)) silence(sent);
        }
      : async () => notify(values),
  );
};

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
  const lockedPendingTypeNames = lockedChains.flatMap((chain) =>
    chain?.head.status === "pending" ? [chain.head.typeName] : [],
  );
  notifyOnCommit(helpers, txCtx, helpers.notifyHelper.notifyJobsScheduled, lockedPendingTypeNames);
  if (lockedPendingTypeNames.length > 0) {
    helpers.stateAdapter.onTransactionRollback(txCtx, () =>
      helpers.notifyHelper.notifyJobsScheduled(lockedPendingTypeNames),
    );
  }

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

  notifyOnCommit(helpers, txCtx, helpers.notifyHelper.notifyJobsScheduled, scheduledTypeNames);
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
  notifyOnCommit(helpers, txCtx, helpers.notifyHelper.notifyChainsCompleted, [completed.chainId]);

  if (!chain.blocking) return;
  const dependentJobs = yield* step(
    helpers.stateAdapter.unblockJobs({
      txCtx,
      blockedByChainId: chain.id,
    }),
  );
  reportUnblockedJobs(helpers, { chain, dependentJobs, txCtx });
});

type CompleteChainOptions = {
  job: StateJob;
  output: unknown;
  txCtx: BaseTxContext;
  attemptToken: string | null;
  workerId: string | null;
};

export const runCompleteChain: SyncAsync<
  [helpers: Helpers, options: CompleteChainOptions],
  StateJob | undefined
> = syncAsync(function* (
  helpers: Helpers,
  { job, output, txCtx, attemptToken, workerId }: CompleteChainOptions,
) {
  const encodedOutput = helpers.jobTypes.encodeOutput(job.typeName, output);

  const [completed] = yield* step(
    helpers.stateAdapter.completeJobs({
      txCtx,
      jobs: [
        {
          jobId: job.id,
          output: encodedOutput,
          attemptToken: attemptToken ?? undefined,
          workerId: workerId ?? undefined,
        },
      ],
    }),
  );
  if (completed === undefined) return undefined;
  yield* reportCompletedJob.steps(helpers, { completed, encodedOutput, txCtx });
  return completed;
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

  notifyOnCommit(
    helpers,
    txCtx,
    helpers.notifyHelper.notifyJobsScheduled,
    [...unblockedJobs.values()].map((stateJob) => stateJob.typeName),
  );
  for (const stateJob of unblockedJobs.values()) {
    helpers.stateAdapter.onTransactionCommit(txCtx, () => {
      helpers.observabilityHelper.jobUnblocked(stateJob, { unblockedByChain: chain });
    });
  }
};

type ContinueChainOptions = {
  job: StateJob;
  continueWith: AnyNewJob;
  txCtx: BaseTxContext;
  attemptToken: string | null;
  workerId: string | null;
};

export const runContinueChain: SyncAsync<
  [helpers: Helpers, options: ContinueChainOptions],
  (StateJob & { continuation: StateJobInfo }) | undefined
> = syncAsync(function* (
  helpers: Helpers,
  { job, continueWith, txCtx, attemptToken, workerId }: ContinueChainOptions,
) {
  helpers.jobTypes.validateContinueWith(job.typeName, {
    typeName: continueWith.typeName,
    input: continueWith.input,
  });

  const prepared = prepareJobs(helpers, [continueWith], job);
  const [{ jobSpan }] = prepared;
  try {
    const [locked] = yield* lockBlockerChains.steps(helpers, { items: prepared, txCtx });
    const [continued] = yield* step(
      helpers.stateAdapter.continueJobs({
        txCtx,
        jobs: [
          {
            id: locked.id,
            typeName: locked.entry.typeName,
            input: locked.encodedInput,
            schedule: locked.entry.schedule,
            traceContext: locked.jobSpan?.traceContext ?? null,
            continueFromId: job.id,
            attemptToken: attemptToken ?? undefined,
            workerId: workerId ?? undefined,
          },
        ],
      }),
    );
    if (!continued) {
      const error = new JobNotFoundError(`Job ${job.id} not found or already completed`, {
        jobId: job.id,
      });
      jobSpan?.end({ status: "error", error });
      return undefined;
    }

    const created = yield* addJobsBlockers.steps(helpers, {
      txCtx,
      items: [
        {
          ...locked,
          job: continued.continuation,
          chain: continued.chain,
          deduplicated: false,
        },
      ],
    });
    reportCreatedJobs(helpers, created, { isChainHead: false, txCtx });

    const [{ job: continuation }] = created;
    const completed: StateJob & { continuation: StateJobInfo } = { ...continued, continuation };
    helpers.stateAdapter.onTransactionCommit(txCtx, () => {
      helpers.observabilityHelper.jobCompleted(completed, {
        output: null,
        continuedWith: continuation,
      });
    });
    return completed;
  } catch (error) {
    jobSpan?.end({ status: "error", error });
    throw error;
  }
});

type RescheduleJobsOptions = {
  jobs: { jobId: string; schedule?: ScheduleOptions; reason?: string; attemptToken?: string }[];
  txCtx: BaseTxContext;
};

export const runRescheduleJobs: SyncAsync<
  [helpers: Helpers, options: RescheduleJobsOptions],
  (StateJob | undefined)[]
> = syncAsync(function* (helpers: Helpers, { jobs, txCtx }: RescheduleJobsOptions) {
  const rescheduledJobs = yield* step(
    helpers.stateAdapter.rescheduleJobs({
      txCtx,
      jobs: jobs.map((job) =>
        job.reason === undefined ? job : { ...job, reason: truncate(job.reason) },
      ),
    }),
  );
  reportRescheduledJobs(helpers, { rescheduledJobs, txCtx });
  return rescheduledJobs;
});

const reportRescheduledJobs = (
  helpers: Helpers,
  { rescheduledJobs, txCtx }: { rescheduledJobs: (StateJob | undefined)[]; txCtx: BaseTxContext },
): void => {
  notifyOnCommit(
    helpers,
    txCtx,
    helpers.notifyHelper.notifyJobsScheduled,
    rescheduledJobs.flatMap((job) => (job === undefined ? [] : [job.typeName])),
  );
  for (const job of rescheduledJobs) {
    if (job === undefined) continue;
    helpers.stateAdapter.onTransactionCommit(txCtx, () => {
      helpers.observabilityHelper.jobRescheduled(job);
    });
  }
};
