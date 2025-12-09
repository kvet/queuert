import { ResolvedJobChain } from "./entities/job-chain.js";
import { BaseQueueDefinitions } from "./entities/queue.js";
import { Log } from "./log.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { EnqueueBlockerJobChains, queuertHelper } from "./queuert-helper.js";
import { StateAdapter } from "./state-adapter/state-adapter.js";
import { migrateSql, setupSql } from "./state-adapter/state-adapter.pg/sql.js";
import { executeTypedSql } from "./state-adapter/state-adapter.pg/typed-sql.js";
import {
  BaseStateProviderContext,
  GetStateProviderContext,
  StateProvider,
} from "./state-provider/state-provider.js";
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
export { type StateProvider as QueuerTStateProvider } from "./state-provider/state-provider.js";
export { rescheduleJob, type LeaseConfig, type RetryConfig } from "./worker/job-handler.js";

type QueuertWorkerDefinition<
  TStateProvider extends StateProvider<BaseStateProviderContext>,
  TQueueDefinitions extends BaseQueueDefinitions,
> = {
  setupQueueHandler: <
    TQueueName extends keyof TQueueDefinitions & string,
    TBlockers extends readonly ResolvedJobChain<TQueueDefinitions, keyof TQueueDefinitions>[],
  >(options: {
    name: TQueueName;
    enqueueBlockerJobChains?: EnqueueBlockerJobChains<
      TStateProvider,
      TQueueDefinitions,
      TQueueName,
      TBlockers
    >;
    handler: JobHandler<TStateProvider, TQueueDefinitions, TQueueName, TBlockers>;
  }) => QueuertWorkerDefinition<TStateProvider, TQueueDefinitions>;
  start: Executor;
};

export type Queuert<
  TStateProvider extends StateProvider<any>,
  TQueueDefinitions extends BaseQueueDefinitions,
> = {
  createWorker: () => QueuertWorkerDefinition<TStateProvider, TQueueDefinitions>;
  enqueueJobChain: <TChainName extends keyof TQueueDefinitions & string>(
    options: {
      chainName: TChainName;
      input: TQueueDefinitions[TChainName]["input"];
    } & GetStateProviderContext<TStateProvider>,
  ) => Promise<ResolvedJobChain<TQueueDefinitions, TChainName>>;
  getJobChain: <TChainName extends keyof TQueueDefinitions & string>(
    options: {
      name: TChainName;
      id: string;
    } & GetStateProviderContext<TStateProvider>,
  ) => Promise<ResolvedJobChain<TQueueDefinitions, TChainName> | null>;
  withNotify: <T, TArgs extends any[]>(
    cb: (...args: TArgs) => Promise<T>,
    ...args: TArgs
  ) => Promise<T>;
};

export const prepareQueuertSchema = async <TStateProvider extends StateProvider<any>>({
  stateProvider,
  ...context
}: {
  stateProvider: TStateProvider;
} & GetStateProviderContext<TStateProvider>): Promise<void> => {
  await executeTypedSql({
    executeSql: (...args) => stateProvider.executeSql(context, ...args),
    sql: setupSql,
  });
};

export const migrateToLatest = async <TStateProvider extends StateProvider<any>>({
  stateProvider,
  ...context
}: {
  stateProvider: TStateProvider;
} & GetStateProviderContext<TStateProvider>): Promise<void> => {
  await executeTypedSql({
    executeSql: (...args) => stateProvider.executeSql(context, ...args),
    sql: migrateSql,
  });
};

export const createQueuert = async <
  TStateProvider extends StateProvider<any>,
  TQueueDefinitions extends BaseQueueDefinitions,
>({
  stateProvider,
  stateAdapter,
  notifyAdapter,
  log,
}: {
  stateProvider: TStateProvider;
  stateAdapter: StateAdapter;
  notifyAdapter: NotifyAdapter;
  queueDefinitions: TQueueDefinitions;
  log: Log;
}): Promise<Queuert<TStateProvider, TQueueDefinitions>> => {
  const helper = queuertHelper({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    log,
  });

  return {
    createWorker: () => {
      const createWorkerInstance = (
        registeredQueues: RegisteredQueues,
      ): QueuertWorkerDefinition<TStateProvider, TQueueDefinitions> => {
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
    enqueueJobChain: async ({ input, chainName, ...context }) =>
      helper.enqueueJobChain({
        chainName,
        input,
        context,
      }),
    getJobChain: async ({ id, chainName, ...context }) =>
      helper.getJobChain({ id, chainName, context }),
    withNotify: async (cb, ...args) => {
      return helper.withNotifyQueueContext(() => cb(...args));
    },
  };
};
