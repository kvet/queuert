import { CompatibleQueueTargets, CompletedJobChain, JobChain } from "../entities/job-chain.js";
import { EnqueuedJob, Job, RunningJob } from "../entities/job.js";
import { BaseQueueDefinitions } from "../entities/queue.js";
import { TypedAbortController, TypedAbortSignal } from "../helpers/abort.js";
import { createSignal } from "../helpers/async.js";
import { Branded } from "../helpers/typescript.js";
import { LeaseExpiredError, ProcessHelper, ResolvedQueueJobs } from "../queuert-helper.js";
import { GetStateAdapterContext, StateAdapter, StateJob } from "../state-adapter/state-adapter.js";
import { BaseStateProviderContext } from "../state-provider/state-provider.js";

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

export type RetryConfig = {
  initialIntervalMs?: number;
  backoffCoefficient?: number;
  maxIntervalMs?: number;
};

const DEFAULT_RETRY_CONFIG = {
  initialIntervalMs: 1000,
  backoffCoefficient: 2.0,
  maxIntervalMs: 100 * 1000,
} satisfies RetryConfig;

export const calculateBackoffMs = (attempt: number, config: RetryConfig): number => {
  const initialIntervalMs = config.initialIntervalMs ?? DEFAULT_RETRY_CONFIG.initialIntervalMs;
  const backoffCoefficient = config.backoffCoefficient ?? DEFAULT_RETRY_CONFIG.backoffCoefficient;
  const maxIntervalMs = config.maxIntervalMs ?? DEFAULT_RETRY_CONFIG.maxIntervalMs;

  const backoffMs = initialIntervalMs * Math.pow(backoffCoefficient, attempt - 1);
  return Math.min(backoffMs, maxIntervalMs);
};

export type LeaseConfig = {
  leaseMs?: number;
  renewIntervalMs?: number;
};

const DEFAULT_LEASE_CONFIG = {
  leaseMs: 30 * 1000,
  renewIntervalMs: 15 * 1000,
} satisfies LeaseConfig;

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
  TBlockers extends readonly JobChain<any, any, any>[],
> = {
  finalize: FinalizeFn<TStateAdapter, TQueueDefinitions, TQueueName>;
  job: RunningJob<Job<TQueueName, TQueueDefinitions[TQueueName]["input"]>>;
  blockers: {
    [K in keyof TBlockers]: CompletedJobChain<TBlockers[K]>;
  };
};

export type PrepareCallback<
  TStateAdapter extends StateAdapter<BaseStateProviderContext>,
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof TQueueDefinitions & string,
  TBlockers extends readonly JobChain<any, any, any>[],
  T,
> = (
  prepareCallbackOptions: {
    job: RunningJob<Job<TQueueName, TQueueDefinitions[TQueueName]["input"]>>;
    blockers: {
      [K in keyof TBlockers]: CompletedJobChain<TBlockers[K]>;
    };
  } & GetStateAdapterContext<TStateAdapter>,
) => T | Promise<T>;

export type PrepareFn<
  TStateAdapter extends StateAdapter<BaseStateProviderContext>,
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof TQueueDefinitions & string,
  TBlockers extends readonly JobChain<any, any, any>[],
> = {
  (): Promise<[PrepareResult<TStateAdapter, TQueueDefinitions, TQueueName, TBlockers>]>;
  <T>(
    prepareCallback: PrepareCallback<TStateAdapter, TQueueDefinitions, TQueueName, TBlockers, T>,
  ): Promise<[PrepareResult<TStateAdapter, TQueueDefinitions, TQueueName, TBlockers>, T]>;
};

export type JobHandler<
  TStateAdapter extends StateAdapter<BaseStateProviderContext>,
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof TQueueDefinitions & string,
  TBlockers extends readonly JobChain<any, any, any>[],
> = (handlerOptions: {
  signal: TypedAbortSignal<"lease_expired">;
  prepareStaged: PrepareFn<TStateAdapter, TQueueDefinitions, TQueueName, TBlockers>;
  prepareAtomic: PrepareFn<TStateAdapter, TQueueDefinitions, TQueueName, TBlockers>;
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
  retryConfig: RetryConfig;
  leaseConfig: LeaseConfig;
  workerId: string;
}): Promise<() => Promise<void>> => {
  const firstLeaseCommitted = createSignal<void>();
  const claimTransactionClosed = createSignal<void>();

  const abortController = new AbortController() as TypedAbortController<"lease_expired">;

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

  const commitLease = async (leaseMs: number) => {
    await runInGuardedTransaction(async (context) => {
      await helper.renewJobLease({
        context,
        job,
        leaseMs,
        workerId,
      });
    });

    firstLeaseCommitted.signalOnce();
    await claimTransactionClosed.onSignal;
  };

  const withLease = ((): {
    start: () => Promise<void>;
    stop: () => Promise<void>;
  } => {
    let stopped = false;
    let commitLeasePromise: Promise<void>;
    let timeout: NodeJS.Timeout;

    const renewLease = async () => {
      if (stopped) {
        return;
      }
      commitLeasePromise = commitLease(leaseConfig.leaseMs ?? DEFAULT_LEASE_CONFIG.leaseMs).catch(
        (error) => {
          if (error instanceof LeaseExpiredError) {
            return;
          }
          throw error;
        },
      );
      await commitLeasePromise;
      if (stopped) {
        return;
      }
      timeout = setTimeout(
        renewLease,
        leaseConfig.renewIntervalMs ?? DEFAULT_LEASE_CONFIG.renewIntervalMs,
      );
    };

    return {
      start: async () => {
        await renewLease();
      },
      stop: async () => {
        stopped = true;
        clearTimeout(timeout);
        await commitLeasePromise;
      },
    };
  })();

  const startProcessing = async (job: StateJob) => {
    try {
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
          await withLease.stop();
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
      const createPrepareFn = (startLease: boolean) =>
        (async <T>(
          prepareCallback?: (
            options: {
              job: RunningJob<Job<string, unknown>>;
              blockers: readonly CompletedJobChain<JobChain<string, unknown, unknown>>[];
            } & BaseStateProviderContext,
          ) => T | Promise<T>,
        ) => {
          if (prepareCalled) {
            throw new Error("Prepare can only be called once");
          }
          prepareCalled = true;
          const output = prepareCallback
            ? await prepareCallback({
                ...context,
                job: jobInput.job,
                blockers: jobInput.blockers,
              })
            : undefined;
          if (startLease) {
            await withLease.start();
          }
          const finalize = createFinalizeFn();
          const result = { finalize, job: jobInput.job, blockers: jobInput.blockers };
          return (output === undefined ? [result] : [result, output]) as T extends undefined
            ? [typeof result]
            : [typeof result, T];
        }) as PrepareFn<
          StateAdapter<BaseStateProviderContext>,
          BaseQueueDefinitions,
          string,
          readonly JobChain<string, unknown, unknown>[]
        >;

      try {
        await handler({
          signal: abortController.signal,
          prepareStaged: createPrepareFn(true),
          prepareAtomic: createPrepareFn(false),
        });
      } finally {
        await withLease.stop();
      }
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
    }
  };

  const processingPromise = startProcessing(job);

  await Promise.any([firstLeaseCommitted.onSignal, processingPromise]);

  return async () => {
    claimTransactionClosed.signalOnce();
    await processingPromise;
  };
};
