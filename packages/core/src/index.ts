import {
  BaseDbProviderContext,
  GetDbProviderContext,
  QueuertDbProvider,
} from "./db-provider/db-provider.js";
import { BaseChainDefinitions } from "./entities/chain.js";
import { JobChain } from "./entities/job_chain.js";
import { BaseQueueDefinitions } from "./entities/queue.js";
import { Log } from "./log.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import {
  processHelper,
  ResolveEnqueueDependencyJobChains,
  ResolveQueueDefinitions,
} from "./process-helper.js";
import { executeTypedSql } from "./sql-executor.js";
import { migrateSql, setupSql } from "./sql.js";
import {
  createExecutor,
  Executor,
  RegisteredQueues,
} from "./worker/executor.js";
import { JobHandler } from "./worker/job-handler.js";

export { type QueuertDbProvider } from "./db-provider/db-provider.js";
export {
  defineUnionChains,
  type BaseChainDefinitions,
} from "./entities/chain.js";
export { type FinishedJobChain, type JobChain } from "./entities/job_chain.js";
export {
  defineUnionQueues,
  type BaseQueueDefinitions,
} from "./entities/queue.js";
export { type Log } from "./log.js";
export { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
export { rescheduleJob } from "./process-helper.js";

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
  TDbProvider extends QueuertDbProvider<BaseDbProviderContext>,
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
      TDbProvider,
      TChainDefinitions,
      TChainName,
      TQueueDefinitions,
      TQueueName,
      TDependencies
    >;
    handler: JobHandler<
      TDbProvider,
      TChainDefinitions,
      TChainName,
      TQueueDefinitions,
      TQueueName,
      TDependencies
    >;
  }) => QueuertChainDefinition<
    TDbProvider,
    TChainDefinitions,
    TChainName,
    TQueueDefinitions
  >;
};

type QueuertWorkerDefinition<
  TDbProvider extends QueuertDbProvider<BaseDbProviderContext>,
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
        TDbProvider,
        TChainDefinitions,
        TChainName,
        TQueueDefinitions
      >
    ) => QueuertChainDefinition<
      TDbProvider,
      TChainDefinitions,
      TChainName,
      TQueueDefinitions
    >
  ) => QueuertWorkerDefinition<TDbProvider, TChainDefinitions>;
  start: Executor;
};

export type Queuert<
  TDbProvider extends QueuertDbProvider<any>,
  TChainDefinitions extends BaseChainDefinitions
> = {
  createWorker: () => QueuertWorkerDefinition<TDbProvider, TChainDefinitions>;
  enqueueJobChain: <TChainName extends keyof TChainDefinitions & string>(
    options: {
      chainName: TChainName;
      input: TChainDefinitions[TChainName]["input"];
    } & GetDbProviderContext<TDbProvider>
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
    } & GetDbProviderContext<TDbProvider>
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
  TDbProvider extends QueuertDbProvider<any>
>({
  dbProvider,
  ...context
}: {
  dbProvider: TDbProvider;
} & GetDbProviderContext<TDbProvider>): Promise<void> => {
  await executeTypedSql({
    executeSql: (...args) => dbProvider.executeSql(context, ...args),
    sql: setupSql,
  });
};

export const migrateToLatest = async <
  TDbProvider extends QueuertDbProvider<any>
>({
  dbProvider,
  ...context
}: {
  dbProvider: TDbProvider;
} & GetDbProviderContext<TDbProvider>): Promise<void> => {
  await executeTypedSql({
    executeSql: (...args) => dbProvider.executeSql(context, ...args),
    sql: migrateSql,
  });
};

export const createQueuert = async <
  TDbProvider extends QueuertDbProvider<any>,
  TChainDefinitions extends BaseChainDefinitions
>({
  dbProvider,
  notifyAdapter,
  log,
}: {
  dbProvider: TDbProvider;
  notifyAdapter: NotifyAdapter;
  chainDefinitions: TChainDefinitions;
  log: Log;
}): Promise<Queuert<TDbProvider, TChainDefinitions>> => {
  const helper = processHelper({
    dbProvider,
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
