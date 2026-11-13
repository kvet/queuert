import { createLatch, createResettableLatch } from "@queuert/helpers/latch";
import { type MaybePromise, andThen, tryFinally } from "@queuert/helpers/maybe-promise";
import { serializeError } from "@queuert/helpers/serialize-error";

import { runCompleteChain, runContinueChain, runRescheduleJobs } from "../client/implementation.ts";
import { type Helpers, runInMode } from "../client/setup-helpers.ts";
import { type BackoffConfig, calculateBackoffMs } from "../entities/backoff.ts";
import { type AnyJob, mapStateJobToJob } from "../entities/job.ts";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
} from "../errors.ts";
import type { JobAttemptSpanHandle } from "../observability-adapter/observability-adapter.ts";
import type {
  BaseTxContext,
  StateChain,
  StateJob,
  StateJobInfo,
} from "../state-adapter/state-adapter.ts";
import { requireTxCtx } from "../state-adapter/tx-context.ts";
import type { AnyCompleteOptions } from "./attempt-handler.types.ts";
import type { AttemptOwnership } from "./attempt-ownership.ts";

type CompleteWrite = {
  stateJob: StateJob & { continuation?: StateJobInfo };
  job: AnyJob & { continuedTo?: AnyJob };
};

export type AttemptWrites = {
  complete: (options: AnyCompleteOptions) => MaybePromise<AnyJob & { continuedTo?: AnyJob }>;
  fence: (options: BaseTxContext) => MaybePromise<void>;
  close: () => CompleteWrite | null;
};

export const createAttemptWrites = (
  helpers: Helpers,
  {
    stateJob,
    workerId,
    attemptToken,
    ownership,
  }: { stateJob: StateJob; workerId: string; attemptToken: string; ownership: AttemptOwnership },
): AttemptWrites => {
  const closed = createLatch();
  const inProgress = createResettableLatch("complete is already in progress for this attempt");
  const written = createResettableLatch<CompleteWrite>(
    "complete already succeeded for this attempt",
  );
  const committed = createLatch<CompleteWrite>();

  const throwLossError = (txCtx: BaseTxContext): MaybePromise<never> =>
    andThen(helpers.stateAdapter.getJobs({ txCtx, jobIds: [stateJob.id] }), ([job]) => {
      throw lossError(job);
    });

  const lossError = (job: StateJob | undefined): Error => {
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

  const recordWrite = (txCtx: BaseTxContext, stateJobWritten: CompleteWrite["stateJob"]) => {
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
  };

  const complete = (
    options: AnyCompleteOptions,
  ): MaybePromise<AnyJob & { continuedTo?: AnyJob }> => {
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
    return tryFinally(
      () =>
        andThen(
          "reschedule" in options
            ? andThen(
                runRescheduleJobs(helpers, {
                  txCtx,
                  jobs: [{ jobId: stateJob.id, schedule: reschedule, attemptToken }],
                }),
                ([rescheduled]) => rescheduled,
              )
            : continueWith === undefined
              ? runCompleteChain(helpers, {
                  job: stateJob,
                  output,
                  txCtx,
                  attemptToken,
                  workerId,
                })
              : runContinueChain(helpers, {
                  job: stateJob,
                  continueWith,
                  txCtx,
                  attemptToken,
                  workerId,
                }),
          (stateJobWritten): MaybePromise<AnyJob & { continuedTo?: AnyJob }> =>
            stateJobWritten === undefined
              ? throwLossError(txCtx)
              : recordWrite(txCtx, stateJobWritten),
        ),
      () => {
        inProgress.reset();
      },
    );
  };

  const fence = (options: BaseTxContext): MaybePromise<void> => {
    closed.throwIfTripped("fence cannot be called after the attempt handler has ended");
    const txCtx = requireTxCtx(helpers.stateAdapter, { ...options }, "fence");
    return andThen(
      helpers.stateAdapter.getJobs({
        txCtx,
        jobIds: [stateJob.id],
        lock: "exclusive",
      }),
      ([job]) => {
        if (job?.status !== "running" || job.attemptToken !== attemptToken) {
          throw lossError(job);
        }
      },
    );
  };

  return {
    complete: (options) => runInMode(helpers, () => complete(options)),
    fence: (options) => runInMode(helpers, () => fence(options)),
    close: () => {
      closed.trip();
      return committed.value ?? null;
    },
  };
};

export const runRescheduleFailedAttempt = async (
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

  helpers.observabilityHelper.jobRescheduled(rescheduledJob);
  helpers.observabilityHelper.jobAttemptFailed(stateJob, { workerId, error: failure });
  span?.end({ status: "failed", error: failure });
  await helpers.notifyHelper.notifyJobsScheduled([rescheduledJob.typeName]);
  return true;
};

export const runGetJobBlockers = async (
  { stateAdapter }: Helpers,
  options: { jobId: string },
): Promise<StateChain[]> => Promise.resolve(stateAdapter.getJobBlockers(options));
