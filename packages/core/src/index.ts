import { ResolvedJobChain } from "./entities/job-chain.js";
import { BaseQueueDefinitions } from "./entities/queue.js";
import { Log } from "./log.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { EnqueueBlockerJobChains, queuertHelper } from "./queuert-helper.js";
import {
  DeduplicationOptions,
  GetStateAdapterContext,
  StateAdapter,
} from "./state-adapter/state-adapter.js";
import { createExecutor, Executor, RegisteredQueues } from "./worker/executor.js";
import { JobHandler } from "./worker/job-handler.js";

export { type CompletedJobChain, type JobChain } from "./entities/job-chain.js";
export {
  defineUnionQueues,
  type BaseQueueDefinitions,
  type DefineQueueRef,
} from "./entities/queue.js";
export { type Log } from "./log.js";
export { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
export {
  type DeduplicationOptions,
  type DeduplicationStrategy,
} from "./state-adapter/state-adapter.js";
export { type StateProvider as QueuerTStateProvider } from "./state-provider/state-provider.js";
export { type RetryConfig } from "./helpers/retry.js";
export { rescheduleJob, type LeaseConfig } from "./worker/job-handler.js";

type QueuertWorkerDefinition<
  TStateAdapter extends StateAdapter<any>,
  TQueueDefinitions extends BaseQueueDefinitions,
> = {
  setupQueueHandler: <
    TQueueName extends keyof TQueueDefinitions & string,
    TBlockers extends readonly ResolvedJobChain<TQueueDefinitions, keyof TQueueDefinitions>[],
  >(options: {
    name: TQueueName;
    enqueueBlockerJobChains?: EnqueueBlockerJobChains<
      TStateAdapter,
      TQueueDefinitions,
      TQueueName,
      TBlockers
    >;
    handler: JobHandler<TStateAdapter, TQueueDefinitions, TQueueName, TBlockers>;
  }) => QueuertWorkerDefinition<TStateAdapter, TQueueDefinitions>;
  start: Executor;
};

export type Queuert<
  TStateAdapter extends StateAdapter<any>,
  TQueueDefinitions extends BaseQueueDefinitions,
> = {
  createWorker: () => QueuertWorkerDefinition<TStateAdapter, TQueueDefinitions>;
  enqueueJobChain: <TChainName extends keyof TQueueDefinitions & string>(
    options: {
      chainName: TChainName;
      input: TQueueDefinitions[TChainName]["input"];
      deduplication?: DeduplicationOptions;
    } & GetStateAdapterContext<TStateAdapter>,
  ) => Promise<ResolvedJobChain<TQueueDefinitions, TChainName> & { deduplicated: boolean }>;
  getJobChain: <TChainName extends keyof TQueueDefinitions & string>(
    options: {
      chainName: TChainName;
      id: string;
    } & GetStateAdapterContext<TStateAdapter>,
  ) => Promise<ResolvedJobChain<TQueueDefinitions, TChainName> | null>;
  withNotify: <T, TArgs extends any[]>(
    cb: (...args: TArgs) => Promise<T>,
    ...args: TArgs
  ) => Promise<T>;
};

export const createQueuert = async <
  TStateAdapter extends StateAdapter<any>,
  TQueueDefinitions extends BaseQueueDefinitions,
>({
  stateAdapter,
  notifyAdapter,
  log,
}: {
  stateAdapter: TStateAdapter;
  notifyAdapter: NotifyAdapter;
  queueDefinitions: TQueueDefinitions;
  log: Log;
}): Promise<Queuert<TStateAdapter, TQueueDefinitions>> => {
  const helper = queuertHelper({
    stateAdapter,
    notifyAdapter,
    log,
  });

  return {
    createWorker: () => {
      const createWorkerInstance = (
        registeredQueues: RegisteredQueues,
      ): QueuertWorkerDefinition<TStateAdapter, TQueueDefinitions> => {
        return {
          setupQueueHandler({ name: queueName, enqueueBlockerJobChains, handler }) {
            if (registeredQueues.has(queueName)) {
              throw new Error(`Queue with name "${queueName}" is already registered`);
            }
            const newRegisteredQueues = new Map(registeredQueues);
            newRegisteredQueues.set(queueName, {
              enqueueBlockerJobChains: enqueueBlockerJobChains as any,
              handler: handler as any,
            });

            return createWorkerInstance(newRegisteredQueues);
          },
          start: (startOptions) =>
            createExecutor({
              helper,
              notifyAdapter,
              log,
              registeredQueues,
            })(startOptions),
        };
      };

      return createWorkerInstance(new Map());
    },
    enqueueJobChain: async ({ input, chainName, deduplication, ...context }) =>
      helper.enqueueJobChain({
        chainName,
        input,
        context,
        deduplication,
      }),
    getJobChain: async ({ id, chainName, ...context }) =>
      helper.getJobChain({ id, chainName, context }),
    withNotify: async (cb, ...args) => {
      return helper.withNotifyQueueContext(() => cb(...args));
    },
  };
};
