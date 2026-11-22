import { createLatch, createResettableLatch } from "@queuert/helpers/latch";
import { serializeError } from "@queuert/helpers/serialize-error";
import { type MaybePromise, step, syncAsync } from "@queuert/sync-async";

import {
  type AnyAttemptMiddleware,
  runHandlerMiddlewareChain,
} from "../attempt-middleware/attempt-middleware.ts";
import { parseJobOutcome, runApplyJobOutcomes } from "../client/implementation.ts";
import { type Helpers, runInMode } from "../client/setup-helpers.ts";
import { type BackoffConfig, calculateBackoffMs } from "../entities/backoff.ts";
import { mapStateChainToChain } from "../entities/chain.ts";
import { type AnyJob, mapStateJobToJob } from "../entities/job.ts";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
  toSingleChainError,
  toSingleJobError,
} from "../errors.ts";
import type { JobAttemptSpanHandle } from "../observability-adapter/observability-adapter.ts";
import { completedAttemptSpanResult } from "../observability-adapter/observability-helper.ts";
import type { BaseTxContext, StateJob, StateJobInfo } from "../state-adapter/state-adapter.ts";
import { requireTxCtx } from "../state-adapter/tx-context.ts";
import type { AnyAttemptHandler, AnyCompleteOptions } from "./attempt-handler.types.ts";
import { type AttemptOwnership, startAttemptOwnership } from "./attempt-ownership.ts";

type CompleteWrite = {
  stateJob: StateJob & { continuation?: StateJobInfo };
  job: AnyJob & { continuedTo?: AnyJob };
};

type AttemptWrites = {
  complete: (options: AnyCompleteOptions) => MaybePromise<AnyJob & { continuedTo?: AnyJob }>;
  fence: (options: BaseTxContext) => MaybePromise<void>;
  close: () => CompleteWrite | null;
};

const createAttemptWrites = (
  helpers: Helpers,
  {
    stateJob,
    workerId,
    attemptToken,
    ownership,
  }: {
    stateJob: StateJob;
    workerId: string;
    attemptToken: string;
    ownership: AttemptOwnership;
  },
): AttemptWrites => {
  const closed = createLatch();
  const inProgress = createResettableLatch("complete is already in progress for this attempt");
  const written = createResettableLatch<CompleteWrite>(
    "complete already succeeded for this attempt",
  );
  const committed = createLatch<CompleteWrite>();

  const readLossError = syncAsync(function* (txCtx: BaseTxContext) {
    const [job] = yield* step(helpers.stateAdapter.getJobs({ txCtx, jobIds: [stateJob.id] }));
    ownership.abort();
    if (!job) {
      return new JobNotFoundError(`Job not found`, { jobId: stateJob.id });
    }
    if (job.completedAt !== null) {
      return new JobAlreadyCompletedError("Job is already completed", { jobId: stateJob.id });
    }
    return new JobTakenByAnotherWorkerError(`Job taken by another worker`, {
      jobId: stateJob.id,
      workerId,
      attemptBy: job.attemptBy,
    });
  });

  const complete = syncAsync(function* (options: AnyCompleteOptions) {
    closed.throwIfTripped("complete cannot be called after the attempt handler has ended");
    const { output, continueWith, reschedule, reason, ...txCtxFields } = options;
    const outcome = parseJobOutcome(options, "complete");
    const txCtx = requireTxCtx(helpers.stateAdapter, txCtxFields, "complete");
    inProgress.throwIfTripped();
    written.throwIfTripped();

    inProgress.trip();
    try {
      const [stateJobWritten] = yield* runApplyJobOutcomes.steps(helpers, {
        txCtx,
        items: [{ job: stateJob, outcome, attemptToken, workerId }],
      });
      if (stateJobWritten === undefined) {
        throw yield* readLossError.steps(txCtx);
      }

      const write: CompleteWrite = {
        stateJob: stateJobWritten,
        job: mapStateJobToJob(stateJobWritten, helpers.jobTypes),
      };
      helpers.stateAdapter.onTransactionRollback(txCtx, () => {
        if (written.value === write) written.reset();
      });
      written.trip(write);
      helpers.stateAdapter.onTransactionCommit(txCtx, () => {
        helpers.observabilityHelper.jobAttemptCompleted(stateJob, {
          output: write.stateJob.output,
          continuedWith: write.stateJob.continuation,
          workerId,
        });
      });
      helpers.stateAdapter.onTransactionCommit(txCtx, () => {
        committed.trip(write);
      });
      return write.job;
    } catch (error) {
      throw toSingleChainError(toSingleJobError(error));
    } finally {
      inProgress.reset();
    }
  });

  const fence = syncAsync(function* (options: BaseTxContext) {
    closed.throwIfTripped("fence cannot be called after the attempt handler has ended");
    const txCtx = requireTxCtx(helpers.stateAdapter, { ...options }, "fence");
    const [job] = yield* step(
      helpers.stateAdapter.getJobs({
        txCtx,
        jobIds: [stateJob.id],
        lock: "exclusive",
      }),
    );
    if (job?.status !== "running" || job.attemptToken !== attemptToken) {
      throw yield* readLossError.steps(txCtx);
    }
  });

  return {
    complete: (options) => runInMode(helpers, complete, options),
    fence: (options) => runInMode(helpers, fence, options),
    close: () => {
      closed.trip();
      return committed.value ?? null;
    },
  };
};

