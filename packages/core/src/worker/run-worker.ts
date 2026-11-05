import {
  type ParallelExecutor,
  createParallelExecutor,
  raceWithSleep,
  serializeError,
  sleep,
} from "@queuert/helpers";

import { type AnyAttemptMiddleware } from "../attempt-middleware/attempt-middleware.js";
import { runAttempt } from "../attempt/attempt-handler.js";
import { type BackoffConfig, calculateBackoffMs } from "../entities/backoff.js";
import {
  JobAttemptReclaimedError,
  WorkerAlreadyLiveError,
  WorkerLeaseLostError,
} from "../errors.js";
import {
  type InProcessWorkerProcessor,
  processorAttemptMiddlewareSymbol,
} from "../job-type-processors/job-type-processors.js";
import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { type Helpers } from "../setup-helpers.js";
import {
  type StateAdapter,
  type StateJob,
  type StateWorkerInfo,
} from "../state-adapter/state-adapter.js";
import { type WorkerLeaseConfig, holdLease } from "./worker-lease.js";

/** Per-processor runtime stamp carrying the middleware tuple of the originating slice. @internal */
export type StampedProcessor = InProcessWorkerProcessor<any, any, any, any> & {
  readonly [processorAttemptMiddlewareSymbol]: readonly AnyAttemptMiddleware[];
};

const waitForNextJob = async ({
  stateAdapter,
  notifyAdapter,
  typeNames,
  pollIntervalMs,
  executor,
  signal,
}: {
  stateAdapter: StateAdapter<any, any, any, any>;
  notifyAdapter: NotifyAdapter;
  typeNames: string[];
  pollIntervalMs: number;
  executor: ParallelExecutor<any>;
  signal: AbortSignal;
}): Promise<void> => {
  const { promise: slotAvailable, resolve: onSlotAvailable } = Promise.withResolvers<void>();
  const disposeSlotAvailable = executor.onIdleSlot(onSlotAvailable);
  try {
    if (signal.aborted) {
      return;
    }

    if (executor.idleSlots() === 0) {
      await raceWithSleep(slotAvailable, pollIntervalMs, {
        jitterMs: pollIntervalMs / 10,
        signal,
      });
      return;
    }

    const { promise: notified, resolve: onNotification } = Promise.withResolvers<void>();
    let disposeNotified: () => Promise<void> = async () => {};
    try {
      disposeNotified = await notifyAdapter.listenJobScheduled(typeNames, () => {
        onNotification();
      });
    } catch {}

    try {
      const startAttemptDelayMs = await stateAdapter.getStartAttemptDelayMs({ typeNames });
      const pullDelayMs = Math.min(startAttemptDelayMs ?? pollIntervalMs, pollIntervalMs);

      if (signal.aborted) {
        return;
      }
      await raceWithSleep(Promise.race([slotAvailable, notified]), pullDelayMs, {
        jitterMs: pullDelayMs / 10,
        signal,
      });
    } finally {
      await disposeNotified();
    }
  } finally {
    disposeSlotAvailable();
  }
};

const listRunningJobs = async (
  stateAdapter: StateAdapter<any, any, any, any>,
  { txCtx, workerId }: { txCtx?: unknown; workerId: string },
): Promise<StateJob[]> => {
  const listPage = async (cursor: string | undefined) =>
    stateAdapter.listWorkerJobs({
      txCtx,
      workerId,
      orderDirection: "asc",
      page: { cursor, limit: 100 },
    });
  const pages = [await listPage(undefined)];
  while (pages.at(-1)!.nextCursor !== null) {
    pages.push(await listPage(pages.at(-1)!.nextCursor!));
  }
  return pages.flatMap((page) => page.items);
};

const reclaimWorkerJobs = async (
  helpers: Helpers,
  {
    txCtx,
    workerId,
    reclaimedBy,
    keepAttemptTokens,
    message,
  }: {
    txCtx?: unknown;
    workerId: string;
    reclaimedBy: string;
    keepAttemptTokens?: Set<string>;
    message: string;
  },
): Promise<StateJob[]> => {
  const { stateAdapter } = helpers;
  const runningJobs = (await listRunningJobs(stateAdapter, { txCtx, workerId })).filter(
    (job) => keepAttemptTokens === undefined || !keepAttemptTokens.has(job.attemptToken!),
  );
  if (runningJobs.length === 0) return [];
  const error = serializeError(new JobAttemptReclaimedError(message, { reclaimedBy }));
  const rescheduledJobs = await stateAdapter.rescheduleJobs({
    txCtx,
    jobs: runningJobs.map((job) => ({
      jobId: job.id,
      attemptToken: job.attemptToken!,
      error,
    })),
  });
  return runningJobs.filter((_, index) => rescheduledJobs[index] !== undefined);
};

