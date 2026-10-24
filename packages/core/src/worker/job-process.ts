import { serializeError } from "@queuert/helpers";

import {
  type AnyAttemptMiddleware,
  runHandlerMiddlewareChain,
} from "../attempt-middleware/attempt-middleware.js";
import { type BackoffConfig, calculateBackoffMs } from "../entities/backoff.js";
import { type AnyChain, type CompletedChain, mapStateChainToChain } from "../entities/chain.js";
import { mapStateJobToJob } from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
} from "../errors.js";
import {
  type AnyContinueWith,
  completeOrContinueChain,
  rescheduleJobs,
} from "../implementation.js";
import { type BaseJobTypeDefinitions } from "../job-types/job-type.js";
import { type ResolvedRunningJob } from "../job-types/job-types.resolvers.js";
import { type ObservabilityHelper } from "../observability-adapter/observability-helper.js";
import { bufferObservabilityEvent } from "../observability-adapter/observability-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import {
  type BaseTxContext,
  type StateAdapter,
  type StateAttemptFence,
  type StateJob,
  type StateJobInfo,
} from "../state-adapter/state-adapter.js";
import { requireTxCtx } from "../state-adapter/tx-context.js";
import { type TransactionHooks, createTransactionHooks } from "../transaction-hooks.js";
import { type AttemptConfig } from "./attempt-heartbeat.js";
import { type AttemptOwnership, startAttemptOwnership } from "./attempt-ownership.js";
import { type AttemptHandler } from "./job-process.types.js";

// A successful `complete` returns a receipt. It is committed once the caller's hooks flush with
// it, which proves its transaction committed when the hooks wrap the transaction. A handler that
// returns a committed receipt needs no database check.
type CompleteResult = StateJob & { continuation?: StateJobInfo };
type CompleteCall = { result: CompleteResult; receipt: object };

type AttemptSpanHandle = ReturnType<ObservabilityHelper["startAttemptSpan"]>;

type AnyAttemptHandler = AttemptHandler<
  StateAdapter<BaseTxContext, any>,
  BaseJobTypeDefinitions,
  string,
  string,
  Record<string, unknown>
>;

const startAttempt = (
  helpers: Helpers,
  { stateJob, workerId }: { stateJob: StateJob; workerId: string },
): { tracedJob: StateJob; span: AttemptSpanHandle; startTime: number } => {
  const startTime = Date.now();
  helpers.observabilityHelper.jobAttemptStarted(stateJob, { workerId });
  const span = helpers.observabilityHelper.startAttemptSpan({
    chainId: stateJob.chain.id,
    chainTypeName: stateJob.chain.typeName,
    jobId: stateJob.id,
    jobTypeName: stateJob.typeName,
    attempt: stateJob.attempt,
    workerId,
    chainTraceContext: stateJob.chain.traceContext,
    traceContext: stateJob.traceContext,
  });

  // Carries the attempt span's trace context, so a continuation's job span descends from it.
  const tracedJob: StateJob = {
    ...stateJob,
    traceContext: span?.getTraceContext() ?? stateJob.traceContext,
    chain: {
      ...stateJob.chain,
      traceContext: span?.getChainTraceContext() ?? stateJob.chain.traceContext,
    },
  };

  return { tracedJob, span, startTime };
};

