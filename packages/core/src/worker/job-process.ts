import {
  type CompletedJobChain,
  type JobChain,
  mapStateJobPairToJobChain,
} from "../entities/job-chain.js";
import {
  type BlockerChains,
  type ChainTypesReaching,
  type ContinuationJobTypes,
  type ContinuationJobs,
  type JobTypeHasBlockers,
  type ResolvedJobWithBlockers,
} from "../entities/job-type-registry.resolvers.js";
import { type BaseNavigationMap } from "../entities/job-type-registry.navigation.js";
import { type Job, mapStateJobToJob } from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
} from "../errors.js";
import { type TypedAbortController, type TypedAbortSignal } from "../helpers/abort.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import {
  bufferObservabilityEvent,
  rollbackObservabilityBuffer,
  snapshotObservabilityBuffer,
} from "../helpers/observability-hooks.js";
import {
  type TransactionContext,
  createTransactionContext,
} from "../helpers/transaction-context.js";
import { continueWith } from "../implementation/continue-with.js";
import { finishJob } from "../implementation/finish-job.js";
import { handleJobHandlerError } from "../implementation/handle-job-handler-error.js";
import { refetchJobForUpdate as refetchJobForUpdateImpl } from "../implementation/refetch-job-for-update.js";
import { type Helpers } from "../setup-helpers.js";
import {
  type BaseTxContext,
  type GetStateAdapterJobId,
  type GetStateAdapterTxContext,
  type StateAdapter,
  type StateJob,
} from "../state-adapter/state-adapter.js";
import { type TransactionHooks, withTransactionHooks } from "../transaction-hooks.js";
import { type LeaseConfig, createLeaseManager } from "./lease.js";

/** Middleware that wraps each job attempt. Receives the running job context and a `next` function to invoke the inner handler. */
export type JobAttemptMiddleware<
  TStateAdapter extends StateAdapter<any, any>,
  TNavigationMap extends BaseNavigationMap,
> = <T>(
  context: {
    job: ResolvedJobWithBlockers<
      GetStateAdapterJobId<TStateAdapter>,
      TNavigationMap,
      keyof TNavigationMap & string,
      string
    > & { status: "running" };
    workerId: string;
  },
  next: () => Promise<T>,
) => Promise<T>;

/** Reasons a job attempt's signal can be aborted. */
export type JobAbortReason =
  | "taken_by_another_worker"
  | "error"
  | "not_found"
  | "already_completed";

/** Options passed to the completion callback, including `continueWith` and the transaction context. */
export type AttemptCompleteOptions<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap & string,
  TChainTypeName extends string,
> = {
  continueWith: <
    TContinueJobTypeName extends ContinuationJobTypes<TNavigationMap, TJobTypeName> & string,
  >(
    options: {
      typeName: TContinueJobTypeName;
      input: TNavigationMap[TContinueJobTypeName]["input"];
      schedule?: ScheduleOptions;
    } & (JobTypeHasBlockers<TNavigationMap, TContinueJobTypeName> extends true
      ? {
          blockers: BlockerChains<
            GetStateAdapterJobId<TStateAdapter>,
            TNavigationMap,
            TContinueJobTypeName
          >;
        }
      : { blockers?: never }),
  ) => Promise<
    Job<
      GetStateAdapterJobId<TStateAdapter>,
      TContinueJobTypeName,
      TChainTypeName,
      TNavigationMap[TContinueJobTypeName]["input"]
    > &
      ({ status: "pending" } | { status: "blocked" })
  >;
} & { transactionHooks: TransactionHooks } & GetStateAdapterTxContext<TStateAdapter>;

/** Completion callback type. Receives {@link AttemptCompleteOptions} and returns the result. */
export type AttemptCompleteCallback<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap & string,
  TResult,
> = (
  completeOptions: AttemptCompleteOptions<
    TStateAdapter,
    TNavigationMap,
    TJobTypeName,
    ChainTypesReaching<TNavigationMap, TJobTypeName>
  >,
) => Promise<TResult>;

/** Typed completion function provided to the {@link AttemptHandler | attemptHandler}. Call it to finalize the job — either return the output to complete the chain, or call `continueWith` to extend it. */
export type AttemptComplete<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap & string,
> = <
  TReturn extends
    | TNavigationMap[TJobTypeName]["output"]
    | ContinuationJobs<
        GetStateAdapterJobId<TStateAdapter>,
        TNavigationMap,
        TJobTypeName,
        ChainTypesReaching<TNavigationMap, TJobTypeName>
      >,
