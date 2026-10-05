import { mapStateChainToChain } from "../entities/chain.js";
import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type ResolvedRunningJob } from "../entities/job-types.resolvers.js";
import { mapStateJobToJob } from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
} from "../errors.js";
import { type TypedAbortController } from "../helpers/abort.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import { bufferNotifyJobScheduled } from "../helpers/notify-hooks.js";
import { bufferObservabilityEvent } from "../helpers/observability-hooks.js";
import { type FinishResult, mapFinishResult } from "../implementation/attempt-outcome.js";
import { completeChain } from "../implementation/complete-chain.js";
import { type AnyContinueWith, continueChain } from "../implementation/continue-chain.js";
import { rescheduleFailedAttempt } from "../implementation/handle-job-handler-error.js";
import { type Helpers } from "../setup-helpers.js";
import {
  type BaseTxContext,
  type StateAdapter,
  type StateAttemptFence,
  type StateJob,
} from "../state-adapter/state-adapter.js";
import {
  type TransactionHooks,
  type TransactionHooksHandle,
  createTransactionHooks,
} from "../transaction-hooks.js";
import { type AttemptConfig, createAttemptHeartbeat } from "./attempt-heartbeat.js";
import { type AnyAttemptMiddleware, runHandlerMiddlewareChain } from "./attempt-middleware.js";
import { type AttemptHandler, type JobAbortReason } from "./job-process.types.js";

export type {
  AttemptFinish,
  AttemptGetBlockers,
  AttemptHandler,
  JobAbortReason,
} from "./job-process.types.js";

type LostReason = "not_found" | "already_completed" | "taken_by_another_worker";

/**
 * Who owns the job now, from this attempt's point of view: still this attempt, finished by
 * this attempt's own committed `finish`, or lost to something else.
 */
type AttemptOwnership =
  | { status: "owned" }
  | { status: "finished"; job: StateJob }
  | { status: "lost"; reason: LostReason; job: StateJob | undefined };

const nonEmptyTxCtx = (txCtx: BaseTxContext | undefined): BaseTxContext | undefined =>
  txCtx !== undefined && Object.keys(txCtx).length > 0 ? txCtx : undefined;

