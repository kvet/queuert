import { CompatibleQueueTargets, CompletedJobChain, JobChain } from "../entities/job-chain.js";
import { EnqueuedJob, Job, RunningJob } from "../entities/job.js";
import { BaseQueueDefinitions } from "../entities/queue.js";
import { TypedAbortController, TypedAbortSignal } from "../helpers/abort.js";
import { createSignal } from "../helpers/async.js";
import { Branded } from "../helpers/typescript.js";
import { LeaseExpiredError, ProcessHelper, ResolvedQueueJobs } from "../queuert-helper.js";
import { StateJob } from "../state-adapter/state-adapter.js";
import {
  BaseStateProviderContext,
  GetStateProviderContext,
  StateProvider,
} from "../state-provider/state-provider.js";

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

export type JobHandler<
  TStateProvider extends StateProvider<BaseStateProviderContext>,
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof TQueueDefinitions & string,
  TBlockers extends readonly JobChain<any, any, any>[],
> = (handlerOptions: {
  job: RunningJob<Job<TQueueName, TQueueDefinitions[TQueueName]["input"]>>;
  blockers: {
    [K in keyof TBlockers]: CompletedJobChain<TBlockers[K]>;
  };
  signal: TypedAbortSignal<"lease_expired">;
  claim: <T>(
    claimCallback: (
      claimCallbackOptions: {
        // empty
      } & GetStateProviderContext<TStateProvider>,
    ) => T | Promise<T>,
  ) => Promise<T>;
  finalize: (
    finalizeCallback: (
      finalizeOptions: {
        continueWith: <
          TEnqueueQueueName extends CompatibleQueueTargets<TQueueDefinitions, TQueueName> & string,
        >(
          options: {
            queueName: TEnqueueQueueName;
            input: TQueueDefinitions[TEnqueueQueueName]["input"];
          } & GetStateProviderContext<TStateProvider>,
        ) => Promise<EnqueuedJob<TEnqueueQueueName, TQueueDefinitions[TEnqueueQueueName]["input"]>>;
      } & GetStateProviderContext<TStateProvider>,
    ) =>
      | TQueueDefinitions[TQueueName]["output"]
      | ResolvedQueueJobs<TQueueDefinitions, TQueueName>
      | Promise<
          TQueueDefinitions[TQueueName]["output"] | ResolvedQueueJobs<TQueueDefinitions, TQueueName>
        >,
  ) => Promise<
    Branded<
      TQueueDefinitions[TQueueName]["output"] | ResolvedQueueJobs<TQueueDefinitions, TQueueName>,
      "finalize_result"
    >
  >;
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
    StateProvider<BaseStateProviderContext>,
    BaseQueueDefinitions,
    string,
    readonly JobChain<string, unknown, unknown>[]
  >;
  context: GetStateProviderContext<StateProvider<BaseStateProviderContext>>;
  job: StateJob;
  retryConfig: RetryConfig;
  leaseConfig: LeaseConfig;
  workerId: string;
}): Promise<() => Promise<void>> => {
  const firstLeaseCommitted = createSignal<void>();
  const claimTransactionClosed = createSignal<void>();

  const abortController = new AbortController() as TypedAbortController<"lease_expired">;

  const runInGuardedTransaction = async <T>(
    cb: (context: GetStateProviderContext<StateProvider<BaseStateProviderContext>>) => Promise<T>,
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

  const withLock = ((): {
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

      try {
        await handler({
          ...jobInput,
          signal: abortController.signal,
          claim: async (claimCallback) => {
            const output = await claimCallback({
              ...context,
            });
            await withLock.start();
            return output;
          },
          finalize: async (finalizeCallback) => {
            await withLock.stop();
            return runInGuardedTransaction(async (context) => {
              const output = await finalizeCallback({
                continueWith: async ({ queueName, input, ...context }) =>
                  helper.continueWith({
                    queueName,
                    input,
                    context,
                  }),
                ...context,
              });
              await helper.finishJob({
                job,
                output,
                context,
                workerId,
              });
            });
          },
        });
      } finally {
        await withLock.stop();
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
