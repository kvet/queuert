import {
  type CompletedJobChain,
  type JobChain,
  mapStateJobPairToJobChain,
} from "../entities/job-chain.js";
import {
  type BaseJobTypeDefinitions,
  type BlockerChains,
  type ChainTypesReaching,
  type ContinuationJobTypes,
  type ContinuationJobs,
  type EntryJobTypeDefinitions,
  type HasBlockers,
  type JobOf,
} from "../entities/job-type.js";
import {
  type CompletedJob,
  type CreatedJob,
  type Job,
  type RunningJob,
  mapStateJobToJob,
} from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
} from "../errors.js";
import { type Helper } from "../helper.js";
import { type TypedAbortController, type TypedAbortSignal } from "../helpers/abort.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import {
  type TransactionContext,
  createTransactionContext,
} from "../helpers/transaction-context.js";
import {
  type BaseTxContext,
  type GetStateAdapterJobId,
  type GetStateAdapterTxContext,
  type StateAdapter,
  type StateJob,
} from "../state-adapter/state-adapter.js";
import { type LeaseConfig, createLeaseManager } from "./lease.js";

export type { BackoffConfig } from "../helpers/backoff.js";
export type { LeaseConfig } from "./lease.js";

export type JobAttemptMiddleware<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
> = <T>(
  context: {
    job: RunningJob<
      JobOf<
        GetStateAdapterJobId<TStateAdapter>,
        TJobTypeDefinitions,
        keyof TJobTypeDefinitions & string,
        keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string
      >
    >;
    workerId: string;
  },
  next: () => Promise<T>,
) => Promise<T>;

export type JobAbortReason =
  | "taken_by_another_worker"
  | "error"
  | "not_found"
  | "already_completed";

