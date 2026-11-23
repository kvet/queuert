import {
  type Latch,
  type ResettableLatch,
  createLatch,
  createResettableLatch,
} from "@queuert/helpers/latch";
import { serializeError } from "@queuert/helpers/serialize-error";
import { type MaybePromise, step, syncAsync } from "@queuert/sync-async";

import {
  type AnyAttemptMiddleware,
  runHandlerMiddlewareChain,
} from "../attempt-middleware/attempt-middleware.ts";
import {
  type OutcomeJob,
  batchJobOutcomeKeys,
  jobOutcomeKeys,
  parseJobOutcome,
  runApplyJobOutcomes,
} from "../client/implementation.ts";
import { type Helpers, runInMode } from "../client/setup-helpers.ts";
import { type BackoffConfig, calculateBackoffMs } from "../entities/backoff.ts";
import { mapStateChainToChain } from "../entities/chain.ts";
import { type AnyJob, mapStateJobToJob } from "../entities/job.ts";
import {
  JobsAlreadyCompletedError,
  JobsNotFoundError,
  JobsTakenByAnotherWorkerError,
  toSingleChainError,
  toSingleJobError,
} from "../errors.ts";
import type { JobAttemptSpanHandle } from "../observability-adapter/observability-adapter.ts";
import type { BaseTxContext, StateJob } from "../state-adapter/state-adapter.ts";
import { requireTxCtx } from "../state-adapter/tx-context.ts";
import {
  createTxEffects,
  registerTxEffects,
  registerTxEffectsAfterError,
} from "../tx-effects/tx-effects.ts";
import type {
  AnyAttemptHandler,
  AnyBatchAttemptHandler,
  AnyBatchJobOutcomeItem,
  AnyJobOutcomeOptions,
  AnyRunningJob,
} from "./attempt-handler.types.ts";
import { type AttemptOwnership, startAttemptOwnership } from "./attempt-ownership.ts";

type AttemptJob = {
  stateJob: StateJob & { hasBlockers: boolean };
  signal: AbortSignal;
  span: JobAttemptSpanHandle | undefined;
  applying: ResettableLatch;
  written: ResettableLatch<OutcomeJob>;
  committed: Latch;
};

type LostJob = { stateJob: StateJob; current: StateJob | undefined };

type AttemptWrites = {
  applyJobOutcomes: (
    options: BaseTxContext & { items: AnyBatchJobOutcomeItem[] },
  ) => MaybePromise<(AnyJob & { continuedTo?: AnyJob })[]>;
  applyJobOutcome: (
    options: AnyJobOutcomeOptions,
  ) => MaybePromise<AnyJob & { continuedTo?: AnyJob }>;
  fenceJobs: (options: BaseTxContext & { jobs: { id: string }[] }) => MaybePromise<void>;
  fenceJob: (options: BaseTxContext) => MaybePromise<void>;
  close: () => void;
};

const lossError = (workerId: string, lostJobs: LostJob[]): Error => {
  const notFound = lostJobs.filter(({ current }) => current === undefined);
  if (notFound.length > 0) {
    return new JobsNotFoundError("Jobs not found", {
      jobIds: notFound.map(({ stateJob }) => stateJob.id),
    });
  }
  const completed = lostJobs.filter(({ current }) => current!.completedAt !== null);
  if (completed.length > 0) {
    return new JobsAlreadyCompletedError("Jobs are already completed", {
      jobIds: completed.map(({ stateJob }) => stateJob.id),
    });
  }
  return new JobsTakenByAnotherWorkerError("Jobs taken by another worker", {
    jobIds: lostJobs.map(({ stateJob }) => stateJob.id),
    workerId,
    attemptBys: lostJobs.map(({ current }) => current!.attemptBy),
  });
};

const assertEachJobOnce = (method: string, attemptJobs: AttemptJob[]): void => {
  if (new Set(attemptJobs).size !== attemptJobs.length) {
    throw new Error(`${method} requires each job at most once`);
  }
};