const createComplete = (
  helpers: Helpers,
  {
    tracedJob,
    workerId,
    fence,
    ownership,
  }: {
    tracedJob: StateJob;
    workerId: string;
    fence: StateAttemptFence;
    ownership: AttemptOwnership;
  },
): {
  complete: (options: Record<string, unknown>) => Promise<object>;
  close: () => void;
  committedCall: () => CompleteCall | null;
  lastWrite: () => CompleteResult | null;
} => {
  let closed = false;
  // The latest successful `complete` write, set before its transaction commits.
  let lastWrite = null as CompleteResult | null;
  let committedCall = null as CompleteCall | null;

  // One successful call per caller's hooks scope; a hooks savepoint rollback clears it again.
  const completeHookKey = Symbol("queuert.complete");
  const getCompleteSlot = (transactionHooks: TransactionHooks) =>
    transactionHooks.getOrInsert(completeHookKey, () => ({
      state: { call: null as CompleteCall | null },
      checkpoint: (state) => {
        const call = state.call;
        return () => {
          state.call = call;
        };
      },
      flush: (state) => {
        if (state.call === null) return;
        committedCall = state.call;
        void ownership.stopHeartbeat();
      },
    }));

  // Reads why a fenced `complete` write missed and returns the matching error. The loss is
  // reported once, however many calls miss.
  let lossReported = false;
  const readLossError = async (txCtx: BaseTxContext): Promise<Error> => {
    const [job] = await helpers.stateAdapter.getJobs({ txCtx, jobIds: [tracedJob.id] });
    ownership.abort();
    const report = !lossReported;
    lossReported = true;
    if (report) ownership.reportExpiredLease();
    if (!job) {
      return new JobNotFoundError(`Job not found`, { jobId: tracedJob.id });
    }
    if (job.completedAt !== null) {
      if (report) helpers.observabilityHelper.jobAttemptAlreadyCompleted(job, { workerId });
      return new JobAlreadyCompletedError("Job is already completed", { jobId: tracedJob.id });
    }
    if (report) helpers.observabilityHelper.jobAttemptTakenByAnotherWorker(job, { workerId });
    return new JobTakenByAnotherWorkerError(`Job taken by another worker`, {
      jobId: tracedJob.id,
      workerId,
      attemptBy: job.attemptBy,
    });
  };

  const complete = async (options: Record<string, unknown>) => {
    if (closed) {
      throw new Error("complete cannot be called after the attempt handler has ended");
    }
    const {
      transactionHooks,
      output: _output,
      continueWith: _continueWith,
      reschedule: _reschedule,
      ...txCtxFields
    } = options as { transactionHooks?: TransactionHooks } & Record<string, unknown>;
    const outcomeCount =
      Number("output" in options) +
      Number("continueWith" in options) +
      Number("reschedule" in options);
    if (outcomeCount !== 1) {
      throw new Error("complete requires exactly one of output, continueWith or reschedule");
    }
    if (transactionHooks === undefined) {
      throw new Error("complete requires transactionHooks");
    }
    const txCtx = requireTxCtx(helpers.stateAdapter, txCtxFields, "complete");

    const completeSlot = getCompleteSlot(transactionHooks);
    if (completeSlot.call !== null) {
      throw new Error(
        "complete already succeeded with these transactionHooks; a retried transaction needs its own withTransactionHooks",
      );
    }

    ownership.reportExpiredLease();

    const result: CompleteResult | undefined =
      "reschedule" in options
        ? (
            await rescheduleJobs(helpers, {
              txCtx,
              transactionHooks,
              jobs: [
                { jobId: tracedJob.id, schedule: options.reschedule as ScheduleOptions, fence },
              ],
            })
          )[0]
        : await completeOrContinueChain(helpers, {
            job: tracedJob,
            outcome: options as { output: unknown } | { continueWith: AnyContinueWith },
            txCtx,
            transactionHooks,
            fence,
          });
    if (result === undefined) {
      throw await readLossError(txCtx);
    }

    lastWrite = result;
    ownership.markCompleteWritten();
    completeSlot.call = { result, receipt: mapStateJobToJob(result) };
    return completeSlot.call.receipt;
  };

  return {
    complete,
    close: () => {
      closed = true;
    },
    committedCall: () => committedCall,
    lastWrite: () => lastWrite,
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
  complete: (options: Record<string, unknown>) => Promise<object>;
}): Promise<{ status: "returned"; value: unknown } | { status: "threw"; error: unknown }> => {
  try {
    const blockerChains = stateJob.hasBlockers
      ? await helpers.stateAdapter.getJobBlockers({ jobId: stateJob.id })
      : [];
    const runningJob = {
      ...mapStateJobToJob(stateJob),
      blockers: blockerChains.map(mapStateChainToChain) as CompletedChain<AnyChain>[],
    } as ResolvedRunningJob<any, any, any, any>;
    const value = await runHandlerMiddlewareChain(
      attemptMiddleware,
      { job: runningJob, workerId },
      async (handlerCtx) =>
        attemptHandler({
          ...handlerCtx,
          signal,
          job: runningJob,
          complete: complete as any,
        }),
    );
    return { status: "returned", value };
  } catch (error) {
    return { status: "threw", error };
  }
};

