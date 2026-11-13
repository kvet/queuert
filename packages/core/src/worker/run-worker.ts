import { type ParallelExecutor, createParallelExecutor } from "@queuert/helpers/parallel-executor";
import { raceWithSleep, sleep } from "@queuert/helpers/sleep";

import type { AnyAttemptMiddleware } from "../attempt-middleware/attempt-middleware.ts";
import { runAttempt } from "../attempt/attempt-handler.ts";
import type { Helpers } from "../client/setup-helpers.ts";
import { type BackoffConfig, calculateBackoffMs } from "../entities/backoff.ts";
import { WorkerLeaseLostError } from "../errors.ts";
import {
  type Processor,
  processorAttemptMiddlewareSymbol,
} from "../job-type-processors/job-type-processors.ts";
import type { StateJob } from "../state-adapter/state-adapter.ts";
import { type WorkerLeaseConfig, holdLease } from "./worker-lease.ts";
import {
  runExtendWorkerLease,
  runGetStartAttemptDelayMs,
  runListenJobScheduled,
  runReclaimExpiredWorker,
  runReclaimFinishedJobs,
  runRegisterWorker,
  runStartJobAttempts,
  runStopOwnWorker,
} from "./worker-transactions.ts";

/** Per-processor runtime stamp carrying the middleware tuple of the originating slice. @internal */
export type StampedProcessor = Processor<any, any, any, any> & {
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
    const disposeNotified = await runListenJobScheduled(helpers, typeNames, () => {
      onNotification();
    });

    try {
      const startAttemptDelayMs = await runGetStartAttemptDelayMs(helpers, { typeNames });
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
  const { observabilityHelper } = helpers;
  const registrationSentAt = performance.now();
  const registration = await runRegisterWorker(helpers, {
    workerId,
    typeNames,
    concurrency,
    leaseMs: leaseConfig.durationMs,
  });
  const { workerToken } = registration;
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
      runExtendWorkerLease(helpers, {
        workerId,
        workerToken,
        leaseMs: leaseConfig.durationMs,
      }),
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
    const ownsWorker = await runReclaimFinishedJobs(helpers, {
      workerId,
      workerToken,
      keepAttemptTokens: runningAttemptTokens,
    });
    if (!ownsWorker) {
      loseLease();
    }
  };

  const startJobs = async (): Promise<number> => {
    let startedJobs = 0;
    while (executor.idleSlots() > 0 && !signal.aborted) {
      const limit = executor.idleSlots();
      const stateJobs = await runStartJobAttempts(helpers, {
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
      if (await runReclaimExpiredWorker(helpers, { workerId })) {
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
      if (
        leaseLost.signal.aborted ||
        !(await runStopOwnWorker(helpers, { workerId, workerToken }))
      ) {
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
