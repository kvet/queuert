import { type AnyChain, type CompletedChain, mapStatePairToChain } from "../entities/chain.js";
import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type ResolvedJobWithBlockers } from "../entities/job-types.resolvers.js";
import { mapStateJobToJob } from "../entities/job.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
} from "../errors.js";
import { type TypedAbortController } from "../helpers/abort.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import { type SavepointContext, createSavepointContext } from "../helpers/savepoint-context.js";
import {
  type TransactionContext,
  createTransactionContext,
} from "../helpers/transaction-context.js";
import {
  type FinishResult,
  createFinishOnce,
  mapFinishResult,
} from "../implementation/attempt-outcome.js";
import { completeChain } from "../implementation/complete-chain.js";
import { type AnyContinueWith, continueChain } from "../implementation/continue-chain.js";
import { handleJobHandlerError } from "../implementation/handle-job-handler-error.js";
import { refetchJobLocked as refetchJobLockedImpl } from "../implementation/refetch-job-locked.js";
import { type Helpers } from "../setup-helpers.js";
import {
  type BaseTxContext,
  type StateAdapter,
  type StateJob,
} from "../state-adapter/state-adapter.js";
import { type TransactionHooks, withTransactionHooks } from "../transaction-hooks.js";
import { type AttemptConfig, createAttemptHeartbeat } from "./attempt-heartbeat.js";
import {
  type AnyAttemptMiddleware,
  runCompleteMiddlewareChain,
  runHandlerMiddlewareChain,
  runPrepareMiddlewareChain,
  runStepMiddlewareChain,
} from "./attempt-middleware.js";
import {
  type AttemptComplete,
  type AttemptHandler,
  type AttemptPrepare,
  type JobAbortReason,
} from "./job-process.types.js";

export type {
  AttemptComplete,
  AttemptCompleteCallback,
  AttemptCompleteOptions,
  AttemptFinish,
  AttemptHandler,
  AttemptPrepare,
  AttemptPrepareCallback,
  AttemptPrepareOptions,
  AttemptStep,
  JobAbortReason,
} from "./job-process.types.js";

