import { serializeError, truncate } from "@queuert/helpers/serialize-error";
import { type SyncAsync, syncAsync, step } from "@queuert/sync-async";

import type { AnyJobOutcome, AnyJobOutcomeFields } from "../attempt/attempt-handler.types.ts";
import { type BackoffConfig, calculateBackoffMs } from "../entities/backoff.ts";
import { type Chain, assertChainsTypeName, mapStateChainToChain } from "../entities/chain.ts";
import type { DeduplicationOptions } from "../entities/deduplication.ts";
import type { ScheduleOptions } from "../entities/schedule.ts";
import {
  BlockerReferenceError,
  ChainsNotFoundError,
  InvalidJobIdError,
  InvalidJobIdsError,
  JobBlockerLimitExceededError,
  JobNotFoundError,
  JobsBlockerLimitExceededError,
  JobsTypeValidationError,
  JobTypeValidationError,
  UnknownJobTypeError,
  UnknownJobTypesError,
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
import {
  type TxEffects,
  createTxEffects,
  registerTxEffects,
  registerTxEffectsAfterError,
} from "../tx-effects/tx-effects.ts";
import type { Helpers } from "./setup-helpers.ts";

type BlockerSpan = { blockerChain: StateChain; blockerSpan: BlockerSpanHandle | undefined };

type CreatedJob = {
  job: StateJobInfo;
  chain: StateChainInfo;
  deduplicated: boolean;
  jobSpan: JobSpanHandle | undefined;
  blockerChains: StateChain[];
};

type PreparedJob = {
  entry: AnyNewJob & { deduplication?: DeduplicationOptions };
  id: string;
  encodedInput: unknown;
  jobSpan: JobSpanHandle | undefined;
};

type LockedJob = PreparedJob & { blockerChains: StateChain[] };

type ItemError =
  | JobBlockerLimitExceededError
  | InvalidJobIdError
  | JobTypeValidationError
  | UnknownJobTypeError;

const isItemError = (error: unknown): error is ItemError =>
  error instanceof JobBlockerLimitExceededError ||
  error instanceof InvalidJobIdError ||
  error instanceof JobTypeValidationError ||
  error instanceof UnknownJobTypeError;

const failuresOf = <TError extends ItemError>(
  failures: { itemIndex: number; error: ItemError }[],
  errorClass: new (...args: any[]) => TError,
) => {
  const matching = failures.flatMap(({ itemIndex, error }) =>
    error instanceof errorClass ? [{ itemIndex, error }] : [],
  );
  return {
    description: matching
      .map(({ itemIndex, error }) => `item ${itemIndex} (${error.message})`)
      .join(", "),
    options: {
      itemIndexes: matching.map(({ itemIndex }) => itemIndex),
      errors: matching.map(({ error }) => error),
    },
  };
};

const toItemsError = (failures: { itemIndex: number; error: ItemError }[]): Error => {
  const first = failures[0].error;
  if (first instanceof JobBlockerLimitExceededError) {
    const { description, options } = failuresOf(failures, JobBlockerLimitExceededError);
    return new JobsBlockerLimitExceededError(
      `Jobs declare too many blockers: ${description}`,
      options,
    );
  }
  if (first instanceof InvalidJobIdError) {
    const { description, options } = failuresOf(failures, InvalidJobIdError);
    return new InvalidJobIdsError(`Invalid job IDs: ${description}`, options);
  }
  if (first instanceof UnknownJobTypeError) {
    const { description, options } = failuresOf(failures, UnknownJobTypeError);
    return new UnknownJobTypesError(`Unknown job types: ${description}`, options);
  }
  const { description, options } = failuresOf(failures, JobTypeValidationError);
  return new JobsTypeValidationError(`Job type validation failed: ${description}`, options);
};

const mapItems = <TItem, TResult>(
  items: readonly TItem[],
  map: (item: TItem) => TResult,
  itemIndexOf?: (index: number) => number,
): TResult[] => {
  let failures: { itemIndex: number; error: ItemError }[] | undefined;
  const results = items.map((item, index) => {
    try {
      return map(item);
    } catch (error) {
      if (!isItemError(error)) throw error;
      (failures ??= []).push({ itemIndex: itemIndexOf?.(index) ?? index, error });
      return undefined as TResult;
    }
  });
  if (failures !== undefined) throw toItemsError(failures);
  return results;
};

const assertBlockerLimit = (helpers: Helpers, typeName: string, blockerCount: number): void => {
  const limit = helpers.stateAdapter.config.maxBlockersPerJob;
  if (blockerCount > limit) {
    throw new JobBlockerLimitExceededError(
      `Job "${typeName}" declares ${blockerCount} blockers, exceeding the limit of ${limit}`,
      { typeName, count: blockerCount, limit },
    );
  }
};

const prepareJob = (helpers: Helpers, entry: PreparedJob["entry"]): PreparedJob => {
  assertBlockerLimit(helpers, entry.typeName, entry.blockers?.length ?? 0);
  return {
    entry,
    id: resolveJobId(helpers.stateAdapter.config, entry.id),
    encodedInput: helpers.jobTypes.encodeInput(entry.typeName, entry.input),
    jobSpan: undefined,
  };
};

const noChains: (StateChain | undefined)[] = [];

const lockBlockerChains = syncAsync(function* (
  helpers: Helpers,
  {
    items,
    itemIndexOf,
    txCtx,
    effects,
  }: {
    items: PreparedJob[];
    itemIndexOf?: (index: number) => number;
    txCtx: BaseTxContext;
    effects: TxEffects;
  },
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
  effects.notify({
    lockedPendingJobs: lockedChains.flatMap((chain) =>
      chain?.head.status === "pending" ? [chain.head] : [],
    ),
  });

  if (blockerChainIds.length > 0) {
    const missingChainIds = [
      ...new Set(blockerChainIds.filter((_, index) => lockedChains[index] === undefined)),
    ];
    if (missingChainIds.length > 0) {
      throw new ChainsNotFoundError(`Chains not found: ${missingChainIds.join(", ")}`, {
        chainIds: missingChainIds,
      });
    }
    assertChainsTypeName(lockedChains, {
      chainIds: blockerChainIds,
      typeNames: items.flatMap((item) =>
        (item.entry.blockers ?? []).map((blocker) => blocker.typeName),
      ),
    });
  }

  const fetched = lockedChains.values();
  const locked = mapItems(
    items,
    (item): LockedJob => {
      const blockerChains = (item.entry.blockers ?? []).map(() => fetched.next().value!);
      helpers.jobTypes.validateBlockers(
        item.entry.typeName,
        blockerChains.map((blockerChain) => ({
          typeName: blockerChain.typeName,
          input: helpers.jobTypes.decodeInput(blockerChain.head.typeName, blockerChain.head.input),
        })),
      );
      return { ...item, blockerChains };
    },
    itemIndexOf,
  );
  return locked;
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
  { isChainHead, effects }: { isChainHead: boolean; effects: TxEffects },
): void => {
  for (const item of items) {
    for (const { blockerChain, blockerSpan } of item.blockerSpans) {
      if (!blockerSpan) continue;
      effects.onCommit(() => {
        blockerSpan.end({ blockerChainTraceContext: blockerChain.traceContext });
      });
      if (blockerChain.completedAt !== null) {
        effects.onCommit(() => {
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
      effects.onCommit(() => {
        jobSpan.end({ status: "created", chainId: chain.id, jobId: job.id });
      });
      effects.onRollback(() => {
        jobSpan.end({ status: "error", error: new Error("savepoint rolled back") });
      });
    }

    if (isChainHead) {
      effects.onCommit(() => {
        helpers.observabilityHelper.chainCreated(chain, { input: job.input });
      });
    }

    const stateJob: StateJob = { ...job, chain };
    effects.onCommit(() => {
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
    effects.onCommit(() => {
      helpers.observabilityHelper.jobBlocked(stateJob, {
        blockedByChains: incompleteBlockerChains,
      });
    });
  }

  effects.notify({ jobsScheduled: scheduledTypeNames });
};

type CreateChainsOptions = { chains: PreparedJob["entry"][]; txCtx: BaseTxContext };

export const runCreateChains: SyncAsync<
  [helpers: Helpers, options: CreateChainsOptions],
  (Chain<string, string, unknown, unknown> & { deduplicated: boolean })[]
> = syncAsync(function* (helpers: Helpers, { chains, txCtx }: CreateChainsOptions) {
  if (chains.length === 0) return [];

  for (const chain of chains) {
    const scope: unknown = chain.deduplication?.scope;
    if (chain.deduplication != null && scope !== "running" && scope !== "any") {
      throw new TypeError(
        `Invalid deduplication scope ${JSON.stringify(scope)}: expected "running" or "any" ("incomplete" was renamed to "running")`,
      );
    }
  }

  const prepared = mapItems(chains, (chain) => {
    helpers.jobTypes.validateEntry(chain.typeName);
    return prepareJob(helpers, chain);
  });
  for (const item of prepared) {
    item.jobSpan = helpers.observabilityHelper.startJobSpan(item.entry.typeName, null);
  }
  const effects = createTxEffects();
  try {
    const locked = yield* lockBlockerChains.steps(helpers, { items: prepared, txCtx, effects });
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
    reportCreatedJobs(helpers, created, { isChainHead: true, effects });
    const chainsCreated = createdChains.map(
      (createdChain): Chain<string, string, unknown, unknown> & { deduplicated: boolean } => ({
        ...mapStateChainToChain(createdChain, helpers.jobTypes),
        deduplicated: createdChain.deduplicated,
      }),
    );
    registerTxEffects(helpers, txCtx, effects);
    return chainsCreated;
  } catch (error) {
    for (const { jobSpan } of prepared) {
      jobSpan?.end({ status: "error", error });
    }
    registerTxEffectsAfterError(helpers, txCtx, effects);
    throw error;
  }
});

export const runDeleteChains: SyncAsync<
  [helpers: Helpers, options: { chainIds: string[]; txCtx: BaseTxContext }],
  StateChain[]
> = syncAsync(function* (
  helpers: Helpers,
  { chainIds, txCtx }: { chainIds: string[]; txCtx: BaseTxContext },
) {
  const lockedTails = yield* step(
    helpers.stateAdapter.getChainTails({
      txCtx,
      chainIds: [...new Set(chainIds)],
      lock: "exclusive",
    }),
  );

  const effects = createTxEffects();
  effects.notify({
    lockedPendingJobs: lockedTails.flatMap((tail) => (tail?.status === "pending" ? [tail] : [])),
  });
  try {
    const referencedChainIds = lockedTails.flatMap((tail) =>
      tail?.chain.blocking ? [tail.chainId] : [],
    );
    if (referencedChainIds.length > 0) {
      throw new BlockerReferenceError(
        `Cannot delete chains: ${referencedChainIds.join(", ")} referenced as blockers`,
        { chainIds: referencedChainIds },
      );
    }

    const deleted = yield* step(helpers.stateAdapter.deleteChains({ txCtx, chainIds }));
    const deletedChains = deleted.filter((chain) => chain !== undefined);
    for (const stateChain of deletedChains) {
      effects.onCommit(() => {
        helpers.observabilityHelper.chainDeleted(stateChain);
      });
    }
    const deletedJobs = deletedChains.flatMap((stateChain) =>
      stateChain.tail ? [stateChain.head, stateChain.tail] : [stateChain.head],
    );
    effects.notify({
      settledJobIds: deletedJobs.map((stateJob) => stateJob.id),
      jobAttemptsLost: deletedJobs.flatMap((stateJob) =>
        stateJob.status === "running" ? [stateJob.id] : [],
      ),
    });
    registerTxEffects(helpers, txCtx, effects);
    return deletedChains;
  } catch (error) {
    registerTxEffectsAfterError(helpers, txCtx, effects);
    throw error;
  }
});

const reportCompletedJob = syncAsync(function* (
  helpers: Helpers,
  {
    completed,
    encodedOutput,
    txCtx,
    effects,
  }: { completed: StateJob; encodedOutput: unknown; txCtx: BaseTxContext; effects: TxEffects },
) {
  const { chain } = completed;

  effects.onCommit(() => {
    helpers.observabilityHelper.jobCompleted(completed, { output: encodedOutput });
  });
  effects.onCommit(() => {
    helpers.observabilityHelper.chainCompleted(chain, { output: encodedOutput });
  });
  effects.notify({ chainsCompleted: [completed.chainId] });

  if (!chain.blocking) return;
  const dependentJobs = yield* step(
    helpers.stateAdapter.unblockJobs({
      txCtx,
      blockedByChainId: chain.id,
    }),
  );
  reportUnblockedJobs(helpers, { chain, dependentJobs, effects });
});

const reportUnblockedJobs = (
  helpers: Helpers,
  {
    chain,
    dependentJobs,
    effects,
  }: { chain: StateChainInfo; dependentJobs: StateDependentJob[]; effects: TxEffects },
): void => {
  if (dependentJobs.length === 0) return;
  for (const { traceContext } of dependentJobs) {
    if (traceContext === null) continue;
    effects.onCommit(() => {
      helpers.observabilityHelper.completeBlockerSpan(traceContext, chain);
    });
  }

  const unblockedJobs = new Map(
    dependentJobs
      .filter((dependentJob) => dependentJob.job.status === "pending")
      .map((dependentJob) => [dependentJob.job.id, dependentJob.job]),
  );

  effects.notify({
    jobsScheduled: [...unblockedJobs.values()].map((stateJob) => stateJob.typeName),
  });
  for (const stateJob of unblockedJobs.values()) {
    effects.onCommit(() => {
      helpers.observabilityHelper.jobUnblocked(stateJob, { unblockedByChain: chain });
    });
  }
};

type OutcomeItem = {
  job: StateJob;
  outcome: AnyJobOutcome;
  attemptToken?: string;
  workerId?: string;
  backoffConfig?: BackoffConfig;
};

export type OutcomeJob = StateJob & { continuation?: StateJobInfo };

export const jobOutcomeKeys: readonly (keyof AnyJobOutcomeFields)[] = [
  "output",
  "continueWith",
  "reschedule",
];

export const batchJobOutcomeKeys: readonly (keyof AnyJobOutcomeFields)[] = [
  ...jobOutcomeKeys,
  "fail",
];

export const parseJobOutcome = (
  options: AnyJobOutcomeFields,
  { method, outcomeKeys }: { method: string; outcomeKeys: readonly (keyof AnyJobOutcomeFields)[] },
): AnyJobOutcome => {
  const presentKeys = batchJobOutcomeKeys.filter((key) => key in options);
  if (presentKeys.length !== 1 || !outcomeKeys.includes(presentKeys[0])) {
    throw new Error(
      `${method} requires exactly one of ${outcomeKeys.slice(0, -1).join(", ")} or ${outcomeKeys.at(-1)}`,
    );
  }
  if (options.reason !== undefined && !("reschedule" in options)) {
    throw new Error(`${method} accepts reason only together with reschedule`);
  }
  if ("reschedule" in options) return { reschedule: options.reschedule!, reason: options.reason };
  if ("continueWith" in options) return { continueWith: options.continueWith! };
  if (presentKeys[0] === "fail") return { fail: options.fail };
  return { output: options.output };
};

const completeOutputItems = syncAsync(function* (
  helpers: Helpers,
  {
    items,
    encodedOutputs,
    txCtx,
    effects,
  }: {
    items: OutcomeItem[];
    encodedOutputs: unknown[];
    txCtx: BaseTxContext;
    effects: TxEffects;
  },
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
      effects,
    });
  }
  return completedJobs;
});

const continueItems = syncAsync(function* (
  helpers: Helpers,
  {
    items,
    prepared,
    itemIndexOf,
    txCtx,
    effects,
  }: {
    items: OutcomeItem[];
    prepared: PreparedJob[];
    itemIndexOf?: (index: number) => number;
    txCtx: BaseTxContext;
    effects: TxEffects;
  },
) {
  prepared.forEach((item, index) => {
    item.jobSpan = helpers.observabilityHelper.startJobSpan(item.entry.typeName, items[index].job);
  });
  try {
    const locked = yield* lockBlockerChains.steps(helpers, {
      items: prepared,
      itemIndexOf,
      txCtx,
      effects,
    });
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
    reportCreatedJobs(helpers, created, { isChainHead: false, effects });

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
      effects.onCommit(() => {
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
  { items, txCtx, effects }: { items: OutcomeItem[]; txCtx: BaseTxContext; effects: TxEffects },
) {
  const rescheduledJobs = yield* step(
    helpers.stateAdapter.rescheduleJobs({
      txCtx,
      jobs: items.map(({ job, outcome, attemptToken, backoffConfig }) => {
        if ("fail" in outcome) {
          return {
            jobId: job.id,
            schedule: { afterMs: calculateBackoffMs(job.consecutiveFailures + 1, backoffConfig!) },
            error: serializeError(outcome.fail),
            attemptToken,
          };
        }
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
    effects,
  });
  return rescheduledJobs;
});

export const runApplyJobOutcomes: SyncAsync<
  [helpers: Helpers, options: { items: OutcomeItem[]; txCtx: BaseTxContext; effects: TxEffects }],
  (OutcomeJob | undefined)[]
> = syncAsync(function* (
  helpers: Helpers,
  { items, txCtx, effects }: { items: OutcomeItem[]; txCtx: BaseTxContext; effects: TxEffects },
) {
  const prepared = mapItems(items, ({ job, outcome }) => {
    if ("output" in outcome) return helpers.jobTypes.encodeOutput(job.typeName, outcome.output);
    if (!("continueWith" in outcome)) return undefined;
    const { continueWith } = outcome;
    helpers.jobTypes.validateContinueWith(job.typeName, {
      typeName: continueWith.typeName,
      input: continueWith.input,
    });
    return prepareJob(helpers, continueWith);
  });
  const outputItems = items.filter(({ outcome }) => "output" in outcome);
  const continueWithItems = items.filter(({ outcome }) => "continueWith" in outcome);
  const reschedulesItems = items.filter(
    ({ outcome }) => "reschedule" in outcome || "fail" in outcome,
  );
  const encodedOutputs =
    outputItems.length === items.length
      ? prepared
      : prepared.filter((_, index) => "output" in items[index].outcome);

  const written: (OutcomeJob | undefined)[] = [
    ...(continueWithItems.length > 0
      ? yield* continueItems.steps(helpers, {
          items: continueWithItems,
          prepared: (continueWithItems.length === items.length
            ? prepared
            : prepared.filter(
                (_, index) => "continueWith" in items[index].outcome,
              )) as PreparedJob[],
          itemIndexOf:
            continueWithItems.length === items.length
              ? undefined
              : (index) => items.indexOf(continueWithItems[index]),
          txCtx,
          effects,
        })
      : []),
    ...(outputItems.length > 0
      ? yield* completeOutputItems.steps(helpers, {
          items: outputItems,
          encodedOutputs,
          txCtx,
          effects,
        })
      : []),
    ...(reschedulesItems.length > 0
      ? yield* rescheduleItems.steps(helpers, { items: reschedulesItems, txCtx, effects })
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
    effects,
  }: {
    rescheduledJobs: (StateJob | undefined)[];
    scheduledJobs: (StateJob | undefined)[];
    effects: TxEffects;
  },
): void => {
  effects.notify({
    jobsScheduled: scheduledJobs.flatMap((job) => (job === undefined ? [] : [job.typeName])),
  });
  for (const job of rescheduledJobs) {
    if (job === undefined) continue;
    effects.onCommit(() => {
      helpers.observabilityHelper.jobRescheduled(job);
    });
  }
};
