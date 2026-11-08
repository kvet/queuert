import { serializeError, createLatch } from "@queuert/helpers";

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
import { requireTxCtx, requireTxHooks } from "../state-adapter/tx-context.ts";
import { type TxHooks, createTxHooks } from "../tx-hooks/tx-hooks.ts";
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
  let committed: CompleteWrite | null = null;

  const completeSlots = new WeakMap<
    TxHooks,
    { write: CompleteWrite | null; inProgress: boolean }
  >();
  const getCompleteSlot = (txHooks: TxHooks) => {
    const existing = completeSlots.get(txHooks);
    if (existing !== undefined) return existing;
    const created = { write: null, inProgress: false };
    completeSlots.set(txHooks, created);
    return created;
  };

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
    const { txHooks, output, continueWith, reschedule, ...txCtxFields } = options;
    const outcomeKeys = ["output", "continueWith", "reschedule"].filter((key) => key in options);
    if (outcomeKeys.length !== 1) {
      throw new Error("complete requires exactly one of output, continueWith or reschedule");
    }
    requireTxHooks(txHooks, "complete");
    const txCtx = requireTxCtx(helpers.stateAdapter, txCtxFields, "complete");

    const completeSlot = getCompleteSlot(txHooks);
    if (completeSlot.inProgress) {
      throw new Error("complete is already in progress with these txHooks");
    }
    if (completeSlot.write !== null) {
      throw new Error(
        "complete already succeeded with these txHooks; wrap a callback the driver reruns in txHooks.retryBoundary, or give a retried transaction its own withTxHooks",
      );
    }
    txHooks.onRollback(() => {
      completeSlot.write = null;
    });
    completeSlot.inProgress = true;
    try {
      const stateJobWritten =
        "reschedule" in options
          ? (
              await rescheduleJobs(helpers, {
                txCtx,
                txHooks,
                jobs: [{ jobId: stateJob.id, schedule: reschedule, attemptToken }],
              })
            )[0]
          : continueWith === undefined
            ? await completeChain(helpers, {
                job: stateJob,
                output,
                txCtx,
                txHooks,
                attemptToken,
                workerId,
              })
            : await continueChain(helpers, {
                job: stateJob,
                continueWith,
                txCtx,
                txHooks,
                attemptToken,
                workerId,
              });
      if (stateJobWritten === undefined) {
        throw await readLossError(txCtx);
      }

      const write: CompleteWrite = {
        stateJob: stateJobWritten,
        job: mapStateJobToJob(stateJobWritten),
      };
      completeSlot.write = write;
      txHooks.onCommit(() => {
        helpers.observabilityHelper.jobAttemptCompleted(stateJob, {
          output: write.stateJob.output,
          continuedWith: write.stateJob.continuation,
          workerId,
        });
      });
      txHooks.onCommit(() => {
        committed = write;
      });
      return write.job;
    } finally {
      completeSlot.inProgress = false;
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
  const { txHooks, flush } = createTxHooks();
  try {
    const [rescheduledJob] = await rescheduleJobs(helpers, {
      jobs: [
        {
          jobId: stateJob.id,
          schedule: { afterMs: calculateBackoffMs(stateJob.attempt, backoffConfig) },
          error: serializeError(failure),
          attemptToken,
        },
      ],
      txHooks,
    });
    if (!rescheduledJob) return false;
  } catch (rescheduleError) {
    span?.end({ status: "failed", error: failure });
    throw rescheduleError;
  }

  txHooks.onCommit(() => {
    helpers.observabilityHelper.jobAttemptFailed(stateJob, { workerId, error: failure });
  });
  if (span !== undefined) {
    txHooks.onCommit(() => {
      span.end({ status: "failed", error: failure });
    });
  }
  await flush();
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