const runAttemptHandler = async ({
  helpers,
  attemptHandler,
  attemptMiddleware,
  stateJob,
  workerId,
  signal,
  complete,
  fence,
}: {
  helpers: Helpers;
  attemptHandler: AnyAttemptHandler;
  attemptMiddleware: readonly AnyAttemptMiddleware[] | undefined;
  stateJob: StateJob & { hasBlockers: boolean };
  workerId: string;
  signal: AbortSignal;
  complete: AttemptWrites["complete"];
  fence: AttemptWrites["fence"];
}): Promise<void> => {
  const blockerChains = stateJob.hasBlockers
    ? await helpers.stateAdapter.getJobBlockers({ jobId: stateJob.id })
    : [];
  const runningJob = Object.assign(mapStateJobToJob(stateJob, helpers.jobTypes), {
    blockers: blockerChains.map((blockerChain) =>
      mapStateChainToChain(blockerChain, helpers.jobTypes),
    ),
  });
  await runHandlerMiddlewareChain(
    attemptMiddleware,
    { job: runningJob, workerId },
    async (handlerCtx) =>
      attemptHandler({
        ...handlerCtx,
        signal,
        job: runningJob,
        complete,
        fence,
      }),
  );
};

const rescheduleFailedAttempt = async (
  helpers: Helpers,
  {
    stateJob,
    workerId,
    span,
    attemptToken,
    backoffConfig,
    failure,
  }: {
    stateJob: StateJob;
    workerId: string;
    span: JobAttemptSpanHandle | undefined;
    attemptToken: string;
    backoffConfig: BackoffConfig;
    failure: unknown;
  },
): Promise<boolean> => {
  let rescheduledJob: StateJob | undefined;
  try {
    [rescheduledJob] = await helpers.stateAdapter.rescheduleJobs({
      jobs: [
        {
          jobId: stateJob.id,
          schedule: {
            afterMs: calculateBackoffMs(stateJob.consecutiveFailures + 1, backoffConfig),
          },
          error: serializeError(failure),
          attemptToken,
        },
      ],
    });
  } catch (rescheduleError) {
    span?.end({ status: "failed", error: failure });
    throw rescheduleError;
  }
  if (!rescheduledJob) return false;

  const notified = helpers.notifyHelper.notifyJobsScheduled([rescheduledJob.typeName]);
  helpers.observabilityHelper.jobRescheduled(rescheduledJob);
  helpers.observabilityHelper.jobAttemptFailed(stateJob, { workerId, error: failure });
  span?.end({ status: "failed", error: failure });
  await notified;
  return true;
};

export const runAttempt = async ({
  helpers,
  attemptHandler,
  stateJob,
  backoffConfig,
  workerId,
  attemptMiddleware,
  abortSignal,
}: {
  helpers: Helpers;
  attemptHandler: AnyAttemptHandler;
  stateJob: StateJob & { hasBlockers: boolean };
  backoffConfig: BackoffConfig;
  workerId: string;
  attemptMiddleware?: readonly AnyAttemptMiddleware[];
  abortSignal: AbortSignal;
}): Promise<void> => {
  const ownership = await startAttemptOwnership(helpers, { stateJob, abortSignal });
  const startTime = Date.now();
  helpers.observabilityHelper.jobAttemptStarted(stateJob, { workerId });
  const span = helpers.observabilityHelper.startAttemptSpan(stateJob, { workerId });

  const { complete, fence, close } = createAttemptWrites(helpers, {
    stateJob,
    workerId,
    attemptToken: stateJob.attemptToken!,
    ownership,
  });

  const handlerError: unknown = await runAttemptHandler({
    helpers,
    attemptHandler,
    attemptMiddleware,
    stateJob,
    workerId,
    signal: ownership.signal,
    complete,
    fence,
  }).then(
    () => undefined,
    (error: unknown) => error,
  );

  const committed = close();
  await ownership.release();

  helpers.observabilityHelper.jobAttemptDuration(stateJob, {
    durationMs: Date.now() - startTime,
    workerId,
  });

  if (committed === null) {
    const failure =
      handlerError ?? new Error("Attempt handler returned without a committed `complete` call");
    const rescheduled = await rescheduleFailedAttempt(helpers, {
      stateJob,
      workerId,
      span,
      attemptToken: stateJob.attemptToken!,
      backoffConfig,
      failure,
    });
    if (!rescheduled) {
      helpers.observabilityHelper.jobAttemptLost(stateJob, { workerId });
      span?.end({ status: "failed", error: failure });
    }
    return;
  }

  span?.end(completedAttemptSpanResult(committed.stateJob));
  if (handlerError !== undefined) {
    // oxlint-disable-next-line typescript/only-throw-error -- rethrow the handler's error
    throw handlerError;
  }
};