const announceReclaimed = async (
  helpers: Helpers,
  { jobs, workerId }: { jobs: StateJob[]; workerId: string },
): Promise<void> => {
  const { notifyAdapter, observabilityHelper } = helpers;
  for (const job of jobs) {
    observabilityHelper.jobAttemptReclaimed(job, {
      workerId,
      reclaimedFrom: job.attemptBy!,
    });
  }
  if (jobs.length === 0) return;
  await notifyAdapter.notifyJobAttemptsLost(jobs.map((job) => job.id)).catch(() => {});
  await notifyAdapter
    .notifyJobsScheduled([...new Set(jobs.map((job) => job.typeName))])
    .catch(() => {});
};

const lockWorker = async (
  stateAdapter: StateAdapter<any, any, any, any>,
  { txCtx, workerId }: { txCtx: unknown; workerId: string },
): Promise<StateWorkerInfo | undefined> => {
  const [worker] = await stateAdapter.getWorkers({
    txCtx,
    workerIds: [workerId],
    lock: "exclusive",
  });
  return worker;
};

const registerWorker = async (
  helpers: Helpers,
  {
    workerId,
    typeNames,
    concurrency,
    leaseConfig,
  }: {
    workerId: string;
    typeNames: string[];
    concurrency: number;
    leaseConfig: WorkerLeaseConfig;
  },
): Promise<{ token: string; reclaimedJobs: StateJob[] }> => {
  const { stateAdapter } = helpers;
  return stateAdapter.withTransaction(async (txCtx) => {
    const existing = await lockWorker(stateAdapter, { txCtx, workerId });
    if (existing !== undefined && !existing.expired) {
      throw new WorkerAlreadyLiveError(`Worker "${workerId}" is held by a live worker`, {
        workerId,
      });
    }
    if (existing !== undefined) {
      await stateAdapter.stopWorker({ txCtx, workerId, workerToken: existing.token });
    }
    const jobs = await reclaimWorkerJobs(helpers, {
      txCtx,
      workerId,
      reclaimedBy: workerId,
      message: "Worker holding the attempt lost its lease",
    });
    const worker = await stateAdapter.startWorker({
      txCtx,
      workerId,
      typeNames,
      concurrency,
      leaseMs: leaseConfig.durationMs,
    });
    return { token: worker.token, reclaimedJobs: jobs };
  });
};

const reclaimExpiredWorker = async (
  helpers: Helpers,
  { workerId }: { workerId: string },
): Promise<boolean> => {
  const { stateAdapter } = helpers;
  const {
    items: [candidate],
  } = await stateAdapter.listWorkers({
    status: "expired",
    orderDirection: "asc",
    page: { limit: 1 },
  });
  if (candidate === undefined) return false;
  const reclaimedJobs = await stateAdapter.withTransaction(async (txCtx) => {
    const worker = await lockWorker(stateAdapter, { txCtx, workerId: candidate.id });
    if (worker === undefined || !worker.expired) return undefined;
    await stateAdapter.stopWorker({ txCtx, workerId: worker.id, workerToken: worker.token });
    return reclaimWorkerJobs(helpers, {
      txCtx,
      workerId: worker.id,
      reclaimedBy: workerId,
      message: "Worker holding the attempt lost its lease",
    });
  });
  if (reclaimedJobs === undefined) return false;
  await announceReclaimed(helpers, { jobs: reclaimedJobs, workerId });
  return true;
};

const stopOwnWorker = async (
  helpers: Helpers,
  { workerId, workerToken }: { workerId: string; workerToken: string },
): Promise<boolean> => {
  const { stateAdapter } = helpers;
  const reclaimedJobs = await stateAdapter.withTransaction(async (txCtx) => {
    if ((await stateAdapter.stopWorker({ txCtx, workerId, workerToken })) === undefined)
      return undefined;
    return reclaimWorkerJobs(helpers, {
      txCtx,
      workerId,
      reclaimedBy: workerId,
      message: "Worker holding the attempt stopped",
    });
  });
  if (reclaimedJobs === undefined) return false;
  await announceReclaimed(helpers, { jobs: reclaimedJobs, workerId });
  return true;
};

