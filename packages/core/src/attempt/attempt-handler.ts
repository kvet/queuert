import { serializeError } from "@queuert/helpers";

import {
  type AnyAttemptMiddleware,
  runHandlerMiddlewareChain,
} from "../attempt-middleware/attempt-middleware.js";
import { type BackoffConfig, calculateBackoffMs } from "../entities/backoff.js";
import { mapStateChainToChain } from "../entities/chain.js";
import { type AnyJob, mapStateJobToJob } from "../entities/job.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
} from "../errors.js";
import { completeChain, continueChain, rescheduleJobs } from "../implementation.js";
import { type JobAttemptSpanHandle } from "../observability-adapter/observability-adapter.js";
import { bufferObservabilityEvent } from "../observability-adapter/observability-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import {
  type BaseTxContext,
  type StateAttemptFence,
  type StateJob,
  type StateJobInfo,
} from "../state-adapter/state-adapter.js";
import { requireTxCtx } from "../state-adapter/tx-context.js";
import { createTransactionHooks, requireTransactionHooks } from "../transaction-hooks.js";
import { type AttemptConfig } from "./attempt-config.js";
import { type AnyAttemptHandler, type AnyCompleteOptions } from "./attempt-handler.types.js";
import { type AttemptOwnership, startAttemptOwnership } from "./attempt-ownership.js";

type CompleteWrite = {
  stateJob: StateJob & { continuation?: StateJobInfo };
  job: AnyJob & { continuedTo?: AnyJob };
};

const createComplete = (
  helpers: Helpers,
  {
    stateJob,
    workerId,
    fence,
    ownership,
  }: {
    stateJob: StateJob;
    workerId: string;
    fence: StateAttemptFence;
    ownership: AttemptOwnership;
  },
) => {
  let closed = false;
  let committed: CompleteWrite | null = null;

  const completeHookKey = Symbol("queuert.complete");

  let lossReported = false;
  const readLossError = async (txCtx: BaseTxContext): Promise<Error> => {
    const [job] = await helpers.stateAdapter.getJobs({ txCtx, jobIds: [stateJob.id] });
    ownership.abort();
    ownership.reportExpiredAttempt();
    const firstLossReport = !lossReported;
    lossReported = true;
    if (!job) {
      return new JobNotFoundError(`Job not found`, { jobId: stateJob.id });
    }
    if (job.completedAt !== null) {
      if (firstLossReport)
        helpers.observabilityHelper.jobAttemptAlreadyCompleted(job, { workerId });
      return new JobAlreadyCompletedError("Job is already completed", { jobId: stateJob.id });
    }
    if (firstLossReport)
      helpers.observabilityHelper.jobAttemptTakenByAnotherWorker(job, { workerId });
    return new JobTakenByAnotherWorkerError(`Job taken by another worker`, {
      jobId: stateJob.id,
      workerId,
      attemptBy: job.attemptBy,
    });
  };

  const complete = async (options: AnyCompleteOptions) => {
    if (closed) {
      throw new Error("complete cannot be called after the attempt handler has ended");
    }
    const { transactionHooks, output, continueWith, reschedule, ...txCtxFields } = options;
    const outcomeKeys = ["output", "continueWith", "reschedule"].filter((key) => key in options);
    if (outcomeKeys.length !== 1) {
      throw new Error("complete requires exactly one of output, continueWith or reschedule");
    }
    requireTransactionHooks(transactionHooks, "complete");
    const txCtx = requireTxCtx(helpers.stateAdapter, txCtxFields, "complete");

    const completeSlot = transactionHooks.getOrInsert(completeHookKey, () => {
      const state = { write: null as CompleteWrite | null, inProgress: false };
      ownership.trackCompleteSlot(state);
      return {
        state,
        checkpoint: (state) => {
          const write = state.write;
          return () => {
            state.write = write;
          };
        },
        flush: (state) => {
          if (state.write === null) return;
          committed = state.write;
          void ownership.stopHeartbeat();
        },
        discard: (state) => {
          state.write = null;
        },
      };
    });
    if (completeSlot.inProgress) {
      throw new Error("complete is already in progress with these transactionHooks");
    }
    if (completeSlot.write !== null) {
      throw new Error(
        "complete already succeeded with these transactionHooks; a retried transaction needs its own withTransactionHooks",
      );
    }
    completeSlot.inProgress = true;
    try {
      ownership.reportExpiredAttempt();

      const stateJobWritten =
        "reschedule" in options
          ? (
              await rescheduleJobs(helpers, {
                txCtx,
                transactionHooks,
                jobs: [{ jobId: stateJob.id, schedule: reschedule, fence }],
              })
            )[0]
          : continueWith === undefined
            ? await completeChain(helpers, {
                job: stateJob,
                output,
                txCtx,
                transactionHooks,
                fence,
              })
            : await continueChain(helpers, {
                job: stateJob,
                continueWith,
                txCtx,
                transactionHooks,
                fence,
              });
      if (stateJobWritten === undefined) {
        throw await readLossError(txCtx);
      }

      completeSlot.write = { stateJob: stateJobWritten, job: mapStateJobToJob(stateJobWritten) };
      return completeSlot.write.job;
    } finally {
      completeSlot.inProgress = false;
    }
  };

  return {
    complete,
    close: () => {
      closed = true;
      return committed;
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
}: {
  helpers: Helpers;
  attemptHandler: AnyAttemptHandler;
  attemptMiddleware: readonly AnyAttemptMiddleware[] | undefined;
  stateJob: StateJob & { hasBlockers: boolean };
  workerId: string;
  signal: AbortSignal;
  complete: Parameters<AnyAttemptHandler>[0]["complete"];
}): Promise<void> => {
  const blockerChains = stateJob.hasBlockers
    ? await helpers.stateAdapter.getJobBlockers({ jobId: stateJob.id })
    : [];
  const runningJob = {
    ...mapStateJobToJob(stateJob),
    blockers: blockerChains.map(mapStateChainToChain),
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
      }),
  );
};

