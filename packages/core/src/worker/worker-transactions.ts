import { type MaybePromise, all, andThen } from "@queuert/helpers/maybe-promise";
import { serializeError } from "@queuert/helpers/serialize-error";

import { notifyOnCommit } from "../client/implementation.ts";
import { type Helpers, withHelpersTransaction } from "../client/setup-helpers.ts";
import type { Page } from "../entities/pagination.ts";
import { JobAttemptReclaimedError, WorkerAlreadyLiveError } from "../errors.ts";
import type { BaseTxContext, StateJob, StateWorkerInfo } from "../state-adapter/state-adapter.ts";

type ReclaimedJob = { reclaimed: StateJob; rescheduled: StateJob };

const listRunningJobs = (
  { stateAdapter }: Helpers,
  { txCtx, workerId }: { txCtx: unknown; workerId: string },
): MaybePromise<StateJob[]> => {
  const jobs: StateJob[] = [];
  const listFrom = (cursor: string | undefined): MaybePromise<StateJob[]> =>
    andThen(
      stateAdapter.listWorkerJobs({
        txCtx,
        workerId,
        orderDirection: "asc",
        page: { cursor, limit: 100 },
      }) as MaybePromise<Page<StateJob>>,
      (page) => {
        jobs.push(...page.items);
        return page.nextCursor === null ? jobs : listFrom(page.nextCursor);
      },
    );
  return listFrom(undefined);
};

const reclaimWorkerJobs = (
  helpers: Helpers,
  {
    txCtx,
    workerId,
    reclaimedBy,
    keepAttemptTokens,
    message,
  }: {
    txCtx: unknown;
    workerId: string;
    reclaimedBy: string;
    keepAttemptTokens?: Set<string>;
    message: string;
  },
): MaybePromise<ReclaimedJob[]> =>
  andThen(listRunningJobs(helpers, { txCtx, workerId }), (listedJobs) => {
    const runningJobs = listedJobs.filter(
      (job) => keepAttemptTokens === undefined || !keepAttemptTokens.has(job.attemptToken!),
    );
    if (runningJobs.length === 0) return [];
    const error = serializeError(new JobAttemptReclaimedError(message, { reclaimedBy }));
    return andThen(
      helpers.stateAdapter.rescheduleJobs({
        txCtx,
        jobs: runningJobs.map((job) => ({
          jobId: job.id,
          attemptToken: job.attemptToken!,
          error,
        })),
      }),
      (rescheduledJobs) =>
        runningJobs.flatMap((reclaimed, index) => {
          const rescheduled = rescheduledJobs[index];
          return rescheduled === undefined ? [] : [{ reclaimed, rescheduled }];
        }),
    );
  });

const observeReclaimed = (
  { observabilityHelper }: Helpers,
  { reclaimed, rescheduled }: ReclaimedJob,
  workerId: string,
): void => {
  observabilityHelper.jobAttemptReclaimed(reclaimed, {
    workerId,
    reclaimedFrom: reclaimed.attemptBy!,
  });
  observabilityHelper.jobRescheduled(rescheduled);
};

const announceReclaimed = (
  helpers: Helpers,
  txCtx: BaseTxContext,
  { jobs, workerId }: { jobs: ReclaimedJob[]; workerId: string },
): void => {
  const { notifyHelper } = helpers;
  for (const job of jobs) {
    helpers.stateAdapter.onTransactionCommit(txCtx, () => {
      observeReclaimed(helpers, job, workerId);
    });
  }
  notifyOnCommit(
    helpers,
    txCtx,
    notifyHelper.notifyJobAttemptsLost,
    jobs.map(({ reclaimed }) => reclaimed.id),
  );
  notifyOnCommit(
    helpers,
    txCtx,
    notifyHelper.notifyJobsScheduled,
    jobs.map(({ reclaimed }) => reclaimed.typeName),
  );
};

const announceReclaimedNow = async (
  helpers: Helpers,
  { jobs, workerId }: { jobs: ReclaimedJob[]; workerId: string },
): Promise<void> => {
  for (const job of jobs) {
    observeReclaimed(helpers, job, workerId);
  }
  await notifyReclaimed(helpers.notifyHelper, {
    jobIds: jobs.map(({ reclaimed }) => reclaimed.id),
    typeNames: jobs.map(({ reclaimed }) => reclaimed.typeName),
  });
};

/** Sends the attempt-lost and scheduled notifications for reclaimed jobs at once. */
export const notifyReclaimed = (
  notifyHelper: Helpers["notifyHelper"],
  { jobIds, typeNames }: { jobIds: string[]; typeNames: string[] },
): MaybePromise<void> =>
  andThen(
    all<void>([
      notifyHelper.notifyJobAttemptsLost(jobIds),
      notifyHelper.notifyJobsScheduled(typeNames),
    ]),
    () => undefined,
  );

const lockWorker = (
  { stateAdapter }: Helpers,
  { txCtx, workerId }: { txCtx: unknown; workerId: string },
): MaybePromise<StateWorkerInfo | undefined> =>
  andThen(
    stateAdapter.getWorkers({
      txCtx,
      workerIds: [workerId],
      lock: "exclusive",
    }),
    ([worker]) => worker,
  );

