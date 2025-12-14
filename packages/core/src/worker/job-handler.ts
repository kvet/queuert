import { CompatibleQueueTargets, CompletedJobChain, JobChain } from "../entities/job-chain.js";
import { EnqueuedJob, Job, RunningJob } from "../entities/job.js";
import { BaseQueueDefinitions } from "../entities/queue.js";
import { TypedAbortController, TypedAbortSignal } from "../helpers/abort.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import { createSignal } from "../helpers/signal.js";
import { Branded } from "../helpers/typescript.js";
import { LeaseExpiredError, ProcessHelper, ResolvedQueueJobs } from "../queuert-helper.js";
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
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof TQueueDefinitions & string,
> = (
  finalizeOptions: {
    continueWith: <
      TEnqueueQueueName extends CompatibleQueueTargets<TQueueDefinitions, TQueueName> & string,
    >(
      options: {
        queueName: TEnqueueQueueName;
        input: TQueueDefinitions[TEnqueueQueueName]["input"];
      } & GetStateAdapterContext<TStateAdapter>,
    ) => Promise<EnqueuedJob<TEnqueueQueueName, TQueueDefinitions[TEnqueueQueueName]["input"]>>;
  } & GetStateAdapterContext<TStateAdapter>,
) =>
  | TQueueDefinitions[TQueueName]["output"]
  | ResolvedQueueJobs<TQueueDefinitions, TQueueName>
  | Promise<
      TQueueDefinitions[TQueueName]["output"] | ResolvedQueueJobs<TQueueDefinitions, TQueueName>
    >;

export type FinalizeFn<
  TStateAdapter extends StateAdapter<BaseStateProviderContext>,
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof TQueueDefinitions & string,
> = (
  finalizeCallback: FinalizeCallback<TStateAdapter, TQueueDefinitions, TQueueName>,
) => Promise<
  Branded<
    TQueueDefinitions[TQueueName]["output"] | ResolvedQueueJobs<TQueueDefinitions, TQueueName>,
    "finalize_result"
  >
>;

export type PrepareResult<
  TStateAdapter extends StateAdapter<BaseStateProviderContext>,
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof TQueueDefinitions & string,
> = {
  finalize: FinalizeFn<TStateAdapter, TQueueDefinitions, TQueueName>;
};

export type PrepareConfig = { mode: "atomic" | "staged" };

export type PrepareCallback<TStateAdapter extends StateAdapter<BaseStateProviderContext>, T> = (
  prepareCallbackOptions: GetStateAdapterContext<TStateAdapter>,
) => T | Promise<T>;

export type PrepareFn<
  TStateAdapter extends StateAdapter<BaseStateProviderContext>,
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof TQueueDefinitions & string,
> = {
  (config: PrepareConfig): Promise<[PrepareResult<TStateAdapter, TQueueDefinitions, TQueueName>]>;
  <T>(
    config: PrepareConfig,
    prepareCallback: PrepareCallback<TStateAdapter, T>,
  ): Promise<[PrepareResult<TStateAdapter, TQueueDefinitions, TQueueName>, T]>;
};

export type JobHandler<
  TStateAdapter extends StateAdapter<BaseStateProviderContext>,
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof TQueueDefinitions & string,
  TBlockers extends readonly JobChain<any, any, any>[],
> = (handlerOptions: {
  signal: TypedAbortSignal<"lease_expired" | "error">;
  job: RunningJob<Job<TQueueName, TQueueDefinitions[TQueueName]["input"]>>;
  blockers: {
    [K in keyof TBlockers]: CompletedJobChain<TBlockers[K]>;
  };
  prepare: PrepareFn<TStateAdapter, TQueueDefinitions, TQueueName>;
}) => Promise<
  Branded<
    TQueueDefinitions[TQueueName]["output"] | ResolvedQueueJobs<TQueueDefinitions, TQueueName>,
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
  handler: JobHandler<
    StateAdapter<BaseStateProviderContext>,
    BaseQueueDefinitions,
    string,
    readonly JobChain<string, unknown, unknown>[]
  >;
  context: BaseStateProviderContext;
  job: StateJob;
  retryConfig: BackoffConfig;
  leaseConfig: LeaseConfig;
  workerId: string;
}): Promise<() => Promise<void>> => {
  const firstLeaseCommitted = createSignal<void>();
  const claimTransactionClosed = createSignal<void>();

  const abortController = new AbortController() as TypedAbortController<"lease_expired" | "error">;

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
        if (error instanceof LeaseExpiredError) {
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
    const jobInput = await helper.getJobHandlerInput({
      job,
      context,
    });
    job = { ...job, attempt: jobInput.job.attempt };

    const createFinalizeFn = () => {
      let finalizeCalled = false;
      let continueWithCalled = false;
      return async (
        finalizeCallback: (
          options: {
            continueWith: (
              options: {
                queueName: string;
                input: unknown;
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
            continueWith: async ({ queueName, input, ...context }) => {
              if (continueWithCalled) {
                throw new Error("continueWith can only be called once");
              }
              continueWithCalled = true;
              return helper.continueWith({
                queueName,
                input,
                context,
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

      const callbackOutput = await prepareCallback?.({
        ...context,
        job: jobInput.job,
        blockers: jobInput.blockers,
      });

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
    }) as PrepareFn<StateAdapter<BaseStateProviderContext>, BaseQueueDefinitions, string>;

    try {
      await handler({
        signal: abortController.signal,
        job: jobInput.job,
        blockers: jobInput.blockers,
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