const createAttemptWrites = (
  helpers: Helpers,
  {
    attemptJobs,
    workerId,
    workerSlot,
    backoffConfig,
    startTime,
    ownership,
  }: {
    attemptJobs: AttemptJob[];
    workerId: string;
    workerSlot: number;
    backoffConfig: BackoffConfig;
    startTime: number;
    ownership: AttemptOwnership;
  },
): AttemptWrites => {
  const closed = createLatch();
  const attemptJobsById = new Map(
    attemptJobs.map((attemptJob) => [attemptJob.stateJob.id, attemptJob]),
  );

  const pickAttemptJob = (method: string, job: { id?: unknown } | undefined): AttemptJob => {
    const attemptJob = attemptJobsById.get(job?.id as string);
    if (attemptJob === undefined) {
      throw new Error(`${method} accepts only the jobs of this attempt`);
    }
    return attemptJob;
  };

  const loseJobs = (lostJobs: LostJob[]): Error => {
    ownership.abort(lostJobs.map(({ stateJob }) => stateJob.id));
    return lossError(workerId, lostJobs);
  };

  const applyJobOutcomes = syncAsync(function* ({
    items,
    ...txCtxFields
  }: BaseTxContext & { items: AnyBatchJobOutcomeItem[] }) {
    closed.throwIfTripped("applyJobOutcomes cannot be called after the attempt handler has ended");
    if (!Array.isArray(items)) {
      throw new Error("applyJobOutcomes requires an array of items");
    }
    const pickedItems = items.map((item) => ({
      item,
      attemptJob: pickAttemptJob("applyJobOutcomes", item?.job),
    }));
    assertEachJobOnce(
      "applyJobOutcomes",
      pickedItems.map(({ attemptJob }) => attemptJob),
    );
    const outcomeItems = pickedItems.map(({ item, attemptJob }) => ({
      attemptJob,
      outcome: parseJobOutcome(item, {
        method: "applyJobOutcomes",
        outcomeKeys: batchJobOutcomeKeys,
      }),
    }));
    const txCtx = requireTxCtx(helpers.stateAdapter, txCtxFields, "applyJobOutcomes");
    if (outcomeItems.length === 0) return [];
    for (const { attemptJob } of outcomeItems) {
      attemptJob.applying.throwIfTripped();
      attemptJob.written.throwIfTripped();
    }

    for (const { attemptJob } of outcomeItems) {
      attemptJob.applying.trip();
    }
    const effects = createTxEffects();
    try {
      const writtenJobs = yield* runApplyJobOutcomes.steps(helpers, {
        txCtx,
        effects,
        items: outcomeItems.map(({ attemptJob, outcome }) => ({
          job: attemptJob.stateJob,
          outcome,
          attemptToken: attemptJob.stateJob.attemptToken!,
          workerId,
          backoffConfig,
        })),
      });
      const results = outcomeItems.map((outcomeItem, index) => ({
        ...outcomeItem,
        written: writtenJobs[index],
      }));
      const lostJobs = results
        .filter(({ written }) => written === undefined)
        .map(({ attemptJob }) => attemptJob.stateJob);
      if (lostJobs.length > 0) {
        const currentJobs = yield* step(
          helpers.stateAdapter.getJobs({ txCtx, jobIds: lostJobs.map(({ id }) => id) }),
        );
        throw loseJobs(
          lostJobs.map((stateJob, index) => ({ stateJob, current: currentJobs[index] })),
        );
      }

      const settled = results.filter(
        (result): result is typeof result & { written: OutcomeJob } => result.written !== undefined,
      );
      effects.onRollback(() => {
        for (const { attemptJob, written } of settled) {
          if (attemptJob.written.value === written) attemptJob.written.reset();
        }
      });
      effects.onCommit(() => {
        for (const { attemptJob } of settled) {
          attemptJob.committed.trip();
        }
        helpers.observabilityHelper.jobAttemptsSettled(
          settled.map(({ attemptJob, outcome, written }) => ({
            stateJob: attemptJob.stateJob,
            span: attemptJob.span,
            written,
            failure: "fail" in outcome ? { error: outcome.fail } : undefined,
          })),
          { durationMs: Date.now() - startTime, workerId, workerSlot },
        );
      });
      const settledJobs = settled.map(({ written }) => mapStateJobToJob(written, helpers.jobTypes));
      registerTxEffects(helpers, txCtx, effects);
      for (const { attemptJob, written } of settled) {
        attemptJob.written.trip(written);
      }
      return settledJobs;
    } catch (error) {
      registerTxEffectsAfterError(helpers, txCtx, effects);
      throw error;
    } finally {
      for (const { attemptJob } of outcomeItems) {
        attemptJob.applying.reset();
      }
    }
  });

  const applyJobOutcome = syncAsync(function* (options: AnyJobOutcomeOptions) {
    closed.throwIfTripped("applyJobOutcome cannot be called after the attempt handler has ended");
    const { output, continueWith, reschedule, reason, fail, ...txCtxFields } = options;
    const outcome = parseJobOutcome(options, {
      method: "applyJobOutcome",
      outcomeKeys: jobOutcomeKeys,
    });
    const txCtx = requireTxCtx(helpers.stateAdapter, txCtxFields, "applyJobOutcome");
    try {
      const [job] = yield* applyJobOutcomes.steps({
        ...txCtx,
        items: [{ job: attemptJobs[0].stateJob, ...outcome }],
      });
      return job;
    } catch (error) {
      throw toSingleChainError(toSingleJobError(error));
    }
  });

  const fenceJobs = syncAsync(function* ({
    jobs,
    ...txCtxFields
  }: BaseTxContext & { jobs: { id: string }[] }) {
    closed.throwIfTripped("fenceJobs cannot be called after the attempt handler has ended");
    if (!Array.isArray(jobs)) {
      throw new Error("fenceJobs requires an array of jobs");
    }
    const fencedJobs = jobs.map((job) => pickAttemptJob("fenceJobs", job));
    assertEachJobOnce("fenceJobs", fencedJobs);
    const txCtx = requireTxCtx(helpers.stateAdapter, txCtxFields, "fenceJobs");
    if (fencedJobs.length === 0) return;
    const currentJobs = yield* step(
      helpers.stateAdapter.getJobs({
        txCtx,
        jobIds: fencedJobs.map(({ stateJob }) => stateJob.id),
        lock: "exclusive",
      }),
    );
    const lostJobs = fencedJobs
      .map(({ stateJob }, index) => ({ stateJob, current: currentJobs[index] }))
      .filter(
        ({ stateJob, current }) =>
          current?.status !== "running" || current.attemptToken !== stateJob.attemptToken,
      );
    if (lostJobs.length > 0) {
      throw loseJobs(lostJobs);
    }
  });

  const fenceJob = syncAsync(function* (options: BaseTxContext) {
    closed.throwIfTripped("fenceJob cannot be called after the attempt handler has ended");
    const txCtx = requireTxCtx(helpers.stateAdapter, { ...options }, "fenceJob");
    try {
      yield* fenceJobs.steps({ ...txCtx, jobs: [attemptJobs[0].stateJob] });
    } catch (error) {
      throw toSingleJobError(error);
    }
  });

  return {
    applyJobOutcomes: (options) => runInMode(helpers, applyJobOutcomes, options),
    applyJobOutcome: (options) => runInMode(helpers, applyJobOutcome, options),
    fenceJobs: (options) => runInMode(helpers, fenceJobs, options),
    fenceJob: (options) => runInMode(helpers, fenceJob, options),
    close: () => {
      closed.trip();
    },
  };
};