const reportAttemptCompleted = (
  helpers: Helpers,
  {
    stateJob,
    workerId,
    span,
    finished,
  }: { stateJob: StateJob; workerId: string; span: AttemptSpanHandle; finished: CompleteResult },
): void => {
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
};

// A fenced reschedule only matches while the attempt still owns the job, so it misses exactly when
// a `complete` committed or the attempt was lost; it is also the safety net for hooks that flushed
// before a COMMIT that then failed. Returns whether the job was rescheduled.
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
    span: AttemptSpanHandle;
    fence: StateAttemptFence;
    backoffConfig: BackoffConfig;
    failure: unknown;
  },
): Promise<boolean> => {
  const { transactionHooks, flush } = createTransactionHooks();
  let rescheduledJob: StateJob | undefined;
  try {
    [rescheduledJob] = await rescheduleJobs(helpers, {
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
  } catch (rescheduleError) {
    span?.end({ status: "failed", error: failure });
    throw rescheduleError;
  }
  if (!rescheduledJob) return false;

  bufferObservabilityEvent(transactionHooks, () => {
    helpers.observabilityHelper.jobAttemptFailed(stateJob, { workerId, error: failure });
    span?.end({ status: "failed", error: failure });
  });
  await flush();
  return true;
};

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
  const { tracedJob, span, startTime } = startAttempt(helpers, { stateJob, workerId });
  const completion = createComplete(helpers, { tracedJob, workerId, fence, ownership });

  const handlerResult = await runAttemptHandler({
    helpers,
    attemptHandler,
    attemptMiddleware,
    stateJob,
    workerId,
    signal: ownership.signal,
    complete: completion.complete,
  });

  completion.close();
  await ownership.release();

  helpers.observabilityHelper.jobAttemptDuration(stateJob, {
    durationMs: Date.now() - startTime,
    workerId,
  });

  const committed = completion.committedCall();
  if (
    handlerResult.status === "returned" &&
    committed !== null &&
    handlerResult.value === committed.receipt
  ) {
    reportAttemptCompleted(helpers, { stateJob, workerId, span, finished: committed.result });
    return;
  }

  // Anything else fails the attempt. A thrown `null` or `undefined` is replaced too, so the
  // recorded error is never empty.
  const thrown = handlerResult.status === "threw" ? handlerResult.error : undefined;
  const failure =
    thrown ?? new Error("Attempt handler returned without a committed `complete` call");
  const rescheduled = await rescheduleFailedAttempt(helpers, {
    stateJob,
    workerId,
    span,
    fence,
    backoffConfig,
    failure,
  });
  if (rescheduled) return;

  // The attempt no longer holds the job, so a `complete` write it made is the one that
  // committed, even when its hooks were discarded.
  const finished = completion.committedCall()?.result ?? completion.lastWrite();
  if (finished === null) {
    span?.end({ status: "failed", error: failure });
    return;
  }
  reportAttemptCompleted(helpers, { stateJob, workerId, span, finished });
  if (handlerResult.status === "threw") {
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing the handler's error after its committed complete, for the worker to record
    throw handlerResult.error;
  }
};
