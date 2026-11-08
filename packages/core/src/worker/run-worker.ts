import {
  type ParallelExecutor,
  createParallelExecutor,
  raceWithSleep,
  serializeError,
  sleep,
} from "@queuert/helpers";

import type { AnyAttemptMiddleware } from "../attempt-middleware/attempt-middleware.ts";
import { runAttempt } from "../attempt/attempt-handler.ts";
import { type BackoffConfig, calculateBackoffMs } from "../entities/backoff.ts";
import {
  JobAttemptReclaimedError,
  WorkerAlreadyLiveError,
  WorkerLeaseLostError,
} from "../errors.ts";
import {
  type InProcessWorkerProcessor,
  processorAttemptMiddlewareSymbol,
} from "../job-type-processors/job-type-processors.ts";
import type { Helpers } from "../setup-helpers.ts";
import type { StateJob, StateWorkerInfo } from "../state-adapter/state-adapter.ts";
import { type TxHooks, createTxHooks, withTxHooks } from "../tx-hooks/tx-hooks.ts";
import { type WorkerLeaseConfig, holdLease } from "./worker-lease.ts";

/** Per-processor runtime stamp carrying the middleware tuple of the originating slice. @internal */
export type StampedProcessor = InProcessWorkerProcessor<any, any, any, any> & {
  readonly [processorAttemptMiddlewareSymbol]: readonly AnyAttemptMiddleware[];
};