const rescheduleFailedAttempt = async (
  helpers: Helpers,
  {
    stateJob,
    workerId,
    span,
    fence,
    backoffConfig,
    failure,
  }: {
    stateJob: StateJob;
    workerId: string;
    span: JobAttemptSpanHandle | undefined;
    fence: StateAttemptFence;
    backoffConfig: BackoffConfig;
    failure: unknown;
  },
): Promise<boolean> => {
  const { transactionHooks, flush } = createTransactionHooks();
  try {
    const [rescheduledJob] = await rescheduleJobs(helpers, {
      jobs: [
        {
          jobId: stateJob.id,
          schedule: { afterMs: calculateBackoffMs(stateJob.attempt, backoffConfig) },
          error: serializeError(failure),
          fence,
        },
      ],
      transactionHooks,
    });
    if (!rescheduledJob) return false;
  } catch (rescheduleError) {
    span?.end({ status: "failed", error: failure });
    throw rescheduleError;
  }

  bufferObservabilityEvent(transactionHooks, () => {
    helpers.observabilityHelper.jobAttemptFailed(stateJob, { workerId, error: failure });
    span?.end({ status: "failed", error: failure });
  });
  await flush();
  return true;
};

export const runAttempt = async ({
  helpers,
  attemptHandler,
  stateJob,
  backoffConfig,
  attemptConfig,
  workerId,
  attemptMiddleware,
  stopSignal,
}: {
  helpers: Helpers;
  attemptHandler: AnyAttemptHandler;
  stateJob: StateJob & { hasBlockers: boolean };
  backoffConfig: BackoffConfig;
  attemptConfig: AttemptConfig;
  workerId: string;
  attemptMiddleware?: readonly AnyAttemptMiddleware[];
  stopSignal: AbortSignal;
}): Promise<void> => {
  const fence: StateAttemptFence = { attempt: stateJob.attempt, workerId };
  const ownership = await startAttemptOwnership(helpers, {
    stateJob,
    fence,
    workerId,
    attemptConfig,
    stopSignal,
  });
  const startTime = Date.now();
  helpers.observabilityHelper.jobAttemptStarted(stateJob, { workerId });
  const span = helpers.observabilityHelper.startAttemptSpan(stateJob, { workerId });

  const { complete, close } = createComplete(helpers, { stateJob, workerId, fence, ownership });

  const handlerError: unknown = await runAttemptHandler({
    helpers,
    attemptHandler,
    attemptMiddleware,
    stateJob,
    workerId,
    signal: ownership.signal,
    complete,
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
      fence,
      backoffConfig,
      failure,
    });
    if (!rescheduled) span?.end({ status: "failed", error: failure });
    return;
  }

  const { stateJob: finished } = committed;
  helpers.observabilityHelper.jobAttemptCompleted(stateJob, {
    output: finished.output,
    continuedWith: finished.continuation,
    workerId,
  });
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
