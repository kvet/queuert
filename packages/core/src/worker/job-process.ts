import {
  CompletedJobSequence,
  JobSequence,
  mapStateJobPairToJobSequence,
} from "../entities/job-sequence.js";
import {
  BaseJobTypeDefinitions,
  ContinuationJobs,
  ContinuationJobTypes,
  HasBlockers,
  JobOf,
} from "../entities/job-type.js";
import { CompletedJob, CreatedJob, Job, mapStateJobToJob, RunningJob } from "../entities/job.js";
import { TypedAbortController, TypedAbortSignal } from "../helpers/abort.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import { createSignal } from "../helpers/signal.js";
import type { Listener, NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
  ProcessHelper,
  StartBlockersFn,
} from "../queuert-helper.js";
import {
  BaseStateAdapterContext,
  GetStateAdapterContext,
  StateAdapter,
  StateJob,
} from "../state-adapter/state-adapter.js";
import { createLeaseManager, type LeaseConfig } from "./lease.js";

export type { BackoffConfig } from "../helpers/backoff.js";
export type { LeaseConfig } from "./lease.js";

export class RescheduleJobError extends Error {
  public readonly afterMs: number;
  constructor(
    message: string,
    options: {
      afterMs: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.afterMs = options.afterMs;
  }
}

export const rescheduleJob = (afterMs: number, cause?: unknown): never => {
  throw new RescheduleJobError(`Reschedule job after ${afterMs}ms`, {
    afterMs,
    cause,
  });
};

export type CompleteCallbackOptions<
  TStateAdapter extends StateAdapter<BaseStateAdapterContext>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = {
  continueWith: <
    TContinueJobTypeName extends ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName> & string,
  >(
    options: {
      typeName: TContinueJobTypeName;
      input: JobOf<TJobTypeDefinitions, TContinueJobTypeName>["input"];
    } & (HasBlockers<TJobTypeDefinitions, TContinueJobTypeName> extends true
      ? { startBlockers: StartBlockersFn<TJobTypeDefinitions, TContinueJobTypeName> }
      : { startBlockers?: never }),
  ) => Promise<CreatedJob<JobOf<TJobTypeDefinitions, TContinueJobTypeName>>>;
} & GetStateAdapterContext<TStateAdapter>;

export type CompleteCallback<
  TStateAdapter extends StateAdapter<BaseStateAdapterContext>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
  TResult,
> = (
  completeOptions: CompleteCallbackOptions<TStateAdapter, TJobTypeDefinitions, TJobTypeName>,
) => Promise<TResult>;

export type CompleteFn<
  TStateAdapter extends StateAdapter<BaseStateAdapterContext>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = <
  TReturn extends
    | TJobTypeDefinitions[TJobTypeName]["output"]
    | ContinuationJobs<TJobTypeDefinitions, TJobTypeName>,
>(
  completeCallback: (
    completeOptions: CompleteCallbackOptions<TStateAdapter, TJobTypeDefinitions, TJobTypeName>,
  ) => Promise<TReturn>,
) => Promise<
  TReturn extends TJobTypeDefinitions[TJobTypeName]["output"]
    ? CompletedJob<JobOf<TJobTypeDefinitions, TJobTypeName>>
    : ContinuationJobs<TJobTypeDefinitions, TJobTypeName>
>;

export type PrepareConfig = { mode: "atomic" | "staged" };

export type PrepareCallback<TStateAdapter extends StateAdapter<BaseStateAdapterContext>, T> = (
  prepareCallbackOptions: GetStateAdapterContext<TStateAdapter>,
) => T | Promise<T>;

export type PrepareFn<TStateAdapter extends StateAdapter<BaseStateAdapterContext>> = {
  (config: PrepareConfig): Promise<void>;
  <T>(
    config: PrepareConfig,
    prepareCallback: PrepareCallback<TStateAdapter, T>,
  ): Promise<Awaited<T>>;
};

export type JobProcessFn<
  TStateAdapter extends StateAdapter<BaseStateAdapterContext>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = (processOptions: {
  signal: TypedAbortSignal<"taken_by_another_worker" | "error" | "not_found" | "already_completed">;
  job: RunningJob<JobOf<TJobTypeDefinitions, TJobTypeName>>;
  prepare: PrepareFn<TStateAdapter>;
  complete: CompleteFn<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;
}) => Promise<
  | CompletedJob<JobOf<TJobTypeDefinitions, TJobTypeName>>
  | ContinuationJobs<TJobTypeDefinitions, TJobTypeName>
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
}: {
  helper: ProcessHelper;
  process: JobProcessFn<StateAdapter<BaseStateAdapterContext>, BaseJobTypeDefinitions, string>;
  context: BaseStateAdapterContext;
  job: StateJob;
  retryConfig: BackoffConfig;
  leaseConfig: LeaseConfig;
  workerId: string;
  notifyAdapter: NotifyAdapter;
}): Promise<() => Promise<void>> => {
  const firstLeaseCommitted = createSignal();
  const claimTransactionClosed = createSignal();

  const abortController = new AbortController() as TypedAbortController<
    "taken_by_another_worker" | "error" | "not_found" | "already_completed"
  >;

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

  let ownershipListener: Listener<void> | null = null;

  const startProcessing = async (job: StateJob) => {
    const blockerPairs = await helper.getJobBlockers({ jobId: job.id, context });
    const runningJob = {
      ...mapStateJobToJob(job),
      blockers: blockerPairs.map(mapStateJobPairToJobSequence) as CompletedJobSequence<
        JobSequence<any, any, any>
      >[],
    } as RunningJob<Job<any, any, any>>;

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
        ownershipListener = await notifyAdapter.listenJobOwnershipLost(job.id);

        void (async () => {
          const result = await ownershipListener.wait();
          if (result.received && !abortController.signal.aborted) {
            await runInGuardedTransaction(async () => Promise.resolve());
          }
        })().catch(() => {});
      }

      return callbackOutput;
    }) as PrepareFn<StateAdapter<BaseStateAdapterContext>>;

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
              startBlockers?: StartBlockersFn<BaseJobTypeDefinitions, string>;
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
      await ownershipListener?.dispose();
      await leaseManager.stop();
      const result = await runInGuardedTransaction(async (context) => {
        let continuedJob: Job<any, any, any> | null = null;
        const output = await completeCallback({
          continueWith: async ({ typeName, input, startBlockers }) => {
            if (continuedJob) {
              throw new Error("continueWith can only be called once");
            }
            continuedJob = await helper.continueWith({
              typeName,
              input,
              context,
              startBlockers: startBlockers as any,
            });
            return continuedJob;
          },
          ...context,
        });
        const completedStateJob = await helper.finishJob(
          continuedJob
            ? { job, context, workerId, type: "continueWith", continuedJob }
            : { job, context, workerId, type: "completeSequence", output },
        );
        return (
          continuedJob ?? {
            ...mapStateJobToJob(completedStateJob),
            blockers: runningJob.blockers,
          }
        );
      });
      completeSucceeded = true;
      return result;
    }) as CompleteFn<StateAdapter<BaseStateAdapterContext>, BaseJobTypeDefinitions, string>;

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
      await ownershipListener?.dispose();
      await leaseManager.stop();
    }
  };

  const processingPromise = helper.withNotifyContext(async () => startProcessing(job));

  await Promise.race([firstLeaseCommitted.onSignal, processingPromise]);

  return async () => {
    claimTransactionClosed.signalOnce();
    await Promise.race([leaseErrorPromise, processingPromise]);
  };
};
