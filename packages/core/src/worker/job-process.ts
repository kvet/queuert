import { CompletedJobChain, JobChain, mapStateJobPairToJobChain } from "../entities/job-chain.js";
import {
  BaseJobTypeDefinitions,
  ContinuationJobs,
  ContinuationJobTypes,
  EntryJobTypeDefinitions,
  HasBlockers,
  JobOf,
  ChainTypesReaching,
} from "../entities/job-type.js";
import { CompletedJob, CreatedJob, Job, mapStateJobToJob, RunningJob } from "../entities/job.js";
import { ScheduleOptions } from "../entities/schedule.js";
import { TypedAbortController, TypedAbortSignal } from "../helpers/abort.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import { createSignal } from "../helpers/signal.js";
import type { NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
  ProcessHelper,
  StartBlockersFn,
} from "../queuert-helper.js";
import {
  BaseStateAdapterContext,
  GetStateAdapterJobId,
  GetStateAdapterTxContext,
  StateAdapter,
  StateJob,
} from "../state-adapter/state-adapter.js";
import { createLeaseManager, type LeaseConfig } from "./lease.js";

export type { BackoffConfig } from "../helpers/backoff.js";
export type { LeaseConfig } from "./lease.js";

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
  TStateAdapter extends StateAdapter<BaseStateAdapterContext, BaseStateAdapterContext, any>,
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
          startBlockers: StartBlockersFn<
            GetStateAdapterJobId<TStateAdapter>,
            TJobTypeDefinitions,
            TContinueJobTypeName
          >;
        }
      : { startBlockers?: never }),
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
  TStateAdapter extends StateAdapter<BaseStateAdapterContext, BaseStateAdapterContext, any>,
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
  TStateAdapter extends StateAdapter<BaseStateAdapterContext, BaseStateAdapterContext, any>,
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

export type PrepareCallback<
  TStateAdapter extends StateAdapter<BaseStateAdapterContext, BaseStateAdapterContext, any>,
  T,
> = (prepareCallbackOptions: GetStateAdapterTxContext<TStateAdapter>) => T | Promise<T>;

export type PrepareFn<
  TStateAdapter extends StateAdapter<BaseStateAdapterContext, BaseStateAdapterContext, any>,
> = {
  (config: PrepareConfig): Promise<void>;
  <T>(
    config: PrepareConfig,
    prepareCallback: PrepareCallback<TStateAdapter, T>,
  ): Promise<Awaited<T>>;
};

