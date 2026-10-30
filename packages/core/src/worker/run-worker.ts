import {
  raceWithSleep,
  type ParallelExecutor,
  createParallelExecutor,
  serializeError,
} from "@queuert/helpers";

import { type AnyAttemptMiddleware } from "../attempt-middleware/attempt-middleware.js";
import { runAttempt } from "../attempt/attempt-handler.js";
import { type AttemptOwnership, startAttemptOwnership } from "../attempt/attempt-ownership.js";
import { type BackoffConfig } from "../entities/backoff.js";
import { withRetry } from "../entities/retry.js";
import { InvalidWorkerIdError, JobAttemptReclaimedError } from "../errors.js";
import {
  type InProcessWorkerProcessor,
  processorAttemptMiddlewareSymbol,
} from "../job-type-processors/job-type-processors.js";
import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { type Helpers } from "../setup-helpers.js";
import {
  type StateAdapter,
  type StateJob,
  type StateReclaimedJob,
} from "../state-adapter/state-adapter.js";
import { type WorkerLeaseConfig, startWorkerLease } from "./worker-lease.js";

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
  stateAdapter: StateAdapter<any, any>;
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

const serializeReclaimError = (message: string, workerId: string): string =>
  serializeError(new JobAttemptReclaimedError(message, { reclaimedBy: workerId }));

const isAttemptHeld = (
  job: StateJob | undefined,
  { attempt, workerId }: { attempt: number; workerId: string },
): boolean =>
  job !== undefined &&
  job.status === "running" &&
  job.attempt === attempt &&
  job.attemptBy === workerId;

const handleReclaimedJobs = async (
  helpers: Helpers,
  { reclaimedJobs, workerId }: { reclaimedJobs: StateReclaimedJob[]; workerId: string },
): Promise<void> => {
  const { notifyAdapter, observabilityHelper } = helpers;
  for (const reclaimedJob of reclaimedJobs) {
    observabilityHelper.jobAttemptReclaimed(reclaimedJob, { workerId });
  }
  if (reclaimedJobs.length === 0) {
    return;
  }
  await notifyAdapter
    .notifyJobAttemptsLost(reclaimedJobs.map((reclaimedJob) => reclaimedJob.id))
    .catch(() => {});
};

const generateWorkerId = (
  stateAdapter: StateAdapter<any, any>,
): { workerId: string } | { workerId: string; error: unknown } => {
  try {
    const workerId = stateAdapter.config.generateWorkerId();
    return stateAdapter.config.validateWorkerId(workerId)
      ? { workerId }
      : {
          workerId,
          error: new InvalidWorkerIdError(
            `Invalid worker ID "${workerId}" from generator — failed validateWorkerId predicate`,
            { id: workerId },
          ),
        };
  } catch (error) {
    return { workerId: "", error };
  }
};

export const runWorker = async ({
  helpers,
  workerName,
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
  workerName: string | null;
  typeNames: string[];
  processors: Record<string, StampedProcessor>;
  concurrency: number;
  pollIntervalMs: number;
  recoveryBackoffConfig: BackoffConfig;
  defaultBackoffConfig: BackoffConfig;
  leaseConfig: WorkerLeaseConfig;
  stopSignal: AbortSignal;
}): Promise<
  | { stop: "registrationFailed" | "leaseLost" | "stopped" }
  | { stop: "uncertainWrite"; healthy: boolean }