export class RescheduleJobError extends Error {
  public readonly schedule: ScheduleOptions;
  constructor(
    message: string,
    options: {
      schedule: ScheduleOptions;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "RescheduleJobError";
    this.schedule = options.schedule;
  }
}

export const rescheduleJob = (schedule: ScheduleOptions, cause?: unknown): never => {
  throw new RescheduleJobError(`Reschedule job`, {
    schedule,
    cause,
  });
};

export type CompleteCallbackOptions<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
  TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
> = {
  continueWith: <
    TContinueJobTypeName extends ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName> & string,
  >(
    options: {
      typeName: TContinueJobTypeName;
      input: JobOf<
        GetStateAdapterJobId<TStateAdapter>,
        TJobTypeDefinitions,
        TContinueJobTypeName,
        TChainTypeName
      >["input"];
      schedule?: ScheduleOptions;
    } & (HasBlockers<TJobTypeDefinitions, TContinueJobTypeName> extends true
      ? {
          blockers: BlockerChains<
            GetStateAdapterJobId<TStateAdapter>,
            TJobTypeDefinitions,
            TContinueJobTypeName
          >;
        }
      : { blockers?: never }),
  ) => Promise<
    CreatedJob<
      JobOf<
        GetStateAdapterJobId<TStateAdapter>,
        TJobTypeDefinitions,
        TContinueJobTypeName,
        TChainTypeName
      >
    >
  >;
} & GetStateAdapterTxContext<TStateAdapter>;

export type CompleteCallback<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
  TResult,
> = (
  completeOptions: CompleteCallbackOptions<
    TStateAdapter,
    TJobTypeDefinitions,
    TJobTypeName,
    ChainTypesReaching<TJobTypeDefinitions, TJobTypeName>
  >,
) => Promise<TResult>;

export type CompleteFn<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = <
  TReturn extends
    | TJobTypeDefinitions[TJobTypeName]["output"]
    | ContinuationJobs<
        GetStateAdapterJobId<TStateAdapter>,
        TJobTypeDefinitions,
        TJobTypeName,
        ChainTypesReaching<TJobTypeDefinitions, TJobTypeName>
      >,
>(
  completeCallback: (
    completeOptions: CompleteCallbackOptions<
      TStateAdapter,
      TJobTypeDefinitions,
      TJobTypeName,
      ChainTypesReaching<TJobTypeDefinitions, TJobTypeName>
    >,
  ) => Promise<TReturn>,
) => Promise<
  TReturn extends TJobTypeDefinitions[TJobTypeName]["output"]
    ? CompletedJob<
        JobOf<
          GetStateAdapterJobId<TStateAdapter>,
          TJobTypeDefinitions,
          TJobTypeName,
          ChainTypesReaching<TJobTypeDefinitions, TJobTypeName>
        >
      >
    : ContinuationJobs<
        GetStateAdapterJobId<TStateAdapter>,
        TJobTypeDefinitions,
        TJobTypeName,
        ChainTypesReaching<TJobTypeDefinitions, TJobTypeName>
      >
>;

export type PrepareConfig = { mode: "atomic" | "staged" };

export type PrepareCallback<TStateAdapter extends StateAdapter<BaseTxContext, any>, T> = (
  prepareCallbackOptions: GetStateAdapterTxContext<TStateAdapter>,
) => T | Promise<T>;

export type PrepareFn<TStateAdapter extends StateAdapter<BaseTxContext, any>> = {
  (config: PrepareConfig): Promise<void>;
  <T>(
    config: PrepareConfig,
    prepareCallback: PrepareCallback<TStateAdapter, T>,
  ): Promise<Awaited<T>>;
};

export type AttemptHandlerFn<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = (processOptions: {
  signal: TypedAbortSignal<JobAbortReason>;
  job: RunningJob<
    JobOf<
      GetStateAdapterJobId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      ChainTypesReaching<TJobTypeDefinitions, TJobTypeName>
    >
  >;
  prepare: PrepareFn<TStateAdapter>;
  complete: CompleteFn<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;
}) => Promise<
  | CompletedJob<
      JobOf<
        GetStateAdapterJobId<TStateAdapter>,
        TJobTypeDefinitions,
        TJobTypeName,
        ChainTypesReaching<TJobTypeDefinitions, TJobTypeName>
      >
    >
  | ContinuationJobs<
      GetStateAdapterJobId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      ChainTypesReaching<TJobTypeDefinitions, TJobTypeName>
    >
>;

export const runJobProcess = async ({
  helper,
  attemptHandler,
  prepareTransactionContext,
  job,
  retryConfig,
  leaseConfig,
  workerId,
  attemptMiddlewares,
}: {
  helper: Helper;
  attemptHandler: AttemptHandlerFn<
    StateAdapter<BaseTxContext, any>,
    BaseJobTypeDefinitions,
    string
  >;
  prepareTransactionContext: TransactionContext<BaseTxContext>;
  job: StateJob;
  retryConfig: BackoffConfig;
  leaseConfig: LeaseConfig;
  workerId: string;
  attemptMiddlewares?: JobAttemptMiddleware<
    StateAdapter<BaseTxContext, any>,
    BaseJobTypeDefinitions
  >[];
}): Promise<void> => {
  let completeTransactionContext: TransactionContext<BaseTxContext> | null = null;

  const abortController = new AbortController() as TypedAbortController<JobAbortReason>;
  const refetchJobForUpdate = async (txContext: BaseTxContext) => {
    if (abortController.signal.aborted && abortController.signal.reason) {
      if (abortController.signal.reason === "already_completed") {
        throw new JobAlreadyCompletedError("Job already completed (signal aborted)");
      }
      if (abortController.signal.reason === "not_found") {
        throw new JobNotFoundError("Job not found (signal aborted)");
      }
      if (abortController.signal.reason === "taken_by_another_worker") {
        throw new JobTakenByAnotherWorkerError("Job taken by another worker (signal aborted)");
      }
      throw new Error(`Job processing aborted: ${abortController.signal.reason}`);
    }

    await helper
      .refetchJobForUpdate({
        txContext,
        job,
        allowEmptyWorker: prepareTransactionContext.status === "pending", // TODO!!!: remove?
        workerId,
      })
      .catch((error: unknown) => {
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
    cb: (txContext: BaseTxContext) => Promise<T>,
  ): Promise<T> => {
    if (abortController.signal.aborted && abortController.signal.reason) {
      if (abortController.signal.reason === "already_completed") {
        throw new JobAlreadyCompletedError("Job already completed (signal aborted)");
      }
      if (abortController.signal.reason === "not_found") {
        throw new JobNotFoundError("Job not found (signal aborted)");
      }
      if (abortController.signal.reason === "taken_by_another_worker") {
        throw new JobTakenByAnotherWorkerError("Job taken by another worker (signal aborted)");
      }
      throw new Error(`Job processing aborted: ${abortController.signal.reason}`);
    }

    if (prepareTransactionContext.status === "pending") {
      return prepareTransactionContext.run(async (txContext) => cb(txContext));
    }
    if (completeTransactionContext && completeTransactionContext.status === "pending") {
      return completeTransactionContext.run(async (txContext) => cb(txContext));
    }

    return helper.stateAdapter.runInTransaction(async (txContext) => {
      await refetchJobForUpdate(txContext);
      return cb(txContext);
    });
  };
  const leaseManager = createLeaseManager({
    commitLease: async (leaseMs: number) => {
      try {
        await runInGuardedTransaction(async (txContext) => {
          await helper.stateAdapter.renewJobLease({
            txContext,
            jobId: job.id,
            workerId,
            leaseDurationMs: leaseMs,
          });
        });
        helper.observabilityHelper.jobAttemptLeaseRenewed(job, { workerId });
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

  const blockerPairs = await prepareTransactionContext.run(async (txContext) =>
    helper.stateAdapter.getJobBlockers({ txContext, jobId: job.id }),
  );
  await prepareTransactionContext.run(async (txContext) =>
    helper.stateAdapter.renewJobLease({
      txContext,
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
  } as RunningJob<JobOf<any, any, any, any>>;

  const runJobAttempt = async () => {
    const attemptStartTime = Date.now();

    helper.observabilityHelper.jobAttemptStarted(job, { workerId });
    const attemptSpanHandle = helper.observabilityHelper.startAttemptSpan({
      chainId: job.chainId,
      chainTypeName: job.chainTypeName,
      jobId: job.id,
      jobTypeName: job.typeName,
      attempt: job.attempt,
      workerId,
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
        callbackOutput = await prepareTransactionContext.run(async (txContext) =>
          prepareCallback?.({ ...txContext }),
        );
      } finally {
        prepareSpan?.end();
      }

      if (config.mode === "staged") {
        await prepareTransactionContext.resolve();

        await leaseManager.start();
        try {
          disposeOwnershipListener = await helper.notifyAdapter.listenJobOwnershipLost(
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
    }) as PrepareFn<StateAdapter<BaseTxContext, any>>;

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
        } & BaseTxContext,
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
          helper.stateAdapter.runInTransaction,
        );
        await completeTransactionContext.run(async (txContext) => {
          await refetchJobForUpdate(txContext);
        });
      }
      const result = await runInGuardedTransaction(async (txContext) => {
        let continuedJob: Job<any, any, any, any, any[]> | null = null;
        const output = await completeCallback({
          continueWith: async ({ typeName, input, schedule, blockers }) => {
            if (continuedJob) {
              throw new Error("continueWith can only be called once");
            }
            continuedJob = await helper.continueWith({
              typeName,
              input,
              txContext,
              schedule,
              blockers: blockers as any,
              chainId: job.chainId,
              chainTypeName: job.chainTypeName,
              deduplicationKey: `continued:${job.id}`,
              originTraceContext: attemptSpanHandle?.getTraceContext() ?? job.traceContext,
              fromTypeName: job.typeName,
            });
            return continuedJob;
          },
          ...txContext,
        });
        helper.observabilityHelper.jobAttemptCompleted(job, {
          output: continuedJob ? null : output,
          continuedWith: continuedJob ?? undefined,
          workerId,
        });
        const completedStateJob = await helper.finishJob(
          continuedJob
            ? { job, txContext, workerId, type: "continueWith", continuedJob }
            : { job, txContext, workerId, type: "completeChain", output },
        );
        const jobResult = continuedJob ?? {
          ...mapStateJobToJob(completedStateJob),
          blockers: runningJob.blockers,
        };
        const continued = continuedJob
          ? {
              jobId: (continuedJob as Job<any, any, any, any, any[]>).id,
              jobTypeName: (continuedJob as Job<any, any, any, any, any[]>).typeName,
            }
          : undefined;
        const chainCompleted = !continuedJob ? { output } : undefined;
        return {
          result: jobResult,
          continued,
          chainCompleted,
        };
      });
      completeSpan?.end();
      helper.observabilityHelper.jobAttemptDuration(job, {
        durationMs: Date.now() - attemptStartTime,
        workerId,
      });
      attemptSpanHandle?.end({
        status: "completed",
        continued: result.continued,
        chainCompleted: result.chainCompleted,
      });
      return result.result;
    }) as CompleteFn<StateAdapter<BaseTxContext, any>, BaseJobTypeDefinitions, string>;

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
      try {
        const errorResult = await runInGuardedTransaction(async (txContext) =>
          helper.handleJobHandlerError({
            job,
            error,
            txContext,
            retryConfig,
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
    async () => helper.withNotifyContext(runJobAttempt),
  )();
};
