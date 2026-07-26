import { type AnyChain, type CompletedChain, mapStatePairsToChains } from "../entities/chain.js";
import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import {
  type BlockerChains,
  type ContinuationJobs,
  type JobTypeContinuation,
  type JobTypeHasBlockers,
  type JobTypeProperty,
  type ResolvedJobWithBlockers,
} from "../entities/job-types.resolvers.js";
import { type AnyJob, mapStateJobsToJobs } from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
} from "../errors.js";
import { type TypedAbortController, type TypedAbortSignal } from "../helpers/abort.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import { bufferObservabilityEvent } from "../helpers/observability-hooks.js";
import { type SavepointContext, createSavepointContext } from "../helpers/savepoint-context.js";
import {
  type TransactionContext,
  createTransactionContext,
} from "../helpers/transaction-context.js";
import { continueWith } from "../implementation/continue-with.js";
import { finishJob } from "../implementation/finish-job.js";
import { handleJobHandlerError } from "../implementation/handle-job-handler-error.js";
import { refetchJobLocked as refetchJobLockedImpl } from "../implementation/refetch-job-locked.js";
import { type Helpers } from "../setup-helpers.js";
import {
  type BaseTxContext,
  type GetStateAdapterJobId,
  type GetStateAdapterTxContext,
  type StateAdapter,
  type StateJob,
} from "../state-adapter/state-adapter.js";
import { type TransactionHooks, withTransactionHooks } from "../transaction-hooks.js";
import { type AttemptConfig, createAttemptHeartbeat } from "./attempt-heartbeat.js";
import {
  type AnyAttemptMiddleware,
  runCompleteMiddlewareChain,
  runExecuteMiddlewareChain,
  runHandlerMiddlewareChain,
  runPrepareMiddlewareChain,
} from "./attempt-middleware.js";

/** Reasons a job attempt's signal can be aborted. */
export type JobAbortReason =
  | "taken_by_another_worker"
  | "error"
  | "not_found"
  | "already_completed"
  | "worker_stopping";

/** Options passed to the completion callback, including `continueWith` and the transaction context. */
export type AttemptCompleteOptions<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  TCompleteCtx = Record<string, unknown>,
> = {
  continueWith: <
    // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- TContinueJobTypeNames drives conditional type inference
    TContinueJobTypeNames extends JobTypeContinuation<TJobTypeDefinitions, TJobTypeName> & string,
  >(
    options: TContinueJobTypeNames extends infer TContinueJobTypeName extends string
      ? {
          typeName: TContinueJobTypeName;
          id?: GetStateAdapterJobId<TStateAdapter>;
          input: JobTypeProperty<TJobTypeDefinitions, TContinueJobTypeName, "input">;
          schedule?: ScheduleOptions;
        } & (JobTypeHasBlockers<TJobTypeDefinitions, TContinueJobTypeName> extends true
          ? {
              blockers: BlockerChains<
                GetStateAdapterJobId<TStateAdapter>,
                TJobTypeDefinitions,
                TContinueJobTypeName
              >;
            }
          : { blockers?: never })
      : never,
  ) => Promise<
    ContinuationJobs<
      GetStateAdapterJobId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName
    >
  >;
} & { transactionHooks: TransactionHooks } & GetStateAdapterTxContext<TStateAdapter> &
  TCompleteCtx;

/** Completion callback type. Receives {@link AttemptCompleteOptions} and returns the result. */
export type AttemptCompleteCallback<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  TResult,
  TCompleteCtx = Record<string, unknown>,
> = (
  completeOptions: AttemptCompleteOptions<
    TStateAdapter,
    TJobTypeDefinitions,
    TJobTypeName,
    TChainTypeName,
    TCompleteCtx
  >,
) => Promise<TResult>;

/**
 * Typed completion function provided to the
 * {@link AttemptHandler | attemptHandler}. Call it to finalize the job — either
 * return the output to complete the chain, or call `continueWith` to extend it.
 */
export type AttemptComplete<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  TCompleteCtx = Record<string, unknown>,
> = <
  TReturn extends
    | JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "output">
    | ContinuationJobs<
        GetStateAdapterJobId<TStateAdapter>,
        TJobTypeDefinitions,
        TJobTypeName,
        TChainTypeName
      >,
