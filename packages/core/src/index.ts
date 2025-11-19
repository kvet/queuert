import { BaseChainDefinitions } from "./entities/chain.js";
import { JobChain } from "./entities/job-chain.js";
import { BaseQueueDefinitions } from "./entities/queue.js";
import { Log } from "./log.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import {
  queuertHelper,
  ResolveEnqueueDependencyJobChains,
  ResolveQueueDefinitions,
} from "./queuert-helper.js";
import { StateAdapter } from "./state-adapter/state-adapter.js";
import { migrateSql, setupSql } from "./state-adapter/state-adapter.pg/sql.js";
import { executeTypedSql } from "./state-adapter/state-adapter.pg/typed-sql.js";
import {
  BaseStateProviderContext,
  GetStateProviderContext,
  StateProvider,
} from "./state-provider/state-provider.js";
import {
  createExecutor,
  Executor,
  RegisteredQueues,
} from "./worker/executor.js";
import { JobHandler } from "./worker/job-handler.js";

export {
  defineUnionChains,
  type BaseChainDefinitions,
} from "./entities/chain.js";
export { type FinishedJobChain, type JobChain } from "./entities/job-chain.js";
export {
  defineUnionQueues,
  type BaseQueueDefinitions,
} from "./entities/queue.js";
export { type Log } from "./log.js";
export { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
export { rescheduleJob } from "./queuert-helper.js";
export { type StateProvider as QueuerTStateProvider } from "./state-provider/state-provider.js";

// DOCS:
// Queue → QueueJob → enqueueJob() → getJob()
// Chain → JobChain → enqueueJobChain() → getJobChain()

// TODO: reaper
// TODO: abort signal
// TODO: custom ids
// TODO: custom schema name
// TODO: partitioning
// TODO: notify about long transactions
// TODO: redis NotifyAdapter
// TODO: termination
// TODO: cancellation
// TODO: deduplication
// TODO: singletons/concurrency limit

type QueuertChainDefinition<
  TStateProvider extends StateProvider<BaseStateProviderContext>,
  TChainDefinitions extends BaseChainDefinitions,
  TChainName extends keyof TChainDefinitions & string,
  TQueueDefinitions extends BaseQueueDefinitions = {}
> = {
  createQueue: <
    TQueueName extends keyof ResolveQueueDefinitions<
      TChainDefinitions,
      TChainName,
      TQueueDefinitions
    > &
      string,
    TDependencies extends readonly {
      [K in keyof TChainDefinitions]: JobChain<
        K,
        TChainDefinitions[K]["input"],
        TChainDefinitions[K]["output"]
      >;
    }[keyof TChainDefinitions][]
  >(options: {
    name: TQueueName;
    enqueueDependencyJobChains?: ResolveEnqueueDependencyJobChains<
      TStateProvider,
      TChainDefinitions,
      TChainName,
      TQueueDefinitions,
      TQueueName,
      TDependencies
    >;
    handler: JobHandler<
      TStateProvider,
      TChainDefinitions,
      TChainName,
      TQueueDefinitions,
      TQueueName,
      TDependencies
    >;
  }) => QueuertChainDefinition<
    TStateProvider,
    TChainDefinitions,
    TChainName,
    TQueueDefinitions
  >;
};

type QueuertWorkerDefinition<
  TStateProvider extends StateProvider<BaseStateProviderContext>,
  TChainDefinitions extends BaseChainDefinitions
> = {
  createChain: <
    TChainName extends keyof TChainDefinitions & string,
    TQueueDefinitions extends BaseQueueDefinitions = {}
  >(
    options: {
      name: TChainName;
      queueDefinitions?: TQueueDefinitions;
    },
    createChainCallback: (
      chainDefinition: QueuertChainDefinition<
        TStateProvider,
        TChainDefinitions,
        TChainName,
        TQueueDefinitions
      >
    ) => QueuertChainDefinition<
      TStateProvider,
      TChainDefinitions,
      TChainName,
      TQueueDefinitions
    >
  ) => QueuertWorkerDefinition<TStateProvider, TChainDefinitions>;
  start: Executor;
};

export type Queuert<
  TStateProvider extends StateProvider<any>,
  TChainDefinitions extends BaseChainDefinitions
> = {
  createWorker: () => QueuertWorkerDefinition<
    TStateProvider,
    TChainDefinitions
  >;
  enqueueJobChain: <TChainName extends keyof TChainDefinitions & string>(
    options: {
      chainName: TChainName;
      input: TChainDefinitions[TChainName]["input"];
    } & GetStateProviderContext<TStateProvider>
  ) => Promise<
    JobChain<
      TChainName,
      TChainDefinitions[TChainName]["input"],
      TChainDefinitions[TChainName]["output"]
    >
  >;
  getJobChain: <TChainName extends keyof TChainDefinitions & string>(
    options: {
      name: TChainName;
      id: string;
    } & GetStateProviderContext<TStateProvider>
  ) => Promise<JobChain<
    TChainName,
    TChainDefinitions[TChainName]["input"],
    TChainDefinitions[TChainName]["output"]
  > | null>;
  withNotify: <T, TArgs extends any[]>(
    cb: (...args: TArgs) => Promise<T>,
    ...args: TArgs
  ) => Promise<T>;
};

export const prepareQueuertSchema = async <
  TStateProvider extends StateProvider<any>
>({
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

export const migrateToLatest = async <
  TStateProvider extends StateProvider<any>
>({
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
  TChainDefinitions extends BaseChainDefinitions
>({
  stateProvider,
  stateAdapter,
  notifyAdapter,
  log,
}: {
  stateProvider: TStateProvider;
  stateAdapter: StateAdapter;
  notifyAdapter: NotifyAdapter;
  chainDefinitions: TChainDefinitions;
  log: Log;
}): Promise<Queuert<TStateProvider, TChainDefinitions>> => {
  const helper = queuertHelper({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    log,
  });

  return {
    createWorker: () => {
      const registeredQueues: RegisteredQueues = new Map();

      return {
        createChain(_, defineChainCallback) {
          defineChainCallback({
            createQueue({
              name: queueName,
              enqueueDependencyJobChains,
              handler,
            }) {
              if (registeredQueues.has(queueName)) {
                throw new Error(
                  `Queue with name "${queueName}" is already registered`
                );
              }
              registeredQueues.set(queueName, {
                enqueueDependencyJobChains: enqueueDependencyJobChains as any,
                handler: handler as any,
              });

              // TODO: rework
              return this;
            },
          });

          // TODO: rework
          return this;
        },
        start: (startOptions) =>
          createExecutor({
            helper,
            notifyAdapter,
            log,
            registeredQueues,
          })(startOptions),
      };
    },
    enqueueJobChain: async ({ input, chainName, ...context }) =>
      helper.enqueueJobChain({
        chainName,
        input,
        context,
      }),
    getJobChain: async ({ id, ...context }) =>
      helper.getJobChain({ id, context }),
    withNotify: async (cb, ...args) => {
      return helper.withNotifyQueueContext(() => cb(...args));
    },
  };
};