const runAttemptHandler = async ({
  helpers,
  attemptHandler,
  batched,
  attemptMiddleware,
  attemptJobs,
  workerId,
  writes,
}: {
  helpers: Helpers;
  attemptHandler: AnyAttemptHandler | AnyBatchAttemptHandler;
  batched: boolean;
  attemptMiddleware: readonly AnyAttemptMiddleware[] | undefined;
  attemptJobs: AttemptJob[];
  workerId: string;
  writes: AttemptWrites;
}): Promise<void> => {
  const blockerChainsPerJob = attemptJobs.some(({ stateJob }) => stateJob.hasBlockers)
    ? await helpers.stateAdapter.getJobsBlockers({
        jobIds: attemptJobs.map(({ stateJob }) => stateJob.id),
      })
    : attemptJobs.map(() => []);
  const runningJobs: AnyRunningJob[] = attemptJobs.map(({ stateJob, signal }, index) =>
    Object.assign(mapStateJobToJob(stateJob, helpers.jobTypes), {
      blockers: blockerChainsPerJob[index].map((blockerChain) =>
        mapStateChainToChain(blockerChain, helpers.jobTypes),
      ),
      signal,
    }),
  );
  await runHandlerMiddlewareChain(
    attemptMiddleware,
    { jobs: [...runningJobs], workerId },
    async (handlerCtx) =>
      batched
        ? (attemptHandler as AnyBatchAttemptHandler)({
            ...handlerCtx,
            jobs: runningJobs,
            applyJobOutcomes: writes.applyJobOutcomes,
            fenceJobs: writes.fenceJobs,
          })
        : (attemptHandler as AnyAttemptHandler)({
            ...handlerCtx,
            job: runningJobs[0],
            applyJobOutcome: writes.applyJobOutcome,
            fenceJob: writes.fenceJob,
          }),
  );
};

