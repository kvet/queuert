import { type Chain, mapStateChainToChain } from "./entities/chain.ts";
import type { DeduplicationOptions } from "./entities/deduplication.ts";
import type { ScheduleOptions } from "./entities/schedule.ts";
import {
  BlockerLimitExceededError,
  ChainNotFoundError,
  ChainTypeMismatchError,
  JobNotFoundError,
} from "./errors.ts";
import type { AnyNewJob } from "./job-types/job-types.resolvers.ts";
import type {
  BlockerSpanHandle,
  JobSpanHandle,
} from "./observability-adapter/observability-adapter.ts";
import type { Helpers } from "./setup-helpers.ts";
import { resolveJobId } from "./state-adapter/adapter-config.ts";
import type {
  BaseTxContext,
  StateChain,
  StateChainInfo,
  StateJob,
  StateJobInfo,
} from "./state-adapter/state-adapter.ts";
import type { TxHooks } from "./tx-hooks/tx-hooks.ts";

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

const lockBlockerChains = async <TItem extends { entry: AnyNewJob }>(
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

  const updatedRows = await helpers.stateAdapter.addJobsBlockers({
    txCtx,
    jobBlockers: blockedItems.map((item) => ({
      jobId: item.job.id,
      blockedByChainIds: item.blockerChains.map((blockerChain) => blockerChain.id),
      blockerTraceContexts: item.blockerSpans.map(
        ({ blockerSpan }) => blockerSpan?.traceContext ?? null,
      ),
    })),
  });

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
  { isChainHead, txHooks }: { isChainHead: boolean; txHooks: TxHooks },
): void => {
  for (const { blockerChain, blockerSpan } of items.flatMap((item) => item.blockerSpans)) {
    if (!blockerSpan) continue;
    txHooks.onCommit(() => {
      blockerSpan.end({ blockerChainTraceContext: blockerChain.traceContext });
    });
    if (blockerChain.completedAt !== null) {
      txHooks.onCommit(() => {
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
      txHooks.onCommit(() => {
        jobSpan.end({ status: "created", chainId: chain.id, jobId: job.id });
      });
      txHooks.onRollback(() => {
        jobSpan.end({ status: "error", error: new Error("savepoint rolled back") });
      });
    }

    if (isChainHead) {
      txHooks.onCommit(() => {
        helpers.observabilityHelper.chainCreated(chain, { input: job.input });
      });
    }

    const stateJob: StateJob = { ...job, chain };
    txHooks.onCommit(() => {
      helpers.observabilityHelper.jobCreated(stateJob, {
        blockers: blockerChains,
      });
    });

    const incompleteBlockerChains = blockerChains.filter(
      (blockerChain) => blockerChain.completedAt === null,
    );
    if (incompleteBlockerChains.length > 0) {
      txHooks.onCommit(() => {
        helpers.observabilityHelper.jobBlocked(stateJob, {
          blockedByChains: incompleteBlockerChains,
        });
      });
    }
  }

  helpers.notifyHelper.notifyJobsScheduled(
    txHooks,
    items
      .filter(
        ({ deduplicated, blockerChains }) =>
          !deduplicated && blockerChains.every((blockerChain) => blockerChain.completedAt !== null),
      )
      .map(({ job }) => job.typeName),
  );
};

export const createChains = async (
  helpers: Helpers,
  {
    chains,
    txCtx,
    txHooks,
  }: {
    chains: (AnyNewJob & { deduplication?: DeduplicationOptions })[];
    txCtx: BaseTxContext;
    txHooks: TxHooks;
  },
): Promise<(Chain<string, string, unknown, unknown> & { deduplicated: boolean })[]> => {
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
    const locked = await lockBlockerChains(helpers, { items: prepared, txCtx });
    const createdChains = await helpers.stateAdapter.createJobs({
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
    });
    const created = await addJobsBlockers(helpers, {
      txCtx,
      items: locked.map((item, index) => {
        const createdChain = createdChains[index];
        const { head, tail: _tail, deduplicated, ...chain } = createdChain;
        return { ...item, job: head, chain, deduplicated, createdChain };
      }),
    });

    reportCreatedJobs(helpers, created, { isChainHead: true, txHooks });

    return created.map(({ createdChain }) => ({
      ...mapStateChainToChain(createdChain, helpers.jobTypes),
      deduplicated: createdChain.deduplicated,
    }));
  } catch (error) {
    for (const { jobSpan } of prepared) {
      jobSpan?.end({ status: "error", error });
    }
    throw error;
  }
};

export const completeChain = async (
  helpers: Helpers,
  {
    job,
    output,
    txCtx,
    txHooks,
    attemptToken,
    workerId,
  }: {
    job: StateJob;
    output: unknown;
    txCtx: BaseTxContext;
    txHooks: TxHooks;
    attemptToken: string | null;
    workerId: string | null;
  },
): Promise<StateJob | undefined> => {
  const encodedOutput = helpers.jobTypes.encodeOutput(job.typeName, output);

  const [completed] = await helpers.stateAdapter.completeJobs({
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
  if (!completed) return undefined;
  const { chain } = completed;

  txHooks.onCommit(() => {
    helpers.observabilityHelper.jobCompleted(completed, { output: encodedOutput });
  });
  txHooks.onCommit(() => {
    helpers.observabilityHelper.chainCompleted(chain, { output: encodedOutput });
  });
  helpers.notifyHelper.notifyChainsCompleted(txHooks, [completed.chainId]);

  const dependentJobs = await helpers.stateAdapter.unblockJobs({
    txCtx,
    blockedByChainId: chain.id,
  });

  for (const { traceContext } of dependentJobs) {
    if (traceContext === null) continue;
    txHooks.onCommit(() => {
      helpers.observabilityHelper.completeBlockerSpan(traceContext, chain);
    });
  }

  const unblockedJobs = new Map(
    dependentJobs
      .filter((dependentJob) => dependentJob.job.status === "pending")
      .map((dependentJob) => [dependentJob.job.id, dependentJob.job]),
  );

  helpers.notifyHelper.notifyJobsScheduled(
    txHooks,
    [...unblockedJobs.values()].map((stateJob) => stateJob.typeName),
  );
  for (const stateJob of unblockedJobs.values()) {
    txHooks.onCommit(() => {
      helpers.observabilityHelper.jobUnblocked(stateJob, { unblockedByChain: chain });
    });
  }

  return completed;
};

export const continueChain = async (
  helpers: Helpers,
  {
    job,
    continueWith,
    txCtx,
    txHooks,
    attemptToken,
    workerId,
  }: {
    job: StateJob;
    continueWith: AnyNewJob;
    txCtx: BaseTxContext;
    txHooks: TxHooks;
    attemptToken: string | null;
    workerId: string | null;
  },
): Promise<(StateJob & { continuation: StateJobInfo }) | undefined> => {
  helpers.jobTypes.validateContinueWith(job.typeName, {
    typeName: continueWith.typeName,
    input: continueWith.input,
  });

  const prepared = prepareJobs(helpers, [continueWith], job);
  const [{ jobSpan }] = prepared;
  try {
    const locked = await lockBlockerChains(helpers, { items: prepared, txCtx });
    const [continued] = await helpers.stateAdapter.continueJobs({
      txCtx,
      jobs: locked.map((item) => ({
        id: item.id,
        typeName: item.entry.typeName,
        input: item.encodedInput,
        schedule: item.entry.schedule,
        traceContext: item.jobSpan?.traceContext ?? null,
        continueFromId: job.id,
        attemptToken: attemptToken ?? undefined,
        workerId: workerId ?? undefined,
      })),
    });
    if (!continued) {
      const error = new JobNotFoundError(`Job ${job.id} not found or already completed`, {
        jobId: job.id,
      });
      jobSpan?.end({ status: "error", error });
      return undefined;
    }
    const created = await addJobsBlockers(helpers, {
      txCtx,
      items: locked.map((item) => ({
        ...item,
        job: continued.continuation,
        chain: continued.chain,
        deduplicated: false,
      })),
    });

    reportCreatedJobs(helpers, created, { isChainHead: false, txHooks });

    const [{ job: continuation }] = created;
    const completed = { ...continued, continuation };
    txHooks.onCommit(() => {
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
};

export const rescheduleJobs = async (
  helpers: Helpers,
  {
    jobs,
    txCtx,
    txHooks,
  }: {
    jobs: {
      jobId: string;
      schedule?: ScheduleOptions;
      error?: string;
      attemptToken?: string;
    }[];
    txCtx?: BaseTxContext;
    txHooks: TxHooks;
  },
): Promise<(StateJob | undefined)[]> => {
  const rescheduledJobs = await helpers.stateAdapter.rescheduleJobs({ txCtx, jobs });

  helpers.notifyHelper.notifyJobsScheduled(
    txHooks,
    rescheduledJobs.flatMap((job) => (job === undefined ? [] : [job.typeName])),
  );
  for (const job of rescheduledJobs) {
    if (job === undefined) continue;
    txHooks.onCommit(() => {
      helpers.observabilityHelper.jobRescheduled(job);
    });
  }

  return rescheduledJobs;
};