export const runRegisterWorker = async (
  helpers: Helpers,
  {
    workerId,
    typeNames,
    concurrency,
    leaseMs,
  }: { workerId: string; typeNames: string[]; concurrency: number; leaseMs: number },
): Promise<{ workerToken: string; flush: () => Promise<void> }> => {
  const { stateAdapter } = helpers;
  const { workerToken, jobs } = await withHelpersTransaction(helpers, (txCtx) =>
    andThen(lockWorker(helpers, { txCtx, workerId }), (existing) => {
      if (existing !== undefined && !existing.expired) {
        throw new WorkerAlreadyLiveError(`Worker "${workerId}" is held by a live worker`, {
          workerId,
        });
      }
      return andThen(
        existing === undefined
          ? undefined
          : stateAdapter.stopWorker({ txCtx, workerId, workerToken: existing.token }),
        () =>
          andThen(
            reclaimWorkerJobs(helpers, {
              txCtx,
              workerId,
              reclaimedBy: workerId,
              message: "Worker holding the attempt lost its lease",
            }),
            (reclaimedJobs) =>
              andThen(
                stateAdapter.startWorker({
                  txCtx,
                  workerId,
                  typeNames,
                  concurrency,
                  leaseMs,
                }),
                (worker) => ({ workerToken: worker.token, jobs: reclaimedJobs }),
              ),
          ),
      );
    }),
  );
  return { workerToken, flush: async () => announceReclaimedNow(helpers, { jobs, workerId }) };
};

export const runReclaimExpiredWorker = async (
  helpers: Helpers,
  { workerId }: { workerId: string },
): Promise<boolean> => {
  const { stateAdapter } = helpers;
  const { items: candidates } = await stateAdapter.listWorkers({
    status: "expired",
    orderDirection: "asc",
    page: { limit: 8 },
  });
  if (candidates.length === 0) return false;
  const candidate = candidates[Math.floor(Math.random() * candidates.length)];
  return withHelpersTransaction(helpers, (txCtx) =>
    andThen(lockWorker(helpers, { txCtx, workerId: candidate.id }), (worker) => {
      if (worker === undefined || !worker.expired) return false;
      return andThen(
        stateAdapter.stopWorker({
          txCtx,
          workerId: worker.id,
          workerToken: worker.token,
        }),
        () =>
          andThen(
            reclaimWorkerJobs(helpers, {
              txCtx,
              workerId: worker.id,
              reclaimedBy: workerId,
              message: "Worker holding the attempt lost its lease",
            }),
            (jobs) => {
              announceReclaimed(helpers, txCtx, { jobs, workerId });
              return true;
            },
          ),
      );
    }),
  );
};

export const runReclaimFinishedJobs = async (
  helpers: Helpers,
  {
    workerId,
    workerToken,
    keepAttemptTokens,
  }: { workerId: string; workerToken: string; keepAttemptTokens: Set<string> },
): Promise<boolean> =>
  withHelpersTransaction(helpers, (txCtx) =>
    andThen(lockWorker(helpers, { txCtx, workerId }), (worker) => {
      if (worker?.token !== workerToken) return false;
      return andThen(
        reclaimWorkerJobs(helpers, {
          txCtx,
          workerId,
          reclaimedBy: workerId,
          keepAttemptTokens,
          message: "Worker holding the attempt no longer runs it",
        }),
        (jobs) => {
          announceReclaimed(helpers, txCtx, { jobs, workerId });
          return true;
        },
      );
    }),
  );

export const runStopOwnWorker = async (
  helpers: Helpers,
  { workerId, workerToken }: { workerId: string; workerToken: string },
): Promise<boolean> =>
  withHelpersTransaction(helpers, (txCtx) =>
    andThen(helpers.stateAdapter.stopWorker({ txCtx, workerId, workerToken }), (stopped) => {
      if (stopped === undefined) return false;
      return andThen(
        reclaimWorkerJobs(helpers, {
          txCtx,
          workerId,
          reclaimedBy: workerId,
          message: "Worker holding the attempt stopped",
        }),
        (jobs) => {
          announceReclaimed(helpers, txCtx, { jobs, workerId });
          return true;
        },
      );
    }),
  );

export const runExtendWorkerLease = async (
  { stateAdapter }: Helpers,
  options: { workerId: string; workerToken: string; leaseMs: number },
): Promise<boolean> => (await stateAdapter.extendWorkerLease(options)) !== undefined;

export const runStartJobAttempts = async (
  { stateAdapter }: Helpers,
  options: { typeNames: string[]; workerId: string; workerToken: string; limit: number },
): Promise<(StateJob & { hasBlockers: boolean })[]> => stateAdapter.startJobAttempts(options);

export const runGetStartAttemptDelayMs = async (
  { stateAdapter }: Helpers,
  options: { typeNames: string[] },
): Promise<number | null> => stateAdapter.getStartAttemptDelayMs(options);

export const runListenJobScheduled = async (
  { notifyHelper }: Helpers,
  typeNames: string[],
  onNotification: () => void,
): Promise<() => MaybePromise<void>> => notifyHelper.listenJobScheduled(typeNames, onNotification);
