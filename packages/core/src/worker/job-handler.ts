import { CompatibleQueueTargets, FinishedJobChain, JobChain } from "../entities/job-chain.js";
import { EnqueuedJob, Job, RunningJob } from "../entities/job.js";
import { BaseQueueDefinitions } from "../entities/queue.js";
import { Branded } from "../helpers/typescript.js";
import { ProcessHelper, ResolvedQueueJobs, RetryConfig } from "../queuert-helper.js";
import { StateJob } from "../state-adapter/state-adapter.js";
import {
  BaseStateProviderContext,
  GetStateProviderContext,
  StateProvider,
} from "../state-provider/state-provider.js";

const createSignal = <T = void>() => {
  const { promise, resolve } = Promise.withResolvers<T>();
  let resolved = false;
  return {
    onSignal: promise,
    get signalled() {
      return resolved;
    },
    signalOnce: (value: T) => {
      if (!resolved) {
        resolve(value);
        resolved = true;
      }
    },
  };
};

export type JobHandler<
  TStateProvider extends StateProvider<BaseStateProviderContext>,
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof TQueueDefinitions & string,
  TDependencies extends readonly JobChain<any, any, any>[],
> = (handlerOptions: {
  claim: <T>(
    claimCallback: (
      claimCallbackOptions: {
        job: RunningJob<Job<TQueueName, TQueueDefinitions[TQueueName]["input"]>>;
        dependencies: {
          [K in keyof TDependencies]: FinishedJobChain<TDependencies[K]>;
        };
      } & GetStateProviderContext<TStateProvider>,
    ) => Promise<T>,
  ) => Promise<T>;
  process: (options: { leaseMs: number }) => Promise<void>;
  withProcess: <T>(
    cb: () => Promise<T>,
    options: { leaseMs: number; intervalMs: number },
  ) => Promise<T>;
  finalize: (
    finalizeCallback: (
      finalizeOptions: {
        job: RunningJob<Job<TQueueName, TQueueDefinitions[TQueueName]["input"]>>;
        dependencies: {
          [K in keyof TDependencies]: FinishedJobChain<TDependencies[K]>;
        };
        enqueueJob: <
          TEnqueueQueueName extends CompatibleQueueTargets<TQueueDefinitions, TQueueName> & string,
        >(
          options: {
            queueName: TEnqueueQueueName;
            input: TQueueDefinitions[TEnqueueQueueName]["input"];
          } & GetStateProviderContext<TStateProvider>,
        ) => Promise<EnqueuedJob<TEnqueueQueueName, TQueueDefinitions[TEnqueueQueueName]["input"]>>;
      } & GetStateProviderContext<TStateProvider>,
    ) => Promise<
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
  workerId: string;
}): Promise<() => Promise<void>> => {
  const firstProcessCalled = createSignal<void>();
  const claimTransactionClosed = createSignal<void>();

  const runInGuardedTransaction = async <T>(
    cb: (context: GetStateProviderContext<StateProvider<BaseStateProviderContext>>) => Promise<T>,
  ): Promise<T> => {
    if (!firstProcessCalled.signalled) {
      return cb(context);
    }

    return helper.runInTransaction(async (context) => {
      await helper.refetchJobForUpdate({
        context,
        job,
        allowEmptyWorker: !firstProcessCalled.signalled,
        workerId,
      });

      return cb(context);
    });
  };

  const commitProcess = async (leaseMs: number) => {
    await runInGuardedTransaction(async (context) => {
      await helper.commitHeartbeat({
        context,
        job,
        leaseMs,
        workerId,
      });
    });

    firstProcessCalled.signalOnce();
    await claimTransactionClosed.onSignal;
  };

  const startProcessing = async (job: StateJob) => {
    try {
      const jobInput = await helper.getJobHandlerInput({
        job,
        context,
      });
      job = { ...job, attempt: jobInput.job.attempt };

      await handler({
        claim: async (claimCallback) => {
          return await claimCallback({
            ...jobInput,
            ...context,
          });
        },
        process: async ({ leaseMs }) => commitProcess(leaseMs),
        withProcess: async (cb, options) => {
          let commitProcessPromise: Promise<void>;
          let timeout: NodeJS.Timeout;

          const sendHeartbeat = async () => {
            commitProcessPromise = commitProcess(options.leaseMs);
            await commitProcessPromise;
            timeout = setTimeout(sendHeartbeat, options.intervalMs);
          };

          await sendHeartbeat();
          return cb().finally(async () => {
            await commitProcessPromise;
            clearTimeout(timeout);
          });
        },
        finalize: async (finalizeCallback) => {
          return runInGuardedTransaction(async (context) => {
            const output = await finalizeCallback({
              ...jobInput,
              enqueueJob: async ({ queueName, input, ...context }) =>
                helper.enqueueJob({
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
            });
          });
        },
      });
    } catch (error) {
      await runInGuardedTransaction(async (context) =>
        helper.handleJobHandlerError({
          job,
          error,
          context,
          retryConfig,
        }),
      );
    }
  };

  const processingPromise = startProcessing(job);

  await Promise.any([firstProcessCalled.onSignal, processingPromise]);

  return async () => {
    claimTransactionClosed.signalOnce();
    await processingPromise;
  };
};