const rescheduleFailedJobs = async (
  helpers: Helpers,
  {
    failedJobs,
    workerId,
    workerSlot,
    backoffConfig,
    failure,
  }: {
    failedJobs: AttemptJob[];
    workerId: string;
    workerSlot: number;
    backoffConfig: BackoffConfig;
    failure: unknown;
  },
): Promise<void> => {
  const error = serializeError(failure);
  let rescheduledJobs: (StateJob | undefined)[];
  try {
    rescheduledJobs = await helpers.stateAdapter.rescheduleJobs({
      jobs: failedJobs.map(({ stateJob }) => ({
        jobId: stateJob.id,
        schedule: {
          afterMs: calculateBackoffMs(stateJob.consecutiveFailures + 1, backoffConfig),
        },
        error,
        attemptToken: stateJob.attemptToken!,
      })),
    });
  } catch (rescheduleError) {
    for (const { span } of failedJobs) {
      span?.end({ status: "failed", error: failure });
    }
    throw rescheduleError;
  }

  const failures = failedJobs.map(({ stateJob, span }, index) => ({
    stateJob,
    span,
    rescheduledJob: rescheduledJobs[index],
  }));
  const notified = helpers.notifyHelper.notifyJobsScheduled(
    failures.flatMap(({ rescheduledJob }) =>
      rescheduledJob === undefined ? [] : [rescheduledJob.typeName],
    ),
  );
  helpers.observabilityHelper.jobAttemptsFailed(failures, { workerId, workerSlot, error: failure });
  await notified;
};

export const runAttempt = async ({
  helpers,
  attemptHandler,
  batched,
  stateJobs,
  backoffConfig,
  workerId,
  workerSlot,
  attemptMiddleware,
  abortSignal,
}: {
  helpers: Helpers;
  attemptHandler: AnyAttemptHandler | AnyBatchAttemptHandler;
  batched: boolean;
  stateJobs: (StateJob & { hasBlockers: boolean })[];
  backoffConfig: BackoffConfig;
  workerId: string;
  workerSlot: number;
  attemptMiddleware?: readonly AnyAttemptMiddleware[];
  abortSignal: AbortSignal;
}): Promise<void> => {
  const ownership = await startAttemptOwnership(helpers, { stateJobs, abortSignal });
  const startTime = Date.now();
  const attemptJobs = stateJobs.map((stateJob): AttemptJob => ({
    stateJob,
    signal: ownership.signals.get(stateJob.id)!,
    span: helpers.observabilityHelper.jobAttemptStarted(stateJob, { workerId, workerSlot }),
    applying: createResettableLatch("an outcome is already being applied for this attempt"),
    written: createResettableLatch<OutcomeJob>("an outcome was already applied for this attempt"),
    committed: createLatch(),
  }));

  const writes = createAttemptWrites(helpers, {
    attemptJobs,
    workerId,
    workerSlot,
    backoffConfig,
    startTime,
    ownership,
  });

  const handlerError: unknown = await runAttemptHandler({
    helpers,
    attemptHandler,
    batched,
    attemptMiddleware,
    attemptJobs,
    workerId,
    writes,
  }).then(
    () => undefined,
    (error: unknown) => error,
  );

  writes.close();
  await ownership.release();

  const unsettledJobs = attemptJobs.filter(({ committed }) => !committed.tripped);
  if (unsettledJobs.length === 0) {
    if (handlerError !== undefined) {
      // oxlint-disable-next-line typescript/only-throw-error -- rethrow the handler's error
      throw handlerError;
    }
    return;
  }

  helpers.observabilityHelper.jobAttemptDuration(
    unsettledJobs.map(({ stateJob }) => stateJob),
    { durationMs: Date.now() - startTime, workerId },
  );
  await rescheduleFailedJobs(helpers, {
    failedJobs: unsettledJobs,
    workerId,
    workerSlot,
    backoffConfig,
    failure:
      handlerError ??
      new Error(
        batched
          ? "Attempt handler returned without a committed `applyJobOutcomes` call for the job"
          : "Attempt handler returned without a committed `applyJobOutcome` call",
      ),
  });
};