type AnyWorkerOutcome = { output: unknown } | { continueWith: AnyContinueWith };

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
  const runningJob = {
    ...mapStateJobToJob(job),
    blockers: blockerPairs.map(mapStatePairToChain) as CompletedChain<AnyChain>[],
  } as ResolvedJobWithBlockers<any, any, any, any> & { status: "running" };

  const runJobAttempt = async (handlerCtx: Record<string, unknown>) => {
    const attemptStartTime = Date.now();
    // Boxed: assigned inside the completion callback, read at the attempt boundary.
    const attempt: { finished: FinishResult | null } = { finished: null };
    const emitAttemptDuration = () => {
      helpers.observabilityHelper.jobAttemptDuration(job, {
        durationMs: Date.now() - attemptStartTime,
        workerId,
      });
    };

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
        throw new Error("prepare can only be called once");
      }
      prepareCalled = true;
      prepareRunning = true;

      try {
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
          prepareSpan?.end();
        } catch (error) {
          prepareSpan?.end({ error });
          throw error;
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

        return callbackOutput;
      } finally {
        prepareRunning = false;
      }
    }) as AttemptPrepare<StateAdapter<BaseTxContext, any>>;

    let stepRunning = false;
    const step = async <T>(
      stepCallback: (
        options: { transactionHooks: TransactionHooks } & BaseTxContext,
      ) => T | Promise<T>,
    ): Promise<Awaited<T>> => {
      if (stepRunning) {
        throw new Error("step cannot be called in parallel");
      }
      stepRunning = true;
      try {
        await ensureStagedPrepare();
        await autoPreparePromise;
        if (prepareRunning) {
          throw new Error("step cannot be called while prepare is running");
        }
        if (prepareTransactionContext.status === "pending") {
          throw new Error("step is only valid in staged mode");
        }
        if (completeCalled) {
          throw new Error("step cannot be called after complete");
        }
        const stepSpan = attemptSpanHandle?.startStep();
        try {
          const stepResult = await (runInGuardedTransaction(async (txCtx, transactionHooks) =>
            runStepMiddlewareChain(
              attemptMiddleware,
              { job: runningJob, transactionHooks, txCtx },
              async (stepCtx) =>
                stepCallback({
                  ...stepCtx,
                  transactionHooks,
                  ...txCtx,
                } as { transactionHooks: TransactionHooks } & BaseTxContext),
            ),
          ) as Promise<Awaited<T>>);
          stepSpan?.end();
          return stepResult;
        } catch (error) {
          stepSpan?.end({ error });
          throw error;
        }
      } finally {
        stepRunning = false;
      }
    };

    let completeCalled = false;
    let completeSavepointContext: SavepointContext<BaseTxContext> | undefined;
    const complete = (async (
      completeCallback: (
        options: {
          finish: (outcome: AnyWorkerOutcome) => Promise<unknown>;
        } & { transactionHooks: TransactionHooks } & BaseTxContext,
      ) => unknown,
    ) => {
      if (completeCalled) {
        throw new Error("complete can only be called once");
      }
      completeCalled = true;
      await autoPreparePromise;
      if (prepareRunning) {
        throw new Error("complete cannot be called while prepare is running");
      }
      if (stepRunning) {
        throw new Error("complete cannot be called while step is running");
      }
      await disposeAttemptLostListener?.();
      await attemptHeartbeat.stop();
      const completeSpan = attemptSpanHandle?.startComplete();
      try {
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
          const finishOnce = createFinishOnce();
          const finish = async (outcome: AnyWorkerOutcome) => {
            finishOnce.begin();
            try {
              const finishResult =
                "output" in outcome
                  ? await completeChain(helpers, {
                      job,
                      output: outcome.output,
                      txCtx,
                      transactionHooks,
                      workerId,
                    })
                  : await continueChain(helpers, {
                      job,
                      fromJob: {
                        ...job,
                        chainTraceContext:
                          attemptSpanHandle?.getChainTraceContext() ?? job.chainTraceContext,
                        traceContext: attemptSpanHandle?.getTraceContext() ?? job.traceContext,
                      },
                      continueWith: outcome.continueWith,
                      txCtx,
                      transactionHooks,
                      workerId,
                    });
              finishOnce.succeed(finishResult);
              return mapFinishResult(finishResult);
            } catch (error) {
              finishOnce.fail(error);
              throw error;
            }
          };

          const completeResult = await runCompleteMiddlewareChain(
            attemptMiddleware,
            { job: runningJob, transactionHooks, txCtx },
            async (completeCtx) =>
              completeCallback({
                ...completeCtx,
                finish,
                transactionHooks,
                ...txCtx,
              }),
          );

          attempt.finished = finishOnce.requireFinished();
          return completeResult;
        });

        completeSpan?.end();
        return result;
      } catch (error) {
        completeSpan?.end({ error });
        throw error;
      }
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
            throw new Error("prepare cannot be accessed after auto-setup");
          }
          if (!prepareAccessed) {
            prepareAccessed = true;
          }
          return prepare;
        },
        step,
        complete,
      });
      attemptPromise.catch(() => {});

      await ensureStagedPrepare();

      await attemptPromise;

      if (attempt.finished === null) {
        throw new Error("complete must be called before the attempt handler returns");
      }

      await completeSavepointContext?.resolve();
      await prepareTransactionContext.resolve();
      await completeTransactionContext?.resolve();

      // Reports the pre-write row: the attempt is described as it ran, not as
      // the completion left it.
      helpers.observabilityHelper.jobAttemptCompleted(job, {
        output: attempt.finished.job.output,
        continuedWith: attempt.finished.continuation ?? undefined,
        workerId,
      });
      emitAttemptDuration();
      attemptSpanHandle?.end({
        status: "completed",
        continuedWith: attempt.finished.continuation
          ? {
              jobId: attempt.finished.continuation.id,
              jobTypeName: attempt.finished.continuation.typeName,
            }
          : undefined,
        chainCompleted: attempt.finished.continuation
          ? undefined
          : { output: attempt.finished.job.output },
      });
    } catch (error) {
      await disposeAttemptLostListener?.();
      await attemptHeartbeat.stop();

      await completeSavepointContext?.reject(error);

      emitAttemptDuration();

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