export type JobProcessFn<
  TStateAdapter extends StateAdapter<BaseStateAdapterContext, BaseStateAdapterContext, any>,
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
  process,
  context,
  job,
  retryConfig,
  leaseConfig,
  workerId,
  notifyAdapter,
  typeNames,
}: {
  helper: ProcessHelper;
  process: JobProcessFn<
    StateAdapter<BaseStateAdapterContext, BaseStateAdapterContext, any>,
    BaseJobTypeDefinitions,
    string
  >;
  context: BaseStateAdapterContext;
  job: StateJob;
  retryConfig: BackoffConfig;
  leaseConfig: LeaseConfig;
  workerId: string;
  notifyAdapter: NotifyAdapter;
  typeNames: readonly string[];
}): Promise<() => Promise<void>> => {
  const firstLeaseCommitted = createSignal();
  const claimTransactionClosed = createSignal();

  const abortController = new AbortController() as TypedAbortController<JobAbortReason>;

  const runInGuardedTransaction = async <T>(
    cb: (context: BaseStateAdapterContext) => Promise<T>,
  ): Promise<T> => {
    if (!firstLeaseCommitted.signalled) {
      return cb(context);
    }

    return helper.runInTransaction(async (context) => {
      await helper
        .refetchJobForUpdate({
          context,
          job,
          allowEmptyWorker: !firstLeaseCommitted.signalled,
          workerId,
        })
        .catch((error: unknown) => {
          if (error instanceof JobNotFoundError) {
            if (!abortController.signal.aborted) {
              abortController.abort("not_found");
            }
          }
          if (error instanceof JobAlreadyCompletedError) {
            if (!abortController.signal.aborted) {
              abortController.abort("already_completed");
            }
          }
          if (error instanceof JobTakenByAnotherWorkerError) {
            if (!abortController.signal.aborted) {
              abortController.abort("taken_by_another_worker");
            }
          }
          throw error;
        });

      return cb(context);
    });
  };

  const { promise: leaseErrorPromise, reject: leaseErrorReject } = Promise.withResolvers<void>();
  const leaseManager = createLeaseManager({
    commitLease: async (leaseMs: number) => {
      try {
        await runInGuardedTransaction(async (context) => {
          await helper.renewJobLease({
            context,
            job,
            leaseMs,
            workerId,
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
        leaseErrorReject(error);
        throw error;
      }
    },
    config: leaseConfig,
  });

  let disposeOwnershipListener: (() => Promise<void>) | null = null;

  const startProcessing = async (job: StateJob) => {
    helper.observabilityHelper.jobTypeProcessingChange(1, job, workerId);
    helper.observabilityHelper.jobTypeIdleChange(-1, workerId, typeNames);
    try {
      const attemptStartTime = Date.now();
      const blockerPairs = await helper.getJobBlockers({ jobId: job.id, context });
      const runningJob = {
        ...mapStateJobToJob(job),
        blockers: blockerPairs.map(mapStateJobPairToJobChain) as CompletedJobChain<
          JobChain<any, any, any, any>
        >[],
      } as RunningJob<JobOf<any, any, any, any>>;

      let prepareAccessed = false;
      let prepareCalled = false;
      const prepare = (async <T>(
        config: { mode: "atomic" | "staged" },
        prepareCallback?: (options: BaseStateAdapterContext) => T | Promise<T>,
      ) => {
        if (prepareCalled) {
          throw new Error("Prepare can only be called once");
        }
        prepareCalled = true;

        const callbackOutput = await prepareCallback?.({ ...context });

        await helper.renewJobLease({
          context,
          job,
          leaseMs: leaseConfig.leaseMs,
          workerId,
        });
        firstLeaseCommitted.signalOnce();
        await claimTransactionClosed.onSignal;

        if (config.mode === "staged") {
          await leaseManager.start();
          try {
            disposeOwnershipListener = await notifyAdapter.listenJobOwnershipLost(job.id, () => {
              if (!abortController.signal.aborted) {
                void runInGuardedTransaction(async () => Promise.resolve()).catch(() => {});
              }
            });
          } catch {}
        }

        return callbackOutput;
      }) as PrepareFn<StateAdapter<BaseStateAdapterContext, BaseStateAdapterContext, any>>;

      let completeCalled = false;
      let completeSucceeded = false;
      // oxlint-disable-next-line no-unsafe-type-assertion
      const complete = (async (
        completeCallback: (
          options: {
            continueWith: (
              options: {
                typeName: string;
                input: unknown;
                schedule?: ScheduleOptions;
                startBlockers?: StartBlockersFn<any, BaseJobTypeDefinitions, string>;
              } & BaseStateAdapterContext,
            ) => Promise<unknown>;
          } & BaseStateAdapterContext,
        ) => unknown,
      ) => {
        if (!prepareCalled) {
          // Auto-setup in atomic mode if complete is called before prepare
          await prepare({ mode: "atomic" });
        }
        if (completeCalled) {
          throw new Error("Complete can only be called once");
        }
        completeCalled = true;
        await disposeOwnershipListener?.();
        await leaseManager.stop();
        const result = await runInGuardedTransaction(async (context) => {
          let continuedJob: Job<any, any, any, any, any[]> | null = null;
          const output = await completeCallback({
            continueWith: async ({ typeName, input, schedule, startBlockers }) => {
              if (continuedJob) {
                throw new Error("continueWith can only be called once");
              }
              continuedJob = await helper.withJobContext(
                {
                  chainId: job.chainId,
                  chainTypeName: job.chainTypeName,
                  rootChainId: job.rootChainId,
                  originId: job.id,
                },
                async () =>
                  helper.continueWith({
                    typeName,
                    input,
                    context,
                    schedule,
                    startBlockers: startBlockers as any,
                    fromTypeName: job.typeName,
                  }),
              );
              return continuedJob;
            },
            ...context,
          });
          helper.logJobAttemptCompleted({
            job,
            output: continuedJob ? null : output,
            continuedWith: continuedJob ?? undefined,
            workerId,
          });
          const completedStateJob = await helper.finishJob(
            continuedJob
              ? { job, context, workerId, type: "continueWith", continuedJob }
              : { job, context, workerId, type: "completeChain", output },
          );
          return (
            continuedJob ?? {
              ...mapStateJobToJob(completedStateJob),
              blockers: runningJob.blockers,
            }
          );
        });
        completeSucceeded = true;
        helper.observabilityHelper.jobAttemptDuration(job, {
          durationMs: Date.now() - attemptStartTime,
          workerId,
        });
        return result;
      }) as CompleteFn<
        StateAdapter<BaseStateAdapterContext, BaseStateAdapterContext, any>,
        BaseJobTypeDefinitions,
        string
      >;

      let autoSetupDone = false;
      try {
        const processPromise = process({
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
        processPromise.catch(() => {});

        if (!prepareAccessed && !prepareCalled) {
          await prepare({ mode: "staged" });
          autoSetupDone = true;
        }

        await processPromise;
      } catch (error) {
        const runInTx = completeSucceeded
          ? helper.runInTransaction.bind(helper)
          : runInGuardedTransaction;
        await runInTx(async (context) =>
          helper.handleJobHandlerError({
            job,
            error,
            context,
            retryConfig,
            workerId,
          }),
        );
      } finally {
        await disposeOwnershipListener?.();
        await leaseManager.stop();
      }
    } finally {
      helper.observabilityHelper.jobTypeIdleChange(1, workerId, typeNames);
      helper.observabilityHelper.jobTypeProcessingChange(-1, job, workerId);
    }
  };

  const processingPromise = helper.withNotifyContext(async () => startProcessing(job));

  await Promise.race([firstLeaseCommitted.onSignal, processingPromise]);

  return async () => {
    claimTransactionClosed.signalOnce();
    await Promise.race([leaseErrorPromise, processingPromise]);
  };
};