>(
  completeCallback: (
    completeOptions: AttemptCompleteOptions<
      TStateAdapter,
      TNavigationMap,
      TJobTypeName,
      ChainTypesReaching<TNavigationMap, TJobTypeName>
    >,
  ) => Promise<TReturn>,
) => Promise<
  TReturn extends TNavigationMap[TJobTypeName]["output"]
    ? ResolvedJobWithBlockers<
        GetStateAdapterJobId<TStateAdapter>,
        TNavigationMap,
        TJobTypeName,
        ChainTypesReaching<TNavigationMap, TJobTypeName>
      > & { status: "completed" }
    : ContinuationJobs<
        GetStateAdapterJobId<TStateAdapter>,
        TNavigationMap,
        TJobTypeName,
        ChainTypesReaching<TNavigationMap, TJobTypeName>
      >
>;

/**
 * Configuration for the prepare phase.
 *
 * - `"atomic"` — prepare and complete run in the same transaction.
 * - `"staged"` — prepare commits first, then complete runs in a new transaction with lease renewal.
 */
export type AttemptPrepareOptions = { mode: "atomic" | "staged" };

/** Callback executed during the prepare phase within the transaction. */
export type AttemptPrepareCallback<TStateAdapter extends StateAdapter<BaseTxContext, any>, T> = (
  prepareCallbackOptions: GetStateAdapterTxContext<TStateAdapter>,
) => T | Promise<T>;

/** Typed prepare function provided to the {@link AttemptHandler | attemptHandler}. Controls the processing mode and optionally runs a callback within the prepare transaction. */
export type AttemptPrepare<TStateAdapter extends StateAdapter<BaseTxContext, any>> = {
  (config: AttemptPrepareOptions): Promise<void>;
  <T>(
    config: AttemptPrepareOptions,
    prepareCallback: AttemptPrepareCallback<TStateAdapter, T>,
  ): Promise<Awaited<T>>;
};

/**
 * Handler function called for each job attempt.
 *
 * Receives `signal` (abort signal), `job` (the running job with blockers), `prepare` (transaction setup), and `complete` (finalization).
 * If `prepare` is not called, the worker auto-calls `prepare({ mode: "staged" })`.
 */
export type AttemptHandler<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap & string,
> = (processOptions: {
  signal: TypedAbortSignal<JobAbortReason>;
  job: ResolvedJobWithBlockers<
    GetStateAdapterJobId<TStateAdapter>,
    TNavigationMap,
    TJobTypeName,
    ChainTypesReaching<TNavigationMap, TJobTypeName>
  > & { status: "running" };
  prepare: AttemptPrepare<TStateAdapter>;
  complete: AttemptComplete<TStateAdapter, TNavigationMap, TJobTypeName>;
}) => Promise<
  | (ResolvedJobWithBlockers<
      GetStateAdapterJobId<TStateAdapter>,
      TNavigationMap,
      TJobTypeName,
      ChainTypesReaching<TNavigationMap, TJobTypeName>
    > & { status: "completed" })
  | ContinuationJobs<
      GetStateAdapterJobId<TStateAdapter>,
      TNavigationMap,
      TJobTypeName,
      ChainTypesReaching<TNavigationMap, TJobTypeName>
    >
>;

