import {
  CompatibleJobTypeTargets,
  CompletedJobSequence,
  JobSequence,
  mapStateJobPairToJobSequence,
  ResolveCompletedBlockerSequences,
} from "../entities/job-sequence.js";
import { BaseJobTypeDefinitions, UnwrapContinuationInput } from "../entities/job-type.js";
import { ContinuedJob, Job, mapStateJobToJob, RunningJob } from "../entities/job.js";
import { TypedAbortController, TypedAbortSignal } from "../helpers/abort.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import { createSignal } from "../helpers/signal.js";
import { Branded } from "../helpers/typescript.js";
import {
  JobDeletedError,
  LeaseExpiredError,
  ProcessHelper,
  ResolvedJobTypeJobs,
  StartBlockersFn,
} from "../queuert-helper.js";
import { GetStateAdapterContext, StateAdapter, StateJob } from "../state-adapter/state-adapter.js";
import { BaseStateProviderContext } from "../state-provider/state-provider.js";
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

export type FinalizeCallback<
  TStateAdapter extends StateAdapter<BaseStateProviderContext>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = (
  finalizeOptions: {
    continueWith: <
      TContinueJobTypeName extends CompatibleJobTypeTargets<TJobTypeDefinitions, TJobTypeName> &
        string,
    >(
      options: {
        typeName: TContinueJobTypeName;
        input: UnwrapContinuationInput<TJobTypeDefinitions[TContinueJobTypeName]["input"]>;
        startBlockers?: StartBlockersFn<TJobTypeDefinitions, TContinueJobTypeName>;
      } & GetStateAdapterContext<TStateAdapter>,
    ) => Promise<
      ContinuedJob<
        TContinueJobTypeName,
        UnwrapContinuationInput<TJobTypeDefinitions[TContinueJobTypeName]["input"]>
      >
    >;
  } & GetStateAdapterContext<TStateAdapter>,
) =>
  | TJobTypeDefinitions[TJobTypeName]["output"]
  | ResolvedJobTypeJobs<TJobTypeDefinitions, TJobTypeName>
  | Promise<
      | TJobTypeDefinitions[TJobTypeName]["output"]
      | ResolvedJobTypeJobs<TJobTypeDefinitions, TJobTypeName>
    >;

export type FinalizeFn<
  TStateAdapter extends StateAdapter<BaseStateProviderContext>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = (
  finalizeCallback: FinalizeCallback<TStateAdapter, TJobTypeDefinitions, TJobTypeName>,
) => Promise<
  Branded<
    | TJobTypeDefinitions[TJobTypeName]["output"]
    | ResolvedJobTypeJobs<TJobTypeDefinitions, TJobTypeName>,
    "finalize_result"
  >
>;

export type PrepareResult<
  TStateAdapter extends StateAdapter<BaseStateProviderContext>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = {
  finalize: FinalizeFn<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;
};

export type PrepareConfig = { mode: "atomic" | "staged" };

export type PrepareCallback<TStateAdapter extends StateAdapter<BaseStateProviderContext>, T> = (
  prepareCallbackOptions: GetStateAdapterContext<TStateAdapter>,
) => T | Promise<T>;

export type PrepareFn<
  TStateAdapter extends StateAdapter<BaseStateProviderContext>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = {
  (
    config: PrepareConfig,
  ): Promise<[PrepareResult<TStateAdapter, TJobTypeDefinitions, TJobTypeName>]>;
  <T>(
    config: PrepareConfig,
    prepareCallback: PrepareCallback<TStateAdapter, T>,
  ): Promise<[PrepareResult<TStateAdapter, TJobTypeDefinitions, TJobTypeName>, T]>;
};

export type JobHandler<
  TStateAdapter extends StateAdapter<BaseStateProviderContext>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = (handlerOptions: {
  signal: TypedAbortSignal<"lease_expired" | "error" | "deleted">;
  job: RunningJob<
    Job<TJobTypeName, UnwrapContinuationInput<TJobTypeDefinitions[TJobTypeName]["input"]>>
  >;
  blockers: ResolveCompletedBlockerSequences<TJobTypeDefinitions, TJobTypeName>;
  prepare: PrepareFn<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;
}) => Promise<
  Branded<
    | TJobTypeDefinitions[TJobTypeName]["output"]
    | ResolvedJobTypeJobs<TJobTypeDefinitions, TJobTypeName>,
    "finalize_result"
  >