export const runJobProcess = async ({
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
  attemptHandler: AttemptHandler<
    StateAdapter<BaseTxContext, any>,
    BaseJobTypeDefinitions,
    string,
    string,
    Record<string, unknown>
  >;
  stateJob: StateJob;
  backoffConfig: BackoffConfig;
  attemptConfig: AttemptConfig;
  workerId: string;
  attemptMiddleware?: readonly AnyAttemptMiddleware[];
  stopSignal: AbortSignal;
}): Promise<void> => {
  const fence: StateAttemptFence = { attempt: stateJob.attempt, workerId };
  const abortController = new AbortController() as TypedAbortController<JobAbortReason>;

  let cleanupStopListener: (() => void) | null = null;
  if (stopSignal.aborted) {
    abortController.abort("worker_stopping");
  } else {
    const onStop = () => {
      if (!abortController.signal.aborted) {
        abortController.abort("worker_stopping");
      }
    };
    stopSignal.addEventListener("abort", onStop, { once: true });
    cleanupStopListener = () => {
      stopSignal.removeEventListener("abort", onStop);
    };
    abortController.signal.addEventListener("abort", () => cleanupStopListener?.(), { once: true });
  }

  let leaseUntil = stateJob.attemptUntil;
  let expiredReported = false;
  const reportExpiredLease = () => {
    if (expiredReported || leaseUntil === null || leaseUntil.getTime() >= Date.now()) return;
    expiredReported = true;
    helpers.observabilityHelper.jobAttemptExpired(stateJob, { workerId });
  };

  const readJob = async (txCtx?: BaseTxContext): Promise<StateJob | undefined> => {
    const [job] = await helpers.stateAdapter.getJobs({ txCtx, jobIds: [stateJob.id] });
    return job;
  };

  const classifyOwnership = (job: StateJob | undefined): AttemptOwnership => {
    if (!job) return { status: "lost", reason: "not_found", job };
    if (job.attempt === fence.attempt) {
      if (job.status === "running" && job.attemptBy === workerId) return { status: "owned" };
      if (job.status === "completed" && job.completedBy === workerId) {
        return { status: "finished", job };
      }
      if (
        job.status === "pending" &&
        job.lastAttemptError === null &&
        job.lastAttemptAt !== null &&
        stateJob.attemptAt !== null &&
        job.lastAttemptAt.getTime() >= stateJob.attemptAt.getTime()
      ) {
        return { status: "finished", job };
      }
    }
    return {
      status: "lost",
      reason: job.completedAt !== null ? "already_completed" : "taken_by_another_worker",
      job,
    };
  };

  const createLossError = (ownership: { reason: LostReason; job: StateJob | undefined }) => {
    switch (ownership.reason) {
      case "not_found":
        return new JobNotFoundError(`Job not found`, { jobId: stateJob.id });
      case "already_completed":
        return new JobAlreadyCompletedError("Job is already completed", { jobId: stateJob.id });
      case "taken_by_another_worker":
        return new JobTakenByAnotherWorkerError(`Job taken by another worker`, {
          jobId: stateJob.id,
          workerId,
          attemptBy: ownership.job?.attemptBy ?? null,
        });
    }
  };

  let lossReported = false;
  const reportLoss = (ownership: { reason: LostReason; job: StateJob | undefined }) => {
    if (!lossReported) {
      lossReported = true;
      reportExpiredLease();
      if (ownership.reason === "already_completed" && ownership.job) {
        helpers.observabilityHelper.jobAttemptAlreadyCompleted(ownership.job, { workerId });
      }
      if (ownership.reason === "taken_by_another_worker" && ownership.job) {
        helpers.observabilityHelper.jobAttemptTakenByAnotherWorker(ownership.job, { workerId });
      }
    }
    if (!abortController.signal.aborted) {
      abortController.abort(ownership.reason);
    }
  };

  let handlerEnded = false;

  // A renewal is never awaited by `finish`: on Postgres it would block on the row `finish` just
  // wrote, and on SQLite and in-process on the write lock the caller's transaction holds.
  const attemptHeartbeat = createAttemptHeartbeat({
    config: attemptConfig,
    commitRenewal: async (timeoutMs) => {
      try {
        const extended = await helpers.stateAdapter.extendJobAttempt({
          jobId: stateJob.id,
          fence,
          timeoutMs,
        });
        if (extended) {
          reportExpiredLease();
          leaseUntil = extended.attemptUntil;
          helpers.observabilityHelper.jobAttemptExtended(stateJob, { workerId });
          return true;
        }
        const ownership = classifyOwnership(await readJob());
        if (ownership.status === "lost") {
          reportLoss(ownership);
        }
        return ownership.status === "owned";
      } catch (error) {
        if (!abortController.signal.aborted) {
          abortController.abort("error");
        }
        throw error;
      }
    },
  });
  attemptHeartbeat.start();

  let disposeAttemptLostListener: (() => Promise<void>) | null = null;
  try {
    disposeAttemptLostListener = await helpers.notifyAdapter.listenJobAttemptLost(
      stateJob.id,
      () => {
        if (abortController.signal.aborted || handlerEnded) return;
        void readJob().then(
          (job) => {
            const ownership = classifyOwnership(job);
            if (ownership.status === "lost") {
              reportLoss(ownership);
            }
          },
          () => {},
        );
      },
    );
  } catch {}

  const runningJob = mapStateJobToJob(stateJob) as ResolvedRunningJob<any, any, any, any>;
  const getBlockers = async (txCtx?: BaseTxContext) => {
    const blockerChains = await helpers.stateAdapter.getJobBlockers({
      txCtx: nonEmptyTxCtx(txCtx),
      jobId: stateJob.id,
    });
    return blockerChains.map(mapStateChainToChain);
  };

  const attemptStartTime = Date.now();
  helpers.observabilityHelper.jobAttemptStarted(stateJob, { workerId });
  const attemptSpanHandle = helpers.observabilityHelper.startAttemptSpan({
    chainId: stateJob.chain.id,
    chainTypeName: stateJob.chain.typeName,
    jobId: stateJob.id,
    jobTypeName: stateJob.typeName,
    attempt: stateJob.attempt,
    workerId,
    chainTraceContext: stateJob.chain.traceContext,
    traceContext: stateJob.traceContext,
  });

  let cleanupAbortListener: (() => void) | null = null;
  if (attemptSpanHandle) {
    const recordAbort = () => {
      const reason = abortController.signal.reason;
      if (reason) {
        attemptSpanHandle.recordAbort(reason);
      }
    };
    if (abortController.signal.aborted) {
      recordAbort();
    } else {
      abortController.signal.addEventListener("abort", recordAbort, { once: true });
      cleanupAbortListener = () => {
        abortController.signal.removeEventListener("abort", recordAbort);
      };
    }
  }

  const writeOutcome = async (
    outcome:
      | { output: unknown }
      | { continueWith: AnyContinueWith }
      | { reschedule: ScheduleOptions },
    txCtx: BaseTxContext,
    transactionHooks: TransactionHooks,
  ): Promise<FinishResult> => {
    if ("reschedule" in outcome) {
      const [rescheduledJob] = await helpers.stateAdapter.rescheduleJobs({
        txCtx,
        jobs: [{ jobId: stateJob.id, schedule: outcome.reschedule, fence }],
      });
      if (rescheduledJob === undefined) {
        throw new JobNotFoundError(`Job ${stateJob.id} not found or already completed`, {
          jobId: stateJob.id,
        });
      }
      bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, rescheduledJob);
      bufferObservabilityEvent(transactionHooks, () => {
        helpers.observabilityHelper.jobRescheduled(rescheduledJob);
      });
      return { job: rescheduledJob, continuation: null };
    }
    if ("output" in outcome) {
      return completeChain(helpers, {
        job: stateJob,
        output: outcome.output,
        txCtx,
        transactionHooks,
        workerId,
        fence,
      });
    }
    return continueChain(helpers, {
      fromJob: {
        ...stateJob,
        traceContext: attemptSpanHandle?.getTraceContext() ?? stateJob.traceContext,
        chain: {
          ...stateJob.chain,
          traceContext: attemptSpanHandle?.getChainTraceContext() ?? stateJob.chain.traceContext,
        },
      },
      continueWith: outcome.continueWith,
      txCtx,
      transactionHooks,
      workerId,
      fence,
    });
  };

  // Each call buffers its events in its own hooks, registered on the caller's hooks under a
  // fresh key; a later call (a retried transaction) discards the previous one's — last call wins.
  let latestFinish = null as {
    transactionHooks: TransactionHooks;
    key: symbol;
    finishHooks: TransactionHooksHandle;
    result: FinishResult;
  } | null;

  const finish = async (options: Record<string, unknown>) => {
    if (handlerEnded) {
      throw new Error("finish cannot be called after the attempt handler has ended");
    }
    const { transactionHooks, output, continueWith, reschedule, ...txCtxFields } = options as {
      transactionHooks?: TransactionHooks;
      output?: unknown;
      continueWith?: AnyContinueWith;
      reschedule?: ScheduleOptions;
    } & BaseTxContext;
    const outcomes = [
      ...("output" in options ? [{ output }] : []),
      ...("continueWith" in options ? [{ continueWith: continueWith! }] : []),
      ...("reschedule" in options ? [{ reschedule: reschedule! }] : []),
    ];
    if (outcomes.length !== 1) {
      throw new Error("finish requires exactly one of output, continueWith or reschedule");
    }
    if (transactionHooks === undefined) {
      throw new Error("finish requires transactionHooks");
    }
    const txCtx = nonEmptyTxCtx(txCtxFields);
    if (txCtx === undefined) {
      throw new Error("finish requires a transaction context from the caller's transaction");
    }

    reportExpiredLease();

    const finishHooks = createTransactionHooks();
    let result: FinishResult;
    try {
      result = await writeOutcome(outcomes[0], txCtx, finishHooks.transactionHooks);
    } catch (error) {
      await finishHooks.discard().catch(() => {});
      if (error instanceof JobNotFoundError && error.jobId === stateJob.id) {
        const ownership = classifyOwnership(await readJob(txCtx));
        if (ownership.status === "lost") {
          reportLoss(ownership);
          throw createLossError(ownership);
        }
        throw new JobAlreadyCompletedError("Job is already completed", { jobId: stateJob.id });
      }
      throw error;
    }

    if (latestFinish !== null) {
      latestFinish.transactionHooks.delete(latestFinish.key);
      void latestFinish.finishHooks.discard().catch(() => {});
    }
    const key = Symbol("queuert.finish");
    transactionHooks.set(key, {
      state: finishHooks,
      flush: async (hooks) => hooks.flush(),
      discard: async (hooks) => hooks.discard(),
    });
    latestFinish = { transactionHooks, key, finishHooks, result };

    return mapFinishResult(result);
  };

  let handlerFailure: { error: unknown } | null = null;
  try {
    await runHandlerMiddlewareChain(
      attemptMiddleware,
      { job: runningJob, workerId },
      async (handlerCtx) =>
        attemptHandler({
          ...handlerCtx,
          signal: abortController.signal,
          job: runningJob,
          finish: finish as any,
          getBlockers: getBlockers as any,
        }),
    );
  } catch (error) {
    handlerFailure = { error };
  }

  handlerEnded = true;
  try {
    await disposeAttemptLostListener?.();
    await attemptHeartbeat.stop();

    helpers.observabilityHelper.jobAttemptDuration(stateJob, {
      durationMs: Date.now() - attemptStartTime,
      workerId,
    });

    // The database decides whether a `finish` committed: a fenced reschedule only matches while
    // the attempt still owns the job, so it misses exactly when `finish` committed or the
    // attempt was lost.
    const failure =
      handlerFailure?.error ?? new Error("Attempt handler returned without a committed finish");
    let rescheduled: Awaited<ReturnType<typeof rescheduleFailedAttempt>>;
    try {
      rescheduled = await rescheduleFailedAttempt(helpers, {
        stateJob,
        error: failure,
        backoffConfig,
        fence,
      });
    } catch (rescheduleError) {
      attemptSpanHandle?.end({ status: "failed", error: failure });
      throw rescheduleError;
    }
    if (rescheduled) {
      attemptSpanHandle?.end({
        status: "failed",
        error: failure,
        rescheduledAt: rescheduled.schedule.at,
        rescheduledAfterMs: rescheduled.schedule.afterMs,
      });
      return;
    }

    const ownership = classifyOwnership(await readJob());
    if (ownership.status === "finished") {
      const finished: FinishResult =
        latestFinish !== null && latestFinish.result.job.status === ownership.job.status
          ? latestFinish.result
          : { job: ownership.job, continuation: null };
      helpers.observabilityHelper.jobAttemptCompleted(stateJob, {
        output: finished.job.output,
        continuedWith: finished.continuation ?? undefined,
        workerId,
      });
      attemptSpanHandle?.end({
        status: "completed",
        continuedWith: finished.continuation
          ? { jobId: finished.continuation.id, jobTypeName: finished.continuation.typeName }
          : undefined,
        chainCompleted:
          finished.continuation || !finished.job.completedAt
            ? undefined
            : { output: finished.job.output },
      });
      if (handlerFailure !== null) {
        // oxlint-disable-next-line typescript/only-throw-error -- re-throwing the handler's error after its committed finish, for the worker to record
        throw handlerFailure.error;
      }
      return;
    }

    if (ownership.status === "lost") {
      reportLoss(ownership);
    }
    attemptSpanHandle?.end({
      status: "failed",
      error:
        handlerFailure?.error ??
        (ownership.status === "lost" ? createLossError(ownership) : failure),
    });
  } finally {
    cleanupAbortListener?.();
    cleanupStopListener?.();
  }
};
