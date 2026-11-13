import { type MaybePromise, andThen, isPromise, tryCatch } from "@queuert/helpers/maybe-promise";
import { silence } from "@queuert/helpers/promise";

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

const prepareJobs = <TEntry extends AnyNewJob>(
  helpers: Helpers,
  entries: TEntry[],
  fromJob: StateJob | null,
): { entry: TEntry; id: string; encodedInput: unknown; jobSpan: JobSpanHandle | undefined }[] => {
  const prepared = entries.map((entry) => {
    assertBlockerLimit(helpers, entry.typeName, entry.blockers?.length ?? 0);
    return {
      entry,
      id: resolveJobId(helpers.stateAdapter.config, entry.id),
      encodedInput: helpers.jobTypes.encodeInput(entry.typeName, entry.input),
      jobSpan: undefined as JobSpanHandle | undefined,
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

const lockBlockerChains = <TItem extends { entry: AnyNewJob }>(
  helpers: Helpers,
  { items, txCtx }: { items: TItem[]; txCtx: BaseTxContext },
): MaybePromise<(TItem & { blockerChains: StateChain[] })[]> => {
  const blockerChainIds = items.flatMap((item) =>
    (item.entry.blockers ?? []).map((blocker) => blocker.id),
  );
  const blockerChains: MaybePromise<(StateChain | undefined)[]> =
    blockerChainIds.length > 0
      ? helpers.stateAdapter.getChains({
          txCtx,
          chainIds: blockerChainIds,
          lock: "exclusive",
        })
      : noChains;

  return andThen(blockerChains, (lockedChains) =>
    resolveBlockerChains(helpers, items, lockedChains),
  );
};

const resolveBlockerChains = <TItem extends { entry: AnyNewJob }>(
  helpers: Helpers,
  items: TItem[],
  blockerChains: (StateChain | undefined)[],
): (TItem & { blockerChains: StateChain[] })[] => {
  const fetched = blockerChains.values();
  return items.map((item) => {
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
};

const addJobsBlockers = <TItem extends CreatedJob>(
  helpers: Helpers,
  { items, txCtx }: { items: TItem[]; txCtx: BaseTxContext },
): MaybePromise<(TItem & { blockerSpans: BlockerSpan[] })[]> => {
  const isBlocked = (item: TItem) => !item.deduplicated && item.blockerChains.length > 0;

  const itemsWithBlockerSpans = items.map((item) => {
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

  const updatedRows = helpers.stateAdapter.addJobsBlockers({
    txCtx,
    jobBlockers: blockedItems.map((item) => ({
      jobId: item.job.id,
      blockedByChainIds: item.blockerChains.map((blockerChain) => blockerChain.id),
      blockerTraceContexts: item.blockerSpans.map(
        ({ blockerSpan }) => blockerSpan?.traceContext ?? null,
      ),
    })),
  });

  return andThen(updatedRows, (blockedRows) => {
    const rows = blockedRows.values();
    return itemsWithBlockerSpans.map((item) => {
      const updatedRow = isBlocked(item) ? rows.next().value : undefined;
      if (updatedRow === undefined) return item;
      const { chain: _chain, blockers: _blockers, ...updatedJob } = updatedRow;
      return { ...item, job: updatedJob };
    });
  });
};

const reportCreatedJobs = (
  helpers: Helpers,
  items: (CreatedJob & { blockerSpans: BlockerSpan[] })[],
  { isChainHead, txCtx }: { isChainHead: boolean; txCtx: BaseTxContext },
): void => {
  for (const { blockerChain, blockerSpan } of items.flatMap((item) => item.blockerSpans)) {
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

    const incompleteBlockerChains = blockerChains.filter(
      (blockerChain) => blockerChain.completedAt === null,
    );
    if (incompleteBlockerChains.length > 0) {
      helpers.stateAdapter.onTransactionCommit(txCtx, () => {
        helpers.observabilityHelper.jobBlocked(stateJob, {
          blockedByChains: incompleteBlockerChains,
        });
      });
    }
  }

  notifyOnCommit(
    helpers,
    txCtx,
    helpers.notifyHelper.notifyJobsScheduled,
    items
      .filter(
        ({ deduplicated, blockerChains }) =>
          !deduplicated && blockerChains.every((blockerChain) => blockerChain.completedAt !== null),
      )
      .map(({ job }) => job.typeName),
  );
};

export const runCreateChains = (
  helpers: Helpers,
  {
    chains,
    txCtx,
  }: {
    chains: (AnyNewJob & { deduplication?: DeduplicationOptions })[];
    txCtx: BaseTxContext;
  },
): MaybePromise<(Chain<string, string, unknown, unknown> & { deduplicated: boolean })[]> => {
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
  const createChains = () =>
    andThen(lockBlockerChains(helpers, { items: prepared, txCtx }), (locked) =>
      andThen(
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
        (createdChains) =>
          addJobsBlockers(helpers, {
            txCtx,
            items: locked.map((item, index) => {
              const createdChain = createdChains[index];
              const { head, tail: _tail, deduplicated, ...chain } = createdChain;
              return { ...item, job: head, chain, deduplicated, createdChain };
            }),
          }),
      ),
    );

  return tryCatch(
    () =>
      andThen(createChains(), (created) => {
        reportCreatedJobs(helpers, created, { isChainHead: true, txCtx });

        return created.map(({ createdChain }) => ({
          ...mapStateChainToChain(createdChain, helpers.jobTypes),
          deduplicated: createdChain.deduplicated,
        }));
      }),
    (error) => {
      for (const { jobSpan } of prepared) {
        jobSpan?.end({ status: "error", error });
      }
      // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
      throw error;
    },
  );
};

export const runCompleteChain = (
  helpers: Helpers,
  {
    job,
    output,
    txCtx,
    attemptToken,
    workerId,
  }: {
    job: StateJob;
    output: unknown;
    txCtx: BaseTxContext;
    attemptToken: string | null;
    workerId: string | null;
  },
): MaybePromise<StateJob | undefined> => {
  const encodedOutput = helpers.jobTypes.encodeOutput(job.typeName, output);

  const completedJobs = helpers.stateAdapter.completeJobs({
    txCtx,
    jobs: [
      {
        jobId: job.id,
        output: encodedOutput,
        attemptToken: attemptToken ?? undefined,
        workerId: workerId ?? undefined,
      },
    ],
  });
  return andThen(completedJobs, ([completed]) =>
    completed === undefined
      ? undefined
      : andThen(reportCompletedJob(helpers, { completed, encodedOutput, txCtx }), () => completed),
  );
};

const reportCompletedJob = (
  helpers: Helpers,
  {
    completed,
    encodedOutput,
    txCtx,
  }: { completed: StateJob; encodedOutput: unknown; txCtx: BaseTxContext },
): MaybePromise<void> => {
  const { chain } = completed;

  helpers.stateAdapter.onTransactionCommit(txCtx, () => {
    helpers.observabilityHelper.jobCompleted(completed, { output: encodedOutput });
  });
  helpers.stateAdapter.onTransactionCommit(txCtx, () => {
    helpers.observabilityHelper.chainCompleted(chain, { output: encodedOutput });
  });
  notifyOnCommit(helpers, txCtx, helpers.notifyHelper.notifyChainsCompleted, [completed.chainId]);

  return andThen(
    helpers.stateAdapter.unblockJobs({
      txCtx,
      blockedByChainId: chain.id,
    }),
    (dependentJobs) => {
      reportUnblockedJobs(helpers, { chain, dependentJobs, txCtx });
    },
  );
};

const reportUnblockedJobs = (
  helpers: Helpers,
  {
    chain,
    dependentJobs,
    txCtx,
  }: { chain: StateChainInfo; dependentJobs: StateDependentJob[]; txCtx: BaseTxContext },
): void => {
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

export const runContinueChain = (
  helpers: Helpers,
  {
    job,
    continueWith,
    txCtx,
    attemptToken,
    workerId,
  }: {
    job: StateJob;
    continueWith: AnyNewJob;
    txCtx: BaseTxContext;
    attemptToken: string | null;
    workerId: string | null;
  },
): MaybePromise<(StateJob & { continuation: StateJobInfo }) | undefined> => {
  helpers.jobTypes.validateContinueWith(job.typeName, {
    typeName: continueWith.typeName,
    input: continueWith.input,
  });

  const prepared = prepareJobs(helpers, [continueWith], job);
  const [{ jobSpan }] = prepared;
  const continueJob = (
    locked: (typeof prepared)[number] & { blockerChains: StateChain[] },
    continued: StateJob & { continuation: StateJobInfo },
  ) =>
    andThen(
      addJobsBlockers(helpers, {
        txCtx,
        items: [
          {
            ...locked,
            job: continued.continuation,
            chain: continued.chain,
            deduplicated: false,
          },
        ],
      }),
      (created) => {
        reportCreatedJobs(helpers, created, { isChainHead: false, txCtx });

        const [{ job: continuation }] = created;
        const completed = { ...continued, continuation };
        helpers.stateAdapter.onTransactionCommit(txCtx, () => {
          helpers.observabilityHelper.jobCompleted(completed, {
            output: null,
            continuedWith: continuation,
          });
        });
        return completed;
      },
    );

  return tryCatch(
    () =>
      andThen(lockBlockerChains(helpers, { items: prepared, txCtx }), ([locked]) =>
        andThen(
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
          ([continued]) => {
            if (!continued) {
              const error = new JobNotFoundError(`Job ${job.id} not found or already completed`, {
                jobId: job.id,
              });
              jobSpan?.end({ status: "error", error });
              return undefined;
            }
            return continueJob(locked, continued);
          },
        ),
      ),
    (error) => {
      jobSpan?.end({ status: "error", error });
      // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
      throw error;
    },
  );
};

export const runRescheduleJobs = (
  helpers: Helpers,
  {
    jobs,
    txCtx,
  }: {
    jobs: {
      jobId: string;
      schedule?: ScheduleOptions;
      error?: string;
      attemptToken?: string;
    }[];
    txCtx: BaseTxContext;
  },
): MaybePromise<(StateJob | undefined)[]> =>
  andThen(helpers.stateAdapter.rescheduleJobs({ txCtx, jobs }), (rescheduledJobs) => {
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