>;

export const processJobHandler = async ({
  helper,
  handler,
  context,
  job,
  retryConfig,
  leaseConfig,
  workerId,
}: {
  helper: ProcessHelper;
  handler: JobHandler<StateAdapter<BaseStateProviderContext>, BaseJobTypeDefinitions, string>;
  context: BaseStateProviderContext;
  job: StateJob;
  retryConfig: BackoffConfig;
  leaseConfig: LeaseConfig;
  workerId: string;
}): Promise<() => Promise<void>> => {
  const firstLeaseCommitted = createSignal<void>();
  const claimTransactionClosed = createSignal<void>();

  const abortController = new AbortController() as TypedAbortController<
    "lease_expired" | "error" | "deleted"
  >;

  const runInGuardedTransaction = async <T>(
    cb: (context: BaseStateProviderContext) => Promise<T>,
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
        .catch((error) => {
          if (error instanceof LeaseExpiredError) {
            if (!abortController.signal.aborted) {
              abortController.abort("lease_expired");
            }
          }
          if (error instanceof JobDeletedError) {
            if (!abortController.signal.aborted) {
              abortController.abort("deleted");
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
        if (error instanceof LeaseExpiredError || error instanceof JobDeletedError) {
          return;
        }
        abortController.abort("error");
        leaseErrorReject(error);
        throw error;
      }
    },
    config: leaseConfig,
  });

  const startProcessing = async (job: StateJob) => {
    const blockerPairs = await helper.getJobBlockers({ jobId: job.id, context });
    const runningJob = mapStateJobToJob(job) as RunningJob<Job<any, any>>;
    const blockers = blockerPairs.map(mapStateJobPairToJobSequence) as CompletedJobSequence<
      JobSequence<any, any, any>
    >[];

    const createFinalizeFn = () => {
      let finalizeCalled = false;
      let continueWithCalled = false;
      return async (
        finalizeCallback: (
          options: {
            continueWith: (
              options: {
                typeName: string;
                input: unknown;
                startBlockers?: StartBlockersFn<BaseJobTypeDefinitions, string>;
              } & BaseStateProviderContext,
            ) => Promise<unknown>;
          } & BaseStateProviderContext,
        ) => unknown,
      ) => {
        if (finalizeCalled) {
          throw new Error("Finalize can only be called once");
        }
        finalizeCalled = true;
        await leaseManager.stop();
        return runInGuardedTransaction(async (context) => {
          const output = await finalizeCallback({
            continueWith: async ({ typeName, input, startBlockers, ...context }) => {
              if (continueWithCalled) {
                throw new Error("continueWith can only be called once");
              }
              continueWithCalled = true;
              return helper.continueWith({
                typeName,
                input,
                context,
                startBlockers: startBlockers as any,
              });
            },
            ...context,
          });
          await helper.finishJob({
            job,
            output,
            context,
            workerId,
          });
        });
      };
    };

    let prepareCalled = false;
    const prepare = (async <T>(
      config: { mode: "atomic" | "staged" },
      prepareCallback?: (options: BaseStateProviderContext) => T | Promise<T>,
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
      }

      const finalize = createFinalizeFn();
      return prepareCallback === undefined ? [{ finalize }] : [{ finalize }, callbackOutput];
    }) as PrepareFn<StateAdapter<BaseStateProviderContext>, BaseJobTypeDefinitions, string>;

    try {
      await handler({
        signal: abortController.signal,
        job: runningJob,
        blockers: blockers as any,
        prepare,
      });
    } catch (error) {
      await runInGuardedTransaction(async (context) =>
        helper.handleJobHandlerError({
          job,
          error,
          context,
          retryConfig,
          workerId,
        }),
      );
    } finally {
      await leaseManager.stop();
    }
  };

  const processingPromise = startProcessing(job);

  await Promise.race([firstLeaseCommitted.onSignal, processingPromise]);

  return async () => {
    claimTransactionClosed.signalOnce();
    await Promise.race([leaseErrorPromise, processingPromise]);
  };
};
