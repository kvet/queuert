import { createLatch, createResettableLatch } from "@queuert/helpers/latch";
import { serializeError } from "@queuert/helpers/serialize-error";

import {
  type AnyAttemptMiddleware,
  runHandlerMiddlewareChain,
} from "../attempt-middleware/attempt-middleware.ts";
import { type BackoffConfig, calculateBackoffMs } from "../entities/backoff.ts";
import { mapStateChainToChain } from "../entities/chain.ts";
import { type AnyJob, mapStateJobToJob } from "../entities/job.ts";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
} from "../errors.ts";
import { completeChain, continueChain, rescheduleJobs } from "../implementation.ts";
import type { JobAttemptSpanHandle } from "../observability-adapter/observability-adapter.ts";
import type { Helpers } from "../setup-helpers.ts";
import type { BaseTxContext, StateJob, StateJobInfo } from "../state-adapter/state-adapter.ts";
import { requireTxCtx } from "../state-adapter/tx-context.ts";
import type { AnyAttemptHandler, AnyCompleteOptions } from "./attempt-handler.types.ts";
import { type AttemptOwnership, startAttemptOwnership } from "./attempt-ownership.ts";

type CompleteWrite = {
  stateJob: StateJob & { continuation?: StateJobInfo };
  job: AnyJob & { continuedTo?: AnyJob };
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
) => {
  const closed = createLatch();
  const inProgress = createResettableLatch("complete is already in progress for this attempt");
  const written = createResettableLatch<CompleteWrite>(
    "complete already succeeded for this attempt",
  );
  const committed = createLatch<CompleteWrite>();

  const readLossError = async (txCtx: BaseTxContext): Promise<Error> => {
    const [job] = await helpers.stateAdapter.getJobs({ txCtx, jobIds: [stateJob.id] });
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
  };

  const complete = async (options: AnyCompleteOptions) => {
    closed.throwIfTripped("complete cannot be called after the attempt handler has ended");
    const { output, continueWith, reschedule, ...txCtxFields } = options;
    const outcomeKeys = ["output", "continueWith", "reschedule"].filter((key) => key in options);
    if (outcomeKeys.length !== 1) {
      throw new Error("complete requires exactly one of output, continueWith or reschedule");
    }
    const txCtx = requireTxCtx(helpers.stateAdapter, txCtxFields, "complete");
    inProgress.throwIfTripped();
    written.throwIfTripped();

    inProgress.trip();
    try {
      const stateJobWritten =
        "reschedule" in options
          ? (
              await rescheduleJobs(helpers, {
                txCtx,
                jobs: [{ jobId: stateJob.id, schedule: reschedule, attemptToken }],
              })
            )[0]
          : continueWith === undefined
            ? await completeChain(helpers, {
                job: stateJob,
                output,
                txCtx,
                attemptToken,
                workerId,
              })
            : await continueChain(helpers, {
                job: stateJob,
                continueWith,
                txCtx,
                attemptToken,
                workerId,
              });
      if (stateJobWritten === undefined) {
        throw await readLossError(txCtx);
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
    } finally {
      inProgress.reset();
    }
  };

  const fence = async (options: BaseTxContext) => {
    closed.throwIfTripped("fence cannot be called after the attempt handler has ended");
    const txCtx = requireTxCtx(helpers.stateAdapter, { ...options }, "fence");
    const [job] = await helpers.stateAdapter.getJobs({
      txCtx,
      jobIds: [stateJob.id],
      lock: "exclusive",
    });
    if (job?.status !== "running" || job.attemptToken !== attemptToken) {
      throw await readLossError(txCtx);
    }
  };

  return {
    complete,
    fence,
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
  complete: Parameters<AnyAttemptHandler>[0]["complete"];
  fence: Parameters<AnyAttemptHandler>[0]["fence"];
}): Promise<void> => {
  const blockerChains = stateJob.hasBlockers
    ? await helpers.stateAdapter.getJobBlockers({ jobId: stateJob.id })
    : [];
  const runningJob = {
    ...mapStateJobToJob(stateJob, helpers.jobTypes),
    blockers: blockerChains.map((blockerChain) =>
      mapStateChainToChain(blockerChain, helpers.jobTypes),
    ),
  };
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
          schedule: { afterMs: calculateBackoffMs(stateJob.attempt, backoffConfig) },
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

  const { stateJob: finished } = committed;
  span?.end({
    status: "completed",
    continuedWith: finished.continuation
      ? { jobId: finished.continuation.id, jobTypeName: finished.continuation.typeName }
      : undefined,
    chainCompleted:
      finished.completedAt !== null && finished.continuedToId === null
        ? { output: finished.output }
        : undefined,
  });
  if (handlerError !== undefined) {
    // oxlint-disable-next-line typescript/only-throw-error -- rethrow the handler's error
    throw handlerError;
  }
};