const waitForNextJob = async (
  helpers: Helpers,
  {
    typeNames,
    pollIntervalMs,
    executor,
    signal,
  }: {
    typeNames: string[];
    pollIntervalMs: number;
    executor: ParallelExecutor<any>;
    signal: AbortSignal;
  },
): Promise<void> => {
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
    const disposeNotified = await helpers.notifyHelper.listenJobScheduled(typeNames, () => {
      onNotification();
    });

    try {
      const startAttemptDelayMs = await helpers.stateAdapter.getStartAttemptDelayMs({ typeNames });
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

type ReclaimedJob = { reclaimed: StateJob; rescheduled: StateJob };

const listRunningJobs = async (
  helpers: Helpers,
  { txCtx, workerId }: { txCtx?: unknown; workerId: string },
): Promise<StateJob[]> => {
  const listPage = async (cursor: string | undefined) =>
    helpers.stateAdapter.listWorkerJobs({
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
): Promise<ReclaimedJob[]> => {
  const { stateAdapter } = helpers;
  const runningJobs = (await listRunningJobs(helpers, { txCtx, workerId })).filter(
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
  return runningJobs.flatMap((reclaimed, index) => {
    const rescheduled = rescheduledJobs[index];
    return rescheduled === undefined ? [] : [{ reclaimed, rescheduled }];
  });
};

const announceReclaimed = (
  helpers: Helpers,
  txHooks: TxHooks,
  { jobs, workerId }: { jobs: ReclaimedJob[]; workerId: string },
): void => {
  const { notifyHelper, observabilityHelper } = helpers;
  for (const { reclaimed, rescheduled } of jobs) {
    txHooks.onCommit(() => {
      observabilityHelper.jobAttemptReclaimed(reclaimed, {
        workerId,
        reclaimedFrom: reclaimed.attemptBy!,
      });
    });
    txHooks.onCommit(() => {
      observabilityHelper.jobRescheduled(rescheduled);
    });
  }
  notifyHelper.notifyJobAttemptsLost(
    txHooks,
    jobs.map(({ reclaimed }) => reclaimed.id),
  );
  notifyHelper.notifyJobsScheduled(
    txHooks,
    jobs.map(({ reclaimed }) => reclaimed.typeName),
  );
};

const lockWorker = async (
  helpers: Helpers,
  { txCtx, workerId }: { txCtx: unknown; workerId: string },
): Promise<StateWorkerInfo | undefined> => {
  const [worker] = await helpers.stateAdapter.getWorkers({
    txCtx,
    workerIds: [workerId],
    lock: "exclusive",
  });
  return worker;
};

const registerWorker = async (
  helpers: Helpers,
  txHooks: TxHooks,
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
): Promise<string> => {
  const { stateAdapter } = helpers;
  return stateAdapter.withTransaction(
    txHooks.retryBoundary(async (txCtx) => {
      const existing = await lockWorker(helpers, { txCtx, workerId });
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
      announceReclaimed(helpers, txHooks, { jobs, workerId });
      return worker.token;
    }),
  );
};

const reclaimExpiredWorker = async (
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
  return withTxHooks(async (txHooks) =>
    stateAdapter.withTransaction(
      txHooks.retryBoundary(async (txCtx) => {
        const worker = await lockWorker(helpers, { txCtx, workerId: candidate.id });
        if (worker === undefined || !worker.expired) return false;
        await stateAdapter.stopWorker({ txCtx, workerId: worker.id, workerToken: worker.token });
        const jobs = await reclaimWorkerJobs(helpers, {
          txCtx,
          workerId: worker.id,
          reclaimedBy: workerId,
          message: "Worker holding the attempt lost its lease",
        });
        announceReclaimed(helpers, txHooks, { jobs, workerId });
        return true;
      }),
    ),
  );
};

const stopOwnWorker = async (
  helpers: Helpers,
  { workerId, workerToken }: { workerId: string; workerToken: string },
): Promise<boolean> => {
  const { stateAdapter } = helpers;
  return withTxHooks(async (txHooks) =>
    stateAdapter.withTransaction(
      txHooks.retryBoundary(async (txCtx) => {
        if ((await stateAdapter.stopWorker({ txCtx, workerId, workerToken })) === undefined)
          return false;
        const jobs = await reclaimWorkerJobs(helpers, {
          txCtx,
          workerId,
          reclaimedBy: workerId,
          message: "Worker holding the attempt stopped",
        });
        announceReclaimed(helpers, txHooks, { jobs, workerId });
        return true;
      }),
    ),
  );
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
  const { stateAdapter, observabilityHelper } = helpers;
  const registrationSentAt = performance.now();
  const registration = createTxHooks();
  const workerToken = await registerWorker(helpers, registration.txHooks, {
    workerId,
    typeNames,
    concurrency,
    leaseConfig,
  }).catch((error: unknown) => {
    registration.discard();
    throw error;
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
  await registration.flush();
  const signal = AbortSignal.any([stopSignal, leaseLost.signal]);

  const executor = createParallelExecutor(concurrency);
  const runningAttemptTokens = new Set<string>();
  let finishedJobsReclaimDue = false;
  let finishedJobsReclaimedAt = performance.now();

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
        finishedJobsReclaimDue = true;
        observabilityHelper.workerError({ workerId }, error);
      } finally {
        runningAttemptTokens.delete(stateJob.attemptToken!);
        observabilityHelper.jobTypeIdleChange(1, workerId, typeNames);
        observabilityHelper.jobTypeProcessingChange(-1, stateJob, workerId);
      }
    });
  };

  const reclaimFinishedJobs = async () => {
    const ownsWorker = await withTxHooks(async (txHooks) =>
      stateAdapter.withTransaction(
        txHooks.retryBoundary(async (txCtx) => {
          if ((await lockWorker(helpers, { txCtx, workerId }))?.token !== workerToken) return false;
          const jobs = await reclaimWorkerJobs(helpers, {
            txCtx,
            workerId,
            reclaimedBy: workerId,
            keepAttemptTokens: runningAttemptTokens,
            message: "Worker holding the attempt no longer runs it",
          });
          announceReclaimed(helpers, txHooks, { jobs, workerId });
          return true;
        }),
      ),
    );
    if (!ownsWorker) {
      loseLease();
    }
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
      if (
        finishedJobsReclaimDue ||
        performance.now() - finishedJobsReclaimedAt >= leaseConfig.heartbeatMs
      ) {
        finishedJobsReclaimDue = false;
        finishedJobsReclaimedAt = performance.now();
        await reclaimFinishedJobs();
      }
      if (await reclaimExpiredWorker(helpers, { workerId })) {
        return;
      }
    }

    await waitForNextJob(helpers, {
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
      finishedJobsReclaimDue = true;
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