export const runWorker = async ({
  helpers,
  workerId,
  typeNames,
  processors,
  concurrency,
  pollIntervalMs,
  recoveryBackoffConfig,
  defaultBackoffConfig,
  leaseConfig,
  stopSignal,
}: {
  helpers: Helpers;
  workerId: string;
  typeNames: string[];
  processors: Record<string, StampedProcessor>;
  concurrency: number;
  pollIntervalMs: number;
  recoveryBackoffConfig: BackoffConfig;
  defaultBackoffConfig: BackoffConfig;
  leaseConfig: WorkerLeaseConfig;
  stopSignal: AbortSignal;
}): Promise<boolean> => {
  const { stateAdapter, notifyAdapter, observabilityHelper } = helpers;
  const registrationSentAt = performance.now();
  const { token: workerToken, reclaimedJobs } = await registerWorker(helpers, {
    workerId,
    typeNames,
    concurrency,
    leaseConfig,
  });
  observabilityHelper.workerStarted({ workerId, jobTypeNames: typeNames });
  observabilityHelper.jobTypeIdleChange(concurrency, workerId, typeNames);

  const leaseLost = new AbortController();
  const loseLease = () => {
    if (leaseLost.signal.aborted) return;
    observabilityHelper.workerLeaseLost({ workerId });
    leaseLost.abort();
  };
  const leaseStop = new AbortController();
  const lease = holdLease({
    config: leaseConfig,
    startedAt: registrationSentAt,
    renew: async () =>
      (await stateAdapter.extendWorkerLease({
        workerId,
        workerToken,
        leaseMs: leaseConfig.durationMs,
      })) !== undefined,
    signal: leaseStop.signal,
  }).then((held) => {
    if (!held) loseLease();
  });
  await announceReclaimed(helpers, { jobs: reclaimedJobs, workerId });
  const signal = AbortSignal.any([stopSignal, leaseLost.signal]);

  const executor = createParallelExecutor(concurrency);
  const runningAttemptTokens = new Set<string>();

  const dispatchJob = (stateJob: StateJob & { hasBlockers: boolean }) => {
    runningAttemptTokens.add(stateJob.attemptToken!);
    void executor.add(async () => {
      observabilityHelper.jobTypeProcessingChange(1, stateJob, workerId);
      observabilityHelper.jobTypeIdleChange(-1, workerId, typeNames);
      try {
        const jobTypeProcessor = processors[stateJob.typeName];
        if (!jobTypeProcessor) {
          throw new Error(`No attempt handler registered for job type "${stateJob.typeName}"`);
        }
        await runAttempt({
          helpers,
          attemptHandler: jobTypeProcessor.attemptHandler,
          stateJob,
          backoffConfig: jobTypeProcessor.backoffConfig ?? defaultBackoffConfig,
          workerId,
          attemptMiddleware: jobTypeProcessor[processorAttemptMiddlewareSymbol],
          abortSignal: signal,
        });
      } catch (error) {
        observabilityHelper.workerError({ workerId }, error);
      } finally {
        runningAttemptTokens.delete(stateJob.attemptToken!);
        observabilityHelper.jobTypeIdleChange(1, workerId, typeNames);
        observabilityHelper.jobTypeProcessingChange(-1, stateJob, workerId);
      }
    });
  };

  const reclaimFinishedJobs = async () => {
    const reclaimedJobs = await stateAdapter.withTransaction(async (txCtx) => {
      if ((await lockWorker(stateAdapter, { txCtx, workerId }))?.token !== workerToken)
        return undefined;
      return reclaimWorkerJobs(helpers, {
        txCtx,
        workerId,
        reclaimedBy: workerId,
        keepAttemptTokens: runningAttemptTokens,
        message: "Worker holding the attempt no longer runs it",
      });
    });
    if (reclaimedJobs === undefined) {
      loseLease();
      return;
    }
    await announceReclaimed(helpers, { jobs: reclaimedJobs, workerId });
  };

  const startJobs = async (): Promise<number> => {
    let startedJobs = 0;
    while (executor.idleSlots() > 0 && !signal.aborted) {
      const limit = executor.idleSlots();
      const stateJobs = await stateAdapter.startJobAttempts({
        typeNames,
        workerId,
        workerToken,
        limit,
      });
      for (const stateJob of stateJobs) {
        dispatchJob(stateJob);
      }
      startedJobs += stateJobs.length;
      if (stateJobs.length < limit) {
        break;
      }
    }
    return startedJobs;
  };

  const reclaimOrWait = async () => {
    if (signal.aborted) {
      return;
    }

    if (executor.idleSlots() > 0) {
      await reclaimFinishedJobs();
      if (await reclaimExpiredWorker(helpers, { workerId })) {
        return;
      }
    }

    await waitForNextJob({
      stateAdapter,
      notifyAdapter,
      typeNames,
      pollIntervalMs,
      executor,
      signal,
    });
  };

  let failures = 0;
  let startedJob = false;
  while (!signal.aborted) {
    try {
      if ((await startJobs()) > 0) {
        failures = 0;
        startedJob = true;
      }
      await reclaimOrWait();
    } catch (error) {
      observabilityHelper.workerError({ workerId }, error);
      failures += 1;
      await sleep(calculateBackoffMs(failures, recoveryBackoffConfig), { signal });
    }
  }

  await executor.drain();
  leaseStop.abort();
  await lease;
  observabilityHelper.jobTypeIdleChange(-concurrency, workerId, typeNames);

  try {
    try {
      if (leaseLost.signal.aborted || !(await stopOwnWorker(helpers, { workerId, workerToken }))) {
        loseLease();
        throw new WorkerLeaseLostError(`Worker "${workerId}" lost its lease`, {
          workerId,
        });
      }
    } finally {
      observabilityHelper.workerStopped({ workerId });
    }
  } catch (error) {
    observabilityHelper.workerError({ workerId }, error);
  }
  return startedJob;
};