export const runJobProcess = async ({
  helpers,
  attemptHandler,
  prepareTransactionContext,
  job,
  backoffConfig,
  leaseConfig,
  workerId,
  attemptMiddlewares,
}: {
  helpers: Helpers;
  attemptHandler: AttemptHandler<StateAdapter<BaseTxContext, any>, BaseNavigationMap, string>;
  prepareTransactionContext: TransactionContext<BaseTxContext>;
  job: StateJob;
  backoffConfig: BackoffConfig;
  leaseConfig: LeaseConfig;
  workerId: string;
  attemptMiddlewares?: JobAttemptMiddleware<StateAdapter<BaseTxContext, any>, BaseNavigationMap>[];
}): Promise<void> => {
  let completeTransactionContext: TransactionContext<BaseTxContext> | null = null;

  const abortController = new AbortController() as TypedAbortController<JobAbortReason>;
  const refetchJobForUpdate = async (txCtx: BaseTxContext) => {
    if (abortController.signal.aborted && abortController.signal.reason) {
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
    }

    await refetchJobForUpdateImpl(helpers, {
      txCtx,
      job,
      allowEmptyWorker: prepareTransactionContext.status === "pending",
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
    cb: (txCtx: BaseTxContext) => Promise<T>,
  ): Promise<T> => {
    if (abortController.signal.aborted && abortController.signal.reason) {
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
    }

    if (prepareTransactionContext.status === "pending") {
      return prepareTransactionContext.run(async (txCtx) => cb(txCtx));
    }
    if (completeTransactionContext && completeTransactionContext.status === "pending") {
      return completeTransactionContext.run(async (txCtx) => cb(txCtx));
    }

    return helpers.stateAdapter.runInTransaction(async (txCtx) => {
      await refetchJobForUpdate(txCtx);
      return cb(txCtx);
    });
  };
  const leaseManager = createLeaseManager({
    commitLease: async (leaseMs: number) => {
      try {
        await runInGuardedTransaction(async (txCtx) => {
          await helpers.stateAdapter.renewJobLease({
            txCtx,
            jobId: job.id,
            workerId,
            leaseDurationMs: leaseMs,
          });
        });
        helpers.observabilityHelper.jobAttemptLeaseRenewed(job, { workerId });
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
    config: leaseConfig,
  });
  let disposeOwnershipListener: (() => Promise<void>) | null = null;

  const blockerPairs = await prepareTransactionContext.run(async (txCtx) =>
    helpers.stateAdapter.getJobBlockers({ txCtx, jobId: job.id }),
  );
  await prepareTransactionContext.run(async (txCtx) =>
    helpers.stateAdapter.renewJobLease({
      txCtx,
      jobId: job.id,
      workerId,
      leaseDurationMs: leaseConfig.leaseMs,
    }),
  );
  const runningJob = {
    ...mapStateJobToJob(job),
    blockers: blockerPairs.map(mapStateJobPairToJobChain) as CompletedJobChain<
      JobChain<any, any, any, any>
    >[],
  } as ResolvedJobWithBlockers<any, any, any, any> & { status: "running" };

  const runJobAttempt = async (transactionHooks: TransactionHooks) => {
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

    let prepareAccessed = false;
    let prepareCalled = false;
    const prepare = (async <T>(
      config: { mode: "atomic" | "staged" },
      prepareCallback?: (options: BaseTxContext) => T | Promise<T>,
    ) => {
      if (prepareCalled) {
        throw new Error("Prepare can only be called once");
      }
      prepareCalled = true;

      const prepareSpan = attemptSpanHandle?.startPrepare();
      let callbackOutput: T | undefined;
      try {
        callbackOutput = await prepareTransactionContext.run(async (txCtx) =>
          prepareCallback?.({ ...txCtx }),
        );
      } finally {
        prepareSpan?.end();
      }

      if (config.mode === "staged") {
        await prepareTransactionContext.resolve();

        await leaseManager.start();
        try {
          disposeOwnershipListener = await helpers.notifyAdapter.listenJobOwnershipLost(
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
    }) as AttemptPrepare<StateAdapter<BaseTxContext, any>>;

    let completeCalled = false;
    const complete = (async (
      completeCallback: (
        options: {
          continueWith: (
            options: {
              typeName: string;
              input: unknown;
              schedule?: ScheduleOptions;
              blockers?: JobChain<any, any, any, any>[];
            } & BaseTxContext,
          ) => Promise<unknown>;
        } & { transactionHooks: TransactionHooks } & BaseTxContext,
      ) => unknown,
    ) => {
      if (autoPreparePromise) {
        await autoPreparePromise;
      }
      if (completeCalled) {
        throw new Error("Complete can only be called once");
      }
      completeCalled = true;
      await disposeOwnershipListener?.();
      await leaseManager.stop();
      const completeSpan = attemptSpanHandle?.startComplete();
      if (prepareTransactionContext.status !== "pending") {
        completeTransactionContext = await createTransactionContext(
          helpers.stateAdapter.runInTransaction,
        );
        await completeTransactionContext.run(async (txCtx) => {
          await refetchJobForUpdate(txCtx);
        });
      }
      const completeSnapshot = snapshotObservabilityBuffer(transactionHooks);
      let result;
      try {
        result = await runInGuardedTransaction(async (txCtx) => {
          let continuedJob: Job<any, any, any, any> | null = null;
          const output = await completeCallback({
            continueWith: async ({ typeName, input, schedule, blockers }) => {
              if (continuedJob) {
                throw new Error("continueWith can only be called once");
              }
              continuedJob = await continueWith(helpers, {
                typeName,
                input,
                txCtx,
                transactionHooks,
                schedule,
                blockers: blockers as any,
                chainId: job.chainId,
                chainIndex: job.chainIndex + 1,
                chainTypeName: job.chainTypeName,
                originChainTraceContext:
                  attemptSpanHandle?.getChainTraceContext() ?? job.chainTraceContext,
                originTraceContext: attemptSpanHandle?.getTraceContext() ?? job.traceContext,
                fromTypeName: job.typeName,
              });
              return continuedJob;
            },
            transactionHooks,
            ...txCtx,
          });
          bufferObservabilityEvent(transactionHooks, () => {
            helpers.observabilityHelper.jobAttemptCompleted(job, {
              output: continuedJob ? null : output,
              continuedWith: continuedJob ?? undefined,
              workerId,
            });
          });
          const completedStateJob = await finishJob(
            helpers,
            continuedJob
              ? { job, txCtx, transactionHooks, workerId, type: "continueWith", continuedJob }
              : { job, txCtx, transactionHooks, workerId, type: "completeChain", output },
          );
          const jobResult = continuedJob ?? {
            ...mapStateJobToJob(completedStateJob),
            blockers: runningJob.blockers,
          };
          const continued = continuedJob
            ? {
                jobId: (continuedJob as Job<any, any, any, any>).id,
                jobTypeName: (continuedJob as Job<any, any, any, any>).typeName,
              }
            : undefined;
          const chainCompleted = !continuedJob ? { output } : undefined;
          return {
            result: jobResult,
            continued,
            chainCompleted,
          };
        });
      } catch (error) {
        rollbackObservabilityBuffer(transactionHooks, completeSnapshot);
        throw error;
      }
      completeSpan?.end();
      helpers.observabilityHelper.jobAttemptDuration(job, {
        durationMs: Date.now() - attemptStartTime,
        workerId,
      });
      attemptSpanHandle?.end({
        status: "completed",
        continued: result.continued,
        chainCompleted: result.chainCompleted,
      });
      return result.result;
    }) as AttemptComplete<StateAdapter<BaseTxContext, any>, BaseNavigationMap, string>;

    let autoSetupDone = false;
    let autoPreparePromise: Promise<void> | null = null;
    try {
      const attemptPromise = attemptHandler({
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
        complete,
      });
      attemptPromise.catch(() => {});

      if (!prepareAccessed && !prepareCalled) {
        autoPreparePromise = prepare({ mode: "staged" });
        await autoPreparePromise;
        autoSetupDone = true;
      }

      await attemptPromise;
      await prepareTransactionContext.resolve();
      await completeTransactionContext?.resolve();
    } catch (error) {
      const errorSnapshot = snapshotObservabilityBuffer(transactionHooks);
      try {
        const errorResult = await runInGuardedTransaction(async (txCtx) =>
          handleJobHandlerError(helpers, {
            job,
            error,
            txCtx,
            transactionHooks,
            backoffConfig,
            workerId,
          }),
        );

        attemptSpanHandle?.end({
          status: "failed",
          error,
          rescheduledAt: errorResult.schedule?.at,
          rescheduledAfterMs: errorResult.schedule?.afterMs,
        });
      } catch {
        rollbackObservabilityBuffer(transactionHooks, errorSnapshot);
        attemptSpanHandle?.end({ status: "failed", error });
      }
      await prepareTransactionContext.resolve();
      await completeTransactionContext?.resolve();
      await disposeOwnershipListener?.();
      await leaseManager.stop();
    }
  };

  await (attemptMiddlewares ?? []).reduceRight(
    (next, mw) => async () => mw({ job: runningJob, workerId }, next),
    async () =>
      withTransactionHooks(async (transactionHooks) => {
        await runJobAttempt(transactionHooks);
      }),
  )();
};