> => {
  const { stateAdapter, notifyAdapter, observabilityHelper } = helpers;
  const generated = generateWorkerId(stateAdapter);
  const { workerId } = generated;
  const worker = { workerId, workerName };
  const sentAt = performance.now();
  const registrationFailure =
    "error" in generated
      ? generated
      : await stateAdapter
          .startWorker({
            workerId,
            name: workerName,
            typeNames,
            concurrency,
            leaseMs: leaseConfig.durationMs,
          })
          .then(
            () => undefined,
            (error: unknown) => ({ error }),
          );
  if (registrationFailure !== undefined) {
    observabilityHelper.workerError(worker, registrationFailure.error);
    return { stop: "registrationFailed" };
  }

  observabilityHelper.workerStarted({ ...worker, jobTypeNames: typeNames });
  observabilityHelper.jobTypeIdleChange(concurrency, workerId, typeNames);

  const stoppingController = new AbortController();
  const attemptsController = new AbortController();
  const beginStopping = ({ abortAttempts }: { abortAttempts: boolean }) => {
    if (abortAttempts) attemptsController.abort();
    stoppingController.abort();
  };
  const uncertainWrite = { healthy: undefined as boolean | undefined };
  const stopGracefully = (error: unknown) => {
    observabilityHelper.workerError(worker, error);
    uncertainWrite.healthy ??= lease.hasRenewed();
    beginStopping({ abortAttempts: false });
  };

  const attempts = new Set<{ stateJob: StateJob; ownership: AttemptOwnership }>();
  const abortLostAttempts = async () => {
    const tracked = [...attempts];
    if (tracked.length === 0) return;
    const jobs = await stateAdapter.getJobs({ jobIds: tracked.map(({ stateJob }) => stateJob.id) });
    for (const [index, { stateJob, ownership }] of tracked.entries()) {
      if (
        !isAttemptHeld(jobs[index], { attempt: stateJob.attempt, workerId }) &&
        !ownership.hasWrittenComplete()
      ) {
        ownership.abort();
      }
    }
  };
  const lostAttemptsCheck = { inFlight: null as Promise<void> | null };

  const lease = startWorkerLease({
    config: leaseConfig,
    sentAt,
    renew: async () =>
      (await stateAdapter.extendWorkerLease({ workerId, leaseMs: leaseConfig.durationMs })) !==
      undefined,
    onRenewed: () => {
      if (lostAttemptsCheck.inFlight !== null) return;
      lostAttemptsCheck.inFlight = abortLostAttempts()
        .catch(() => {})
        .finally(() => {
          lostAttemptsCheck.inFlight = null;
        });
    },
    onLost: () => {
      observabilityHelper.workerLeaseLost(worker);
      beginStopping({ abortAttempts: true });
    },
  });

  const onStop = () => {
    beginStopping({ abortAttempts: true });
  };
  stopSignal.addEventListener("abort", onStop, { once: true });
  if (stopSignal.aborted) onStop();

  const executor = createParallelExecutor(concurrency);

  const runJob = (stateJob: StateJob & { hasBlockers: boolean }) => {
    const jobTypeProcessor = processors[stateJob.typeName];
    if (!jobTypeProcessor) {
      throw new Error(`No attempt handler registered for job type "${stateJob.typeName}"`);
    }

    void executor.add(async () => {
      observabilityHelper.jobTypeProcessingChange(1, stateJob, workerId);
      observabilityHelper.jobTypeIdleChange(-1, workerId, typeNames);
      try {
        const ownership = await startAttemptOwnership(helpers, {
          stateJob,
          abortSignal: attemptsController.signal,
        });
        const attempt = { stateJob, ownership };
        attempts.add(attempt);
        try {
          await runAttempt({
            helpers,
            attemptHandler: jobTypeProcessor.attemptHandler,
            stateJob,
            backoffConfig: jobTypeProcessor.backoffConfig ?? defaultBackoffConfig,
            workerId,
            attemptMiddleware: jobTypeProcessor[processorAttemptMiddlewareSymbol],
            ownership,
            onRescheduleError: stopGracefully,
          });
        } finally {
          attempts.delete(attempt);
        }
      } catch (error) {
        observabilityHelper.workerError(worker, error);
      } finally {
        observabilityHelper.jobTypeIdleChange(1, workerId, typeNames);
        observabilityHelper.jobTypeProcessingChange(-1, stateJob, workerId);
      }
    });
  };

  const runWorkerIteration = async () => {
    try {
      while (executor.idleSlots() > 0 && !stoppingController.signal.aborted && lease.isLive()) {
        const limit = executor.idleSlots();
        const stateJobs = await stateAdapter
          .startJobAttempts({ typeNames, workerId, limit })
          .catch((error: unknown) => {
            stopGracefully(error);
            return [];
          });

        if (stoppingController.signal.aborted || !lease.isLive()) {
          break;
        }
        for (const stateJob of stateJobs) {
          runJob(stateJob);
        }
        if (stateJobs.length < limit) {
          break;
        }
      }

      if (stoppingController.signal.aborted) {
        return;
      }

      if (executor.idleSlots() > 0) {
        const reclaimedJobs = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: serializeReclaimError(
            "Worker holding the attempt lost its lease",
            workerId,
          ),
          limit: executor.idleSlots(),
        });
        await handleReclaimedJobs(helpers, { reclaimedJobs, workerId });

        if (stoppingController.signal.aborted) {
          return;
        }

        if (reclaimedJobs.length > 0) {
          return;
        }
      }

      await waitForNextJob({
        stateAdapter,
        notifyAdapter,
        typeNames,
        pollIntervalMs,
        executor,
        signal: stoppingController.signal,
      });
    } catch (error) {
      observabilityHelper.workerError(worker, error);
      throw error;
    }
  };

  while (!stoppingController.signal.aborted) {
    await withRetry(runWorkerIteration, recoveryBackoffConfig, {
      signal: stoppingController.signal,
    }).catch(() => {});
  }
  await executor.drain();

  const leaseLost = !lease.isLive();
  lease.stop();
  if (!leaseLost) {
    try {
      const reclaimedJobs = await stateAdapter.stopWorker({
        workerId,
        lastAttemptError: serializeReclaimError("Worker holding the attempt stopped", workerId),
      });
      await handleReclaimedJobs(helpers, { reclaimedJobs, workerId });
    } catch (error) {
      observabilityHelper.workerError(worker, error);
    }
  }

  stopSignal.removeEventListener("abort", onStop);
  observabilityHelper.jobTypeIdleChange(-concurrency, workerId, typeNames);
  observabilityHelper.workerStopped(worker);

  if (uncertainWrite.healthy !== undefined) {
    return { stop: "uncertainWrite", healthy: uncertainWrite.healthy };
  }
  return { stop: leaseLost ? "leaseLost" : "stopped" };
};