>(
  completeCallback: (
    completeOptions: AttemptCompleteOptions<
      TStateAdapter,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName,
      TCompleteCtx
    >,
  ) => Promise<TReturn>,
) => Promise<
  TReturn extends JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "output">
    ? ResolvedJobWithBlockers<
        GetStateAdapterJobId<TStateAdapter>,
        TJobTypeDefinitions,
        TJobTypeName,
        TChainTypeName
      > & {
        status: "completed";
      }
    : ContinuationJobs<
        GetStateAdapterJobId<TStateAdapter>,
        TJobTypeDefinitions,
        TJobTypeName,
        TChainTypeName
      >
>;

/**
 * Configuration for the prepare phase.
 *
 * - `"atomic"` — prepare and complete run in the same transaction.
 * - `"staged"` — prepare commits first, then complete runs in a new transaction with attempt extension.
 */
export type AttemptPrepareOptions = { mode: "atomic" | "staged" };

/** Callback executed during the prepare phase within the transaction. */
export type AttemptPrepareCallback<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  T,
  TPrepareCtx = Record<string, unknown>,
> = (
  prepareCallbackOptions: GetStateAdapterTxContext<TStateAdapter> & TPrepareCtx,
) => T | Promise<T>;

/**
 * Typed prepare function provided to the
 * {@link AttemptHandler | attemptHandler}. Controls the processing mode and
 * optionally runs a callback within the prepare transaction.
 */
export type AttemptPrepare<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TPrepareCtx = Record<string, unknown>,
> = {
  (config: AttemptPrepareOptions): Promise<void>;
  <T>(
    config: AttemptPrepareOptions,
    prepareCallback: AttemptPrepareCallback<TStateAdapter, T, TPrepareCtx>,
  ): Promise<Awaited<T>>;
};

/**
 * Typed execute function provided to the
 * {@link AttemptHandler | attemptHandler}. Opens a fresh guarded transaction
 * mid-attempt — only valid in staged mode between `prepare` and `complete`.
 */
export type AttemptExecute<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TExecuteCtx = Record<string, unknown>,
> = <T>(
  executeCallback: (
    options: { transactionHooks: TransactionHooks } & GetStateAdapterTxContext<TStateAdapter> &
      TExecuteCtx,
  ) => T | Promise<T>,
) => Promise<Awaited<T>>;

/**
 * Handler function called for each job attempt.
 *
 * Receives `signal` (abort signal), `job` (the running job with blockers), `prepare` (transaction setup), and `complete` (finalization).
 *
 * Processing mode is inferred automatically:
 * - If `complete` is called synchronously (no prior `await`), `prepare` is skipped and the job runs in **atomic** mode (single transaction).
 * - If neither `prepare` nor `complete` is called synchronously, the worker auto-calls `prepare({ mode: "staged" })`.
 */
export type AttemptHandler<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  THandlerCtx,
  TPrepareCtx,
  TExecuteCtx,
  TCompleteCtx,
> = (
  processOptions: {
    signal: TypedAbortSignal<JobAbortReason>;
    job: ResolvedJobWithBlockers<
      GetStateAdapterJobId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName
    > & { status: "running" };
    prepare: AttemptPrepare<TStateAdapter, TPrepareCtx>;
    execute: AttemptExecute<TStateAdapter, TExecuteCtx>;
    complete: AttemptComplete<
      TStateAdapter,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName,
      TCompleteCtx
    >;
  } & THandlerCtx,
) => Promise<
  | (ResolvedJobWithBlockers<
      GetStateAdapterJobId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName
    > & { status: "completed" })
  | ContinuationJobs<
      GetStateAdapterJobId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName
    >
>;

