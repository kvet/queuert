import { chunk } from "@queuert/helpers/chunk";
import { type ParallelExecutor, createParallelExecutor } from "@queuert/helpers/parallel-executor";
import { serializeError } from "@queuert/helpers/serialize-error";
import { raceWithSleep, sleep } from "@queuert/helpers/sleep";
import { step, syncAsync } from "@queuert/sync-async";

import type { AnyAttemptMiddleware } from "../attempt-middleware/attempt-middleware.ts";
import { runAttempt } from "../attempt/attempt-handler.ts";
import type { AnyAttemptHandler } from "../attempt/attempt-handler.types.ts";
import { type Helpers, withHelpersTransaction } from "../client/setup-helpers.ts";
import { type BackoffConfig, calculateBackoffMs } from "../entities/backoff.ts";
import {
  JobAttemptReclaimedError,
  WorkerAlreadyLiveError,
  WorkerLeaseLostError,
} from "../errors.ts";
import {
  type Processor,
  processorAttemptMiddlewareSymbol,
} from "../job-type-processors/job-type-processors.ts";
import type { BaseTxContext, StateJob } from "../state-adapter/state-adapter.ts";
import { createTxEffects, registerTxEffects } from "../tx-effects/tx-effects.ts";
import { type WorkerLeaseConfig, holdLease } from "./worker-lease.ts";

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
    const disposeNotified = await helpers.notifyHelper.listenJobsScheduled(typeNames, () => {
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

const listRunningJobs = syncAsync(function* (
  helpers: Helpers,
  { txCtx, workerId }: { txCtx?: unknown; workerId: string },
) {
  const listPage = (cursor: string | undefined) =>
    helpers.stateAdapter.listWorkerJobs({
      txCtx,
      workerId,
      orderDirection: "asc",
      page: { cursor, limit: 100 },
    });
  const pages = [yield* step(listPage(undefined))];
  while (pages.at(-1)!.nextCursor !== null) {
    pages.push(yield* step(listPage(pages.at(-1)!.nextCursor!)));
  }
  return pages.flatMap((page) => page.items);
});

const reclaimWorkerJobs = syncAsync(function* (
  helpers: Helpers,
  {
    txCtx,
    workerId,
    reclaimedBy,
    keepAttemptTokens,
    message,
    backoffConfigFor,
  }: {
    txCtx?: unknown;
    workerId: string;
    reclaimedBy: string;
    keepAttemptTokens?: Set<string>;
    message: string;
    backoffConfigFor: (typeName: string) => BackoffConfig;
  },
) {
  const { stateAdapter } = helpers;
  const runningJobs = (yield* listRunningJobs.steps(helpers, { txCtx, workerId })).filter(
    (job) => keepAttemptTokens === undefined || !keepAttemptTokens.has(job.attemptToken!),
  );
  if (runningJobs.length === 0) return [];
  const error = serializeError(new JobAttemptReclaimedError(message, { reclaimedBy }));
  const rescheduledJobs = yield* step(
    stateAdapter.rescheduleJobs({
      txCtx,
      jobs: runningJobs.map((job) => ({
        jobId: job.id,
        schedule: {
          afterMs: calculateBackoffMs(job.consecutiveFailures + 1, backoffConfigFor(job.typeName)),
        },
        attemptToken: job.attemptToken!,
        error,
      })),
    }),
  );
  return runningJobs.flatMap((reclaimed, index): ReclaimedJob[] => {
    const rescheduled = rescheduledJobs[index];
    return rescheduled === undefined ? [] : [{ reclaimed, rescheduled }];
  });
});

const observeReclaimed = (
  helpers: Helpers,
  { reclaimed, rescheduled }: ReclaimedJob,
  workerId: string,
): void => {
  helpers.observabilityHelper.jobAttemptReclaimed(reclaimed, {
    workerId,
    reclaimedFrom: reclaimed.attemptBy!,
  });
  helpers.observabilityHelper.jobRescheduled(rescheduled);
};

const announceReclaimed = (
  helpers: Helpers,
  txCtx: BaseTxContext,
  { jobs, workerId }: { jobs: ReclaimedJob[]; workerId: string },
): void => {
  const effects = createTxEffects();
  for (const job of jobs) {
    effects.onCommit(() => {
      observeReclaimed(helpers, job, workerId);
    });
  }
  effects.notify({
    jobAttemptsLost: jobs.map(({ reclaimed }) => reclaimed.id),
    jobsScheduled: jobs.map(({ reclaimed }) => reclaimed.typeName),
  });
  registerTxEffects(helpers, txCtx, effects);
};

const lockWorker = syncAsync(function* (
  helpers: Helpers,
  { txCtx, workerId }: { txCtx: unknown; workerId: string },
) {
  const [worker] = yield* step(
    helpers.stateAdapter.getWorkers({
      txCtx,
      workerIds: [workerId],
      lock: "exclusive",
    }),
  );
  return worker;
});

const announceReclaimedNow = async (
  helpers: Helpers,
  { jobs, workerId }: { jobs: ReclaimedJob[]; workerId: string },
): Promise<void> => {
  const notified = Promise.all([
    helpers.notifyHelper.notifyJobAttemptsLost(jobs.map(({ reclaimed }) => reclaimed.id)),
    helpers.notifyHelper.notifyJobsScheduled(jobs.map(({ reclaimed }) => reclaimed.typeName)),
  ]);
  for (const job of jobs) {
    observeReclaimed(helpers, job, workerId);
  }
  await notified;
};

const registerWorker = async (
  helpers: Helpers,
  {
    workerId,
    typeNames,
    concurrency,
    leaseConfig,
    backoffConfigFor,
  }: {
    workerId: string;
    typeNames: string[];
    concurrency: number;
    leaseConfig: WorkerLeaseConfig;
    backoffConfigFor: (typeName: string) => BackoffConfig;
  },
): Promise<{ workerToken: string; reclaimedJobs: ReclaimedJob[] }> => {
  const { stateAdapter } = helpers;
  return withHelpersTransaction(
    helpers,
    syncAsync(function* (txCtx: BaseTxContext) {
      const existing = yield* lockWorker.steps(helpers, { txCtx, workerId });
      if (existing !== undefined && !existing.expired) {
        throw new WorkerAlreadyLiveError(`Worker "${workerId}" is held by a live worker`, {
          workerId,
        });
      }
      if (existing !== undefined) {
        yield* step(stateAdapter.stopWorker({ txCtx, workerId, workerToken: existing.token }));
      }
      const jobs = yield* reclaimWorkerJobs.steps(helpers, {
        txCtx,
        workerId,
        reclaimedBy: workerId,
        message: "Worker holding the attempt lost its lease",
        backoffConfigFor,
      });
      const worker = yield* step(
        stateAdapter.startWorker({
          txCtx,
          workerId,
          typeNames,
          concurrency,
          leaseMs: leaseConfig.durationMs,
        }),
      );
      return { workerToken: worker.token, reclaimedJobs: jobs };
    }),
  );
};

const reclaimExpiredWorker = async (
  helpers: Helpers,
  {
    workerId,
    backoffConfigFor,
  }: { workerId: string; backoffConfigFor: (typeName: string) => BackoffConfig },
): Promise<boolean> => {
  const { stateAdapter } = helpers;
  const { items: candidates } = await stateAdapter.listWorkers({
    status: "expired",
    orderDirection: "asc",
    page: { limit: 8 },
  });
  if (candidates.length === 0) return false;
  const candidate = candidates[Math.floor(Math.random() * candidates.length)];
  return withHelpersTransaction(
    helpers,
    syncAsync(function* (txCtx: BaseTxContext) {
      const worker = yield* lockWorker.steps(helpers, { txCtx, workerId: candidate.id });
      if (worker === undefined || !worker.expired) return false;
      yield* step(
        stateAdapter.stopWorker({ txCtx, workerId: worker.id, workerToken: worker.token }),
      );
      const jobs = yield* reclaimWorkerJobs.steps(helpers, {
        txCtx,
        workerId: worker.id,
        reclaimedBy: workerId,
        message: "Worker holding the attempt lost its lease",
        backoffConfigFor,
      });
      announceReclaimed(helpers, txCtx, { jobs, workerId });
      return true;
    }),
  );
};

const stopOwnWorker = async (
  helpers: Helpers,
  {
    workerId,
    workerToken,
    backoffConfigFor,
  }: {
    workerId: string;
    workerToken: string;
    backoffConfigFor: (typeName: string) => BackoffConfig;
  },
): Promise<boolean> => {
  const { stateAdapter } = helpers;
  return withHelpersTransaction(
    helpers,
    syncAsync(function* (txCtx: BaseTxContext) {
      if ((yield* step(stateAdapter.stopWorker({ txCtx, workerId, workerToken }))) === undefined)
        return false;
      const jobs = yield* reclaimWorkerJobs.steps(helpers, {
        txCtx,
        workerId,
        reclaimedBy: workerId,
        message: "Worker holding the attempt stopped",
        backoffConfigFor,
      });
      announceReclaimed(helpers, txCtx, { jobs, workerId });
      return true;
    }),
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
  const batchLimits = Object.fromEntries(
    typeNames.map((typeName) => [typeName, processors[typeName]?.batchLimit ?? 1]),
  );
  const backoffConfigFor = (typeName: string): BackoffConfig =>
    (Object.hasOwn(processors, typeName) ? processors[typeName].backoffConfig : undefined) ??
    defaultBackoffConfig;
  const registrationSentAt = performance.now();
  const { workerToken, reclaimedJobs } = await registerWorker(helpers, {
    workerId,
    typeNames,
    concurrency,
    leaseConfig,
    backoffConfigFor,
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
  await announceReclaimedNow(helpers, { jobs: reclaimedJobs, workerId });
  // One plain signal instead of AbortSignal.any: the loop reads `aborted` and adds an abort
  // listener per job, and both cost more on a composite signal.
  const stopped = new AbortController();
  const stop = () => {
    stopped.abort();
  };
  stopSignal.addEventListener("abort", stop, { once: true });
  leaseLost.signal.addEventListener("abort", stop, { once: true });
  if (stopSignal.aborted || leaseLost.signal.aborted) stop();
  const signal = stopped.signal;

  const executor = createParallelExecutor(concurrency);
  const runningAttemptTokens = new Set<string>();
  let finishedJobsReclaimDue = false;
  let finishedJobsReclaimedAt = performance.now();

  const dispatchBatch = (stateJobs: (StateJob & { hasBlockers: boolean })[]) => {
    for (const stateJob of stateJobs) {
      runningAttemptTokens.add(stateJob.attemptToken!);
    }
    void executor.add(async (workerSlot) => {
      observabilityHelper.jobAttemptBatchSize(stateJobs, workerId);
      observabilityHelper.jobTypeProcessingChange(1, stateJobs, workerId);
      observabilityHelper.jobTypeIdleChange(-1, workerId, typeNames);
      try {
        const typeName = stateJobs[0].typeName;
        const jobTypeProcessor = processors[typeName];
        if (!jobTypeProcessor) {
          throw new Error(`No attempt handler registered for job type "${typeName}"`);
        }
        await runAttempt({
          helpers,
          attemptHandler: (typeof jobTypeProcessor.batchAttemptHandler === "function"
            ? jobTypeProcessor.batchAttemptHandler
            : jobTypeProcessor.attemptHandler) as AnyAttemptHandler,
          batched: typeof jobTypeProcessor.batchAttemptHandler === "function",
          stateJobs,
          backoffConfig: jobTypeProcessor.backoffConfig ?? defaultBackoffConfig,
          workerId,
          workerSlot,
          attemptMiddleware: jobTypeProcessor[processorAttemptMiddlewareSymbol],
          abortSignal: signal,
        });
      } catch (error) {
        finishedJobsReclaimDue = true;
        observabilityHelper.workerError({ workerId }, error);
      } finally {
        for (const stateJob of stateJobs) {
          runningAttemptTokens.delete(stateJob.attemptToken!);
        }
        observabilityHelper.jobTypeIdleChange(1, workerId, typeNames);
        observabilityHelper.jobTypeProcessingChange(-1, stateJobs, workerId);
      }
    });
  };

  const reclaimFinishedJobs = async () => {
    const ownsWorker = await withHelpersTransaction(
      helpers,
      syncAsync(function* (txCtx: BaseTxContext) {
        if ((yield* lockWorker.steps(helpers, { txCtx, workerId }))?.token !== workerToken)
          return false;
        const jobs = yield* reclaimWorkerJobs.steps(helpers, {
          txCtx,
          workerId,
          reclaimedBy: workerId,
          keepAttemptTokens: runningAttemptTokens,
          message: "Worker holding the attempt no longer runs it",
          backoffConfigFor,
        });
        announceReclaimed(helpers, txCtx, { jobs, workerId });
        return true;
      }),
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
        batchLimits,
        workerId,
        workerToken,
        limit,
      });
      const batches = [...Map.groupBy(stateJobs, (stateJob) => stateJob.typeName)].flatMap(
        ([typeName, typeJobs]) => chunk(typeJobs, batchLimits[typeName]),
      );
      for (const batch of batches) {
        dispatchBatch(batch);
      }
      startedJobs += stateJobs.length;
      if (batches.length < limit) {
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
      if (await reclaimExpiredWorker(helpers, { workerId, backoffConfigFor })) {
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
  try {
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
  } finally {
    stopSignal.removeEventListener("abort", stop);
  }
  await executor.drain();
  leaseStop.abort();
  await lease;
  observabilityHelper.jobTypeIdleChange(-concurrency, workerId, typeNames);

  try {
    try {
      if (
        leaseLost.signal.aborted ||
        !(await stopOwnWorker(helpers, { workerId, workerToken, backoffConfigFor }))
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