export const runJobProcess = async ({
  helpers,
  attemptHandler,
  prepareTransactionContext,
  job,
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
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>
  >;
  prepareTransactionContext: TransactionContext<BaseTxContext>;
  job: StateJob;
  backoffConfig: BackoffConfig;
  attemptConfig: AttemptConfig;
  workerId: string;
  attemptMiddleware?: readonly AnyAttemptMiddleware[];
  stopSignal: AbortSignal;
}): Promise<void> => {
  let completeTransactionContext: TransactionContext<BaseTxContext> | null = null;

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
  const throwIfHardAborted = () => {
    if (!abortController.signal.aborted || !abortController.signal.reason) return;
    if (abortController.signal.reason === "worker_stopping") return;
    if (abortController.signal.reason === "already_completed") {
      throw new JobAlreadyCompletedError("Job already completed (signal aborted)", {
        jobId: job.id,
      });
    }
    if (abortController.signal.reason === "not_found") {
      throw new JobNotFoundError("Job not found (signal aborted)", { jobId: job.id });
    }
    if (abortController.signal.reason === "taken_by_another_worker") {
      throw new JobTakenByAnotherWorkerError("Job taken by another worker (signal aborted)", {
        jobId: job.id,
        workerId,
      });
    }
    throw new Error(`Job processing aborted: ${abortController.signal.reason}`);
  };
  const refetchJobLocked = async (txCtx: BaseTxContext) => {
    throwIfHardAborted();

    await refetchJobLockedImpl(helpers, {
      txCtx,
      job,
      workerId,
    }).catch((error: unknown) => {
      if (!abortController.signal.aborted) {
        if (error instanceof JobNotFoundError) {
          abortController.abort("not_found");
        }
        if (error instanceof JobAlreadyCompletedError) {
          abortController.abort("already_completed");
        }
        if (error instanceof JobTakenByAnotherWorkerError) {
          abortController.abort("taken_by_another_worker");
        }
      }
      throw error;
    });
  };
  const runInGuardedTransaction = async <T>(
    cb: (txCtx: BaseTxContext, transactionHooks: TransactionHooks) => Promise<T>,
  ): Promise<T> => {
    throwIfHardAborted();

    if (prepareTransactionContext.status === "pending") {
      return prepareTransactionContext.run(cb);
    }
    if (completeTransactionContext && completeTransactionContext.status === "pending") {
      return completeTransactionContext.run(cb);
    }

    return withTransactionHooks(async (transactionHooks) =>
      helpers.stateAdapter.withTransaction(async (txCtx) => {
        await refetchJobLocked(txCtx);
        return cb(txCtx, transactionHooks);
      }),
    );
  };
  const attemptHeartbeat = createAttemptHeartbeat({
    commitRenewal: async (timeoutMs: number) => {
      try {
        await runInGuardedTransaction(async (txCtx) =>
          helpers.stateAdapter.extendJobAttempt({
            txCtx,
            jobId: job.id,
            workerId,
            timeoutMs,
          }),
        );
        helpers.observabilityHelper.jobAttemptExtended(job, { workerId });
      } catch (error) {
        if (
          error instanceof JobTakenByAnotherWorkerError ||
          error instanceof JobNotFoundError ||
          error instanceof JobAlreadyCompletedError
        ) {
          return;
        }
        abortController.abort("error");
        throw error;
      }
    },
    config: attemptConfig,
  });
  let disposeAttemptLostListener: (() => Promise<void>) | null = null;

  const blockerPairs = await prepareTransactionContext.run(async (txCtx) =>
    helpers.stateAdapter.getJobBlockers({ txCtx, jobId: job.id }),
  );
  const [[mappedJob], decodedBlockers] = await Promise.all([
    mapStateJobsToJobs([job], helpers.jobTypes),
    mapStatePairsToChains(blockerPairs, helpers.jobTypes),
  ]);
  const runningJob = {
    ...mappedJob,
    blockers: decodedBlockers as CompletedChain<AnyChain>[],
  } as ResolvedJobWithBlockers<any, any, any, any> & { status: "running" };

  const runJobAttempt = async (handlerCtx: Record<string, unknown>) => {
    const attemptStartTime = Date.now();

    helpers.observabilityHelper.jobAttemptStarted(job, { workerId });
    const attemptSpanHandle = helpers.observabilityHelper.startAttemptSpan({
      chainId: job.chainId,
      chainTypeName: job.chainTypeName,
      jobId: job.id,
      jobTypeName: job.typeName,
      attempt: job.attempt,
      workerId,
      chainTraceContext: job.chainTraceContext,
      traceContext: job.traceContext,
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

    let prepareAccessed = false;
    let prepareCalled = false;
    let prepareRunning = false;
    const prepare = (async <T>(
      config: { mode: "atomic" | "staged" },
      prepareCallback?: (options: BaseTxContext) => T | Promise<T>,
    ) => {
      if (prepareCalled) {
        throw new Error("Prepare can only be called once");
      }
      prepareCalled = true;
      prepareRunning = true;

      const prepareSpan = attemptSpanHandle?.startPrepare();
      let callbackOutput: T | undefined;
      try {
        callbackOutput = await prepareTransactionContext.run(async (txCtx) =>
          prepareCallback
            ? helpers.stateAdapter.withSavepoint(txCtx, async (innerTxCtx) =>
                runPrepareMiddlewareChain(
                  attemptMiddleware,
                  { job: runningJob, txCtx: innerTxCtx },
                  async (prepareCtx) =>
                    prepareCallback({ ...prepareCtx, ...innerTxCtx } as BaseTxContext),
                ),
              )
            : undefined,
        );
      } finally {
        prepareSpan?.end();
      }

      if (config.mode === "staged") {
        await prepareTransactionContext.run(async (txCtx) =>
          helpers.stateAdapter.extendJobAttempt({
            txCtx,
            jobId: job.id,
            workerId,
            timeoutMs: attemptConfig.timeoutMs,
          }),
        );
        await prepareTransactionContext.resolve();

        await attemptHeartbeat.start();
        try {
          disposeAttemptLostListener = await helpers.notifyAdapter.listenJobAttemptLost(
            job.id,
            () => {
              if (!abortController.signal.aborted) {
                void runInGuardedTransaction(async () => Promise.resolve()).catch(() => {});
              }
            },
          );
        } catch {}
      }

      prepareRunning = false;
      return callbackOutput;
    }) as AttemptPrepare<StateAdapter<BaseTxContext, any>>;

    let executeRunning = false;
    const execute = async <T>(
      executeCallback: (
        options: { transactionHooks: TransactionHooks } & BaseTxContext,
      ) => T | Promise<T>,
    ): Promise<Awaited<T>> => {
      if (executeRunning) {
        throw new Error("execute cannot be called in parallel");
      }
      executeRunning = true;
      await ensureStagedPrepare();
      await autoPreparePromise;
      if (prepareRunning) {
        throw new Error("execute cannot be called while prepare is running");
      }
      if (prepareTransactionContext.status === "pending") {
        throw new Error("execute is only valid in staged mode");
      }
      if (completeCalled) {
        throw new Error("execute cannot be called after complete");
      }
      const executeSpan = attemptSpanHandle?.startExecute();
      try {
        return await (runInGuardedTransaction(async (txCtx, transactionHooks) =>
          runExecuteMiddlewareChain(
            attemptMiddleware,
            { job: runningJob, transactionHooks, txCtx },
            async (executeCtx) =>
              executeCallback({
                ...executeCtx,
                transactionHooks,
                ...txCtx,
              } as { transactionHooks: TransactionHooks } & BaseTxContext),
          ),
        ) as Promise<Awaited<T>>);
      } finally {
        executeSpan?.end();
        executeRunning = false;
      }
    };

    let completeCalled = false;
    let completeSavepointContext: SavepointContext<BaseTxContext> | undefined;
    const complete = (async (
      completeCallback: (
        options: {
          continueWith: (
            options: {
              typeName: string;
              id?: string;
              input: unknown;
              schedule?: ScheduleOptions;
              blockers?: AnyChain[];
            } & BaseTxContext,
          ) => Promise<unknown>;
        } & { transactionHooks: TransactionHooks } & BaseTxContext,
      ) => unknown,
    ) => {
      if (completeCalled) {
        throw new Error("Complete can only be called once");
      }
      completeCalled = true;
      await autoPreparePromise;
      if (prepareRunning) {
        throw new Error("complete cannot be called while prepare is running");
      }
      if (executeRunning) {
        throw new Error("complete cannot be called while execute is running");
      }
      await disposeAttemptLostListener?.();
      await attemptHeartbeat.stop();
      const completeSpan = attemptSpanHandle?.startComplete();
      if (prepareTransactionContext.status !== "pending") {
        completeTransactionContext = await createTransactionContext(
          helpers.stateAdapter.withTransaction,
        );
        await completeTransactionContext.run(async (txCtx) => {
          await refetchJobLocked(txCtx);
        });
      }

      completeSavepointContext = await createSavepointContext(
        async (cb) => runInGuardedTransaction(cb),
        helpers.stateAdapter.withSavepoint,
      );

      const result = await completeSavepointContext.run(async (txCtx, transactionHooks) => {
        let continuedJob: AnyJob | null = null;
        const output = await runCompleteMiddlewareChain(
          attemptMiddleware,
          { job: runningJob, transactionHooks, txCtx },
          async (completeCtx) =>
            completeCallback({
              ...completeCtx,
              continueWith: async ({ typeName, id, input, schedule, blockers }) => {
                if (continuedJob) {
                  throw new Error("continueWith can only be called once");
                }
                continuedJob = await continueWith(helpers, {
                  typeName,
                  id,
                  input,
                  txCtx,
                  transactionHooks,
                  schedule,
                  blockers: blockers as any,
                  fromJob: {
                    ...job,
                    chainTraceContext:
                      attemptSpanHandle?.getChainTraceContext() ?? job.chainTraceContext,
                    traceContext: attemptSpanHandle?.getTraceContext() ?? job.traceContext,
                  },
                });
                return continuedJob;
              },
              transactionHooks,
              ...txCtx,
            }),
        );
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.jobAttemptCompleted(job, {
            output: continuedJob ? null : output,
            continuedWith: continuedJob ?? undefined,
            workerId,
          });
        });
        const completedStateJob = await finishJob(helpers, {
          job,
          txCtx,
          transactionHooks,
          workerId,
          output,
          continuedJob,
        });
        let jobResult: unknown;
        if (continuedJob) {
          jobResult = continuedJob;
        } else {
          const [mappedCompleted] = await mapStateJobsToJobs([completedStateJob], helpers.jobTypes);
          jobResult = Object.assign(mappedCompleted, { blockers: runningJob.blockers });
        }
        const continuedWith = continuedJob
          ? {
              jobId: (continuedJob as AnyJob).id,
              jobTypeName: (continuedJob as AnyJob).typeName,
            }
          : undefined;
        const chainCompleted = !continuedJob ? { output } : undefined;
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.jobAttemptDuration(job, {
            durationMs: Date.now() - attemptStartTime,
            workerId,
          });
          attemptSpanHandle?.end({
            status: "completed",
            continuedWith,
            chainCompleted,
          });
        });
        return jobResult;
      });

      completeSpan?.end();
      return result;
    }) as AttemptComplete<StateAdapter<BaseTxContext, any>, BaseJobTypeDefinitions, string, string>;

    let autoSetupDone = false;
    let autoPreparePromise: Promise<void> | null = null;

    const ensureStagedPrepare = async () => {
      if (!prepareAccessed && !prepareCalled && !completeCalled) {
        autoPreparePromise = prepare({ mode: "staged" });
        await autoPreparePromise;
        autoSetupDone = true;
      }
    };

    try {
      const attemptPromise = attemptHandler({
        ...handlerCtx,
        signal: abortController.signal,
        job: runningJob,
        get prepare() {
          if (autoSetupDone) {
            throw new Error("Prepare cannot be accessed after auto-setup");
          }
          if (!prepareAccessed) {
            prepareAccessed = true;
          }
          return prepare;
        },
        execute,
        complete,
      });
      attemptPromise.catch(() => {});

      await ensureStagedPrepare();

      await attemptPromise;

      await completeSavepointContext?.resolve();
      await prepareTransactionContext.resolve();
      await completeTransactionContext?.resolve();
    } catch (error) {
      await disposeAttemptLostListener?.();
      await attemptHeartbeat.stop();

      await completeSavepointContext?.reject(error);

      try {
        const errorResult = await runInGuardedTransaction(async (txCtx, transactionHooks) =>
          transactionHooks.withSavepoint(async () =>
            handleJobHandlerError(helpers, {
              job,
              error,
              txCtx,
              transactionHooks,
              backoffConfig,
              workerId,
            }),
          ),
        );

        await prepareTransactionContext.resolve();
        await completeTransactionContext?.resolve();

        attemptSpanHandle?.end({
          status: "failed",
          error,
          rescheduledAt: errorResult.schedule?.at,
          rescheduledAfterMs: errorResult.schedule?.afterMs,
        });
      } catch (innerError) {
        await prepareTransactionContext.reject(innerError);
        await completeTransactionContext?.reject(innerError);

        attemptSpanHandle?.end({ status: "failed", error });
      }
    } finally {
      cleanupAbortListener?.();
    }
  };

  try {
    await runHandlerMiddlewareChain(
      attemptMiddleware,
      { job: runningJob, workerId },
      async (handlerCtx) => {
        await runJobAttempt(handlerCtx);
      },
    );
  } finally {
    cleanupStopListener?.();
  }
};
