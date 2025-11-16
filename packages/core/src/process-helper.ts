import { AsyncLocalStorage } from "node:async_hooks";
import {
  BaseDbProviderContext,
  GetDbProviderContext,
  QueuertDbProvider,
} from "./db-provider/db-provider.js";
import {
  EnqueuedJob,
  enqueuedJobSymbol,
  isEnqueuedJob,
  Job,
  mapDbJobToJob,
  RunningJob,
} from "./entities/job.js";
import {
  FinishedJobChain,
  JobChain,
  mapDbJobToJobChain,
} from "./entities/job_chain.js";
import {
  BaseChainDefinitions,
  BaseQueueDefinitions,
  Notifier,
} from "./index.js";
import { Log } from "./log.js";
import { executeTypedSql } from "./sql-executor.js";
import {
  addJobDependenciesSql,
  completeJobSql,
  createJobSql,
  DbJob,
  getJobByIdSql,
  getJobChainById,
  getJobDependenciesSql,
  getJobsToProcessSql,
  getNextJobAvailableAt,
  heartbeatJobSql,
  linkJobSql,
  markJobAsPendingSql,
  markJobAsRunningSql,
  markJobAsWaitingSql,
  rescheduleJobSql,
  scheduleDependentJobsSql,
} from "./sql.js";

const notifyQueueStorage = new AsyncLocalStorage<Set<string>>();

export type ResolveQueueDefinitions<
  TChainDefinitions extends BaseChainDefinitions,
  TChainName extends keyof TChainDefinitions,
  TQueueDefinitions extends BaseQueueDefinitions
> = {
  [K in TChainName]: {
    input: TChainDefinitions[TChainName]["input"];
  };
} & {
  [K in keyof TQueueDefinitions as `${TChainName & string}:${K &
    string}`]: TQueueDefinitions[K];
};

export type ResolvedQueueJobs<
  TChainDefinitions extends BaseChainDefinitions,
  TChainName extends keyof TChainDefinitions,
  TQueueDefinitions extends BaseQueueDefinitions
> = {
  [K in keyof ResolveQueueDefinitions<
    TChainDefinitions,
    TChainName,
    TQueueDefinitions
  >]: Job<
    K,
    ResolveQueueDefinitions<
      TChainDefinitions,
      TChainName,
      TQueueDefinitions
    >[K]["input"]
  >;
}[keyof ResolveQueueDefinitions<
  TChainDefinitions,
  TChainName,
  TQueueDefinitions
>];

export type ResolveEnqueueDependencyJobChains<
  TDbProvider extends QueuertDbProvider<BaseDbProviderContext>,
  TChainDefinitions extends BaseChainDefinitions,
  TChainName extends keyof TChainDefinitions,
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof ResolveQueueDefinitions<
    TChainDefinitions,
    TChainName,
    TQueueDefinitions
  >,
  TDependencies extends readonly {
    [K in keyof TChainDefinitions]: JobChain<
      K,
      TChainDefinitions[K]["input"],
      TChainDefinitions[K]["output"]
    >;
  }[keyof TChainDefinitions][]
> = (
  enqueueDependencyJobChainsOptions: {
    job: Job<
      TQueueName,
      ResolveQueueDefinitions<
        TChainDefinitions,
        TChainName,
        TQueueDefinitions
      >[TQueueName]["input"]
    >;
  } & GetDbProviderContext<TDbProvider>
) => Promise<TDependencies>;

export class RescheduleJobError extends Error {
  public readonly afterMs: number;
  constructor(
    message: string,
    options: {
      afterMs: number;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options.cause });
    this.afterMs = options.afterMs;
  }
}

// TODO
export const rescheduleJob = (afterMs: number, cause?: unknown): never => {
  throw new RescheduleJobError(`Reschedule job after ${afterMs}ms`, {
    afterMs,
    cause,
  });
};

export const processHelper = ({
  dbProvider,
  notifier,
  log,
}: {
  dbProvider: QueuertDbProvider<BaseDbProviderContext>;
  notifier: Notifier;
  log: Log;
}) => {
  const enqueueDbJob = async ({
    queueName,
    input,
    context,
  }: {
    queueName: string;
    input: unknown;
    context: BaseDbProviderContext;
  }): Promise<DbJob> => {
    let [job] = await executeTypedSql({
      executeSql: (...args) => dbProvider.executeSql(context, ...args),
      sql: createJobSql,
      params: [queueName, input as any],
    });

    const notifyQueueSet = notifyQueueStorage.getStore();
    if (notifyQueueSet) {
      notifyQueueSet.add(queueName);
    } else {
      log({
        level: "warn",
        message: `Not withNotifier context when enqueueing job for queue. The job processing may be delayed.`,
        args: [{ queueName }],
      });
    }

    return job;
  };

  const withNotifyQueueContext = async <T, TArgs extends any[]>(
    cb: (...args: TArgs) => Promise<T>,
    ...args: TArgs
  ): Promise<T> => {
    return notifyQueueStorage.run(new Set(), async () => {
      const result = await cb(...args);

      await Promise.all(
        Array.from(notifyQueueStorage.getStore() ?? []).map((queueName) =>
          notifier.notify(queueName)
        )
      );

      return result;
    });
  };

  return {
    withNotifyQueueContext: withNotifyQueueContext as <T>(
      cb: () => Promise<T>
    ) => Promise<T>,
    runInTransaction: async <T>(
      cb: (
        context: GetDbProviderContext<QueuertDbProvider<BaseDbProviderContext>>
      ) => Promise<T>
    ): Promise<T> => {
      return dbProvider.provideContext((context) =>
        withNotifyQueueContext(() => dbProvider.runInTransaction(context, cb))
      );
    },
    scheduleDependentJobChainsSql: async ({
      job,
      enqueueDependencyJobChains,
      context,
    }: {
      job: DbJob;
      enqueueDependencyJobChains?: ResolveEnqueueDependencyJobChains<
        QueuertDbProvider<BaseDbProviderContext>,
        BaseChainDefinitions,
        string,
        BaseQueueDefinitions,
        string,
        readonly JobChain<any, any, any>[]
      >;
      context: BaseDbProviderContext;
    }): Promise<DbJob> => {
      if (job.status !== "created") {
        return job;
      }

      const dependencyJobChains = enqueueDependencyJobChains
        ? await enqueueDependencyJobChains({
            job: mapDbJobToJob(job),
            ...context,
          })
        : [];
      if (dependencyJobChains.length) {
        await executeTypedSql({
          executeSql: (...args) => dbProvider.executeSql(context, ...args),
          sql: addJobDependenciesSql,
          params: [
            Array.from({ length: dependencyJobChains.length }, () => job.id),
            dependencyJobChains.map((d) => d.id),
          ],
        });
        log({
          level: "info",
          message: "Enqueued dependent job chains",
          args: [
            {
              jobId: job.id,
              queueName: job.queue_name,
              status: job.status,
              ...(dependencyJobChains.length > 0
                ? {
                    dependencyIds: dependencyJobChains.map((d) => d.id),
                  }
                : {}),
            },
          ],
        });
      }
      const incompleteDependencies = dependencyJobChains.filter(
        (d) => d.status !== "finished"
      );
      if (incompleteDependencies.length) {
        [job] = await executeTypedSql({
          executeSql: (...args) => dbProvider.executeSql(context, ...args),
          sql: markJobAsWaitingSql,
          params: [job.id],
        });
        log({
          level: "info",
          message: "Scheduled job for later",
          args: [
            {
              jobId: job.id,
              queueName: job.queue_name,
              status: job.status,
              incompleteDependencyIds: incompleteDependencies.map((d) => d.id),
            },
          ],
        });
      } else {
        [job] = await executeTypedSql({
          executeSql: (...args) => dbProvider.executeSql(context, ...args),
          sql: markJobAsPendingSql,
          params: [job.id],
        });
      }
      return job;
    },
    getJobHandlerInput: async ({
      job,
      context,
    }: {
      job: DbJob;
      context: BaseDbProviderContext;
    }): Promise<{
      job: RunningJob<Job<any, any>>;
      dependencies: FinishedJobChain<JobChain<any, any, any>>[];
    }> => {
      const [runningJob] = await executeTypedSql({
        executeSql: (...args) => dbProvider.executeSql(context, ...args),
        sql: markJobAsRunningSql,
        params: [job.id],
      });

      const dependencies = await executeTypedSql({
        executeSql: (...args) => dbProvider.executeSql(context, ...args),
        sql: getJobDependenciesSql,
        params: [job.id],
      });

      if (dependencies.some((dep) => dep.status !== "completed")) {
        log({
          level: "error",
          message: `Job ${job.id} has unfinished or failed dependencies`,
          args: [
            {
              jobId: job.id,
              dependencyIds: dependencies.map((dep) => dep.id),
              incompleteDependencyIds: dependencies
                .filter((dep) => dep.status !== "completed")
                .map((dep) => dep.id),
            },
          ],
        });
        throw new Error("Some dependencies are not finished successfully");
      }

      return {
        job: mapDbJobToJob(runningJob) as RunningJob<Job<any, any>>,
        dependencies: dependencies.map(mapDbJobToJobChain) as FinishedJobChain<
          JobChain<any, any, any>
        >[],
      };
    },
    enqueueJobChain: async <TChainName extends string, TInput, TOutput>({
      chainName,
      input,
      context,
    }: {
      chainName: TChainName;
      input: TInput;
      context: any;
    }): Promise<JobChain<TChainName, TInput, TOutput>> => {
      // TODO: test
      await dbProvider.assertInTransaction(context);

      let job = await enqueueDbJob({
        queueName: chainName,
        input,
        context,
      });

      log({
        level: "debug",
        message: `Enqueued job chain ${chainName} with id ${job.id}`,
        args: [{ jobId: job.id, chainName, input }],
      });

      return mapDbJobToJobChain(job);
    },
    getJobChain: async <TChainName extends string, TInput, TOutput>({
      id,
      context,
    }: {
      id: string;
      context: any;
    }): Promise<JobChain<TChainName, TInput, TOutput> | null> => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => dbProvider.executeSql(context, ...args),
        sql: getJobChainById,
        params: [id],
      });

      return job ? mapDbJobToJobChain(job) : null;
    },
    // TODO: ensure only one job is enqueued per call and it should be returned
    enqueueJob: async <TQueueName extends string, TInput>({
      queueName,
      input,
      context,
    }: {
      queueName: TQueueName;
      input: TInput;
      context: any;
    }): Promise<EnqueuedJob<TQueueName, TInput>> => {
      let job = await enqueueDbJob({
        queueName,
        input,
        context,
      });

      log({
        level: "debug",
        message: `Enqueued job ${queueName} with id ${job.id}`,
        args: [{ jobId: job.id, queueName, input }],
      });

      return {
        ...mapDbJobToJob(job),
        [enqueuedJobSymbol]: true,
      };
    },
    handleJobHandlerError: async ({
      job,
      error,
      context,
      pollIntervalMs,
    }: {
      job: DbJob;
      error: unknown;
      context: BaseDbProviderContext;
      pollIntervalMs: number;
    }): Promise<void> => {
      let afterMs: number;
      let cause: unknown;
      if (error instanceof RescheduleJobError) {
        log({
          level: "warn",
          message: `Job processing failed. Rescheduling in ${error.afterMs}ms.`,
          args: [error],
        });
        afterMs = error.afterMs;
        cause = error.cause;
      } else {
        const retryAfterMs = pollIntervalMs * 100;
        log({
          level: "error",
          message: `Job processing failed unexpectedly. Rescheduling in ${retryAfterMs}ms.`,
          args: [error],
        });
        afterMs = retryAfterMs;
        cause = error;
      }
      await executeTypedSql({
        executeSql: (...args) => dbProvider.executeSql(context, ...args),
        sql: rescheduleJobSql,
        params: [job.id, afterMs, String(cause)],
      });
    },
    finishJob: async ({
      job,
      output,
      context,
    }: {
      job: DbJob;
      output: unknown;
      context: BaseDbProviderContext;
    }): Promise<void> => {
      const hasChainedJob = isEnqueuedJob(output);

      [job] = await executeTypedSql({
        executeSql: (...args) => dbProvider.executeSql(context, ...args),
        sql: completeJobSql,
        params: [job.id, hasChainedJob ? null : (output as any)],
      });

      if (hasChainedJob) {
        await executeTypedSql({
          executeSql: (...args) => dbProvider.executeSql(context, ...args),
          sql: linkJobSql,
          params: [output.id, job.chain_id],
        });
      } else {
        const scheduledJobIds = await executeTypedSql({
          executeSql: (...args) => dbProvider.executeSql(context, ...args),
          sql: scheduleDependentJobsSql,
          params: [job.chain_id],
        });

        if (scheduledJobIds.length > 0) {
          log({
            level: "info",
            message: `Scheduled dependent jobs`,
            args: [
              {
                jobId: job.id,
                queueName: job.queue_name,
                status: job.status,
                scheduledJobIds,
              },
            ],
          });
        }
      }
      log({
        level: "info",
        message: "Completed job processing",
        args: [
          {
            jobId: job.id,
            queueName: job.queue_name,
            status: job.status,
          },
        ],
      });
    },
    commitHeartbeat: async ({
      context,
      job,
      leaseMs,
      allowEmptyWorker,
      workerId,
    }: {
      context: BaseDbProviderContext;
      job: DbJob;
      leaseMs: number;
      allowEmptyWorker: boolean;
      workerId: string;
    }): Promise<DbJob> => {
      const [fetchecJob] = await executeTypedSql({
        executeSql: (...args) => dbProvider.executeSql(context, ...args),
        sql: getJobByIdSql,
        params: [job.id],
      });

      if (!fetchecJob) {
        throw new Error(`Job with id ${job.id} not found for heartbeat`);
      }

      if (
        fetchecJob.locked_by !== workerId &&
        !(allowEmptyWorker ? fetchecJob.locked_by === null : false)
      ) {
        throw new Error(
          `Job with id ${job.id} is not locked by this worker for heartbeat`
        );
      }

      return (
        await executeTypedSql({
          executeSql: (...args) => dbProvider.executeSql(context, ...args),
          sql: heartbeatJobSql,
          params: [job.id, workerId, leaseMs],
        })
      )[0];
    },
    getNextJobAvailableAt: async ({
      queueNames,
      pollIntervalMs,
    }: {
      queueNames: string[];
      pollIntervalMs: number;
    }): Promise<number> => {
      const [nextJobAvailableAt] = await dbProvider.provideContext((context) =>
        executeTypedSql({
          executeSql: (...args) => dbProvider.executeSql(context, ...args),
          sql: getNextJobAvailableAt,
          params: [queueNames],
        })
      );

      return nextJobAvailableAt
        ? Math.min(
            Math.max(
              0,
              nextJobAvailableAt.scheduled_at.getTime() -
                nextJobAvailableAt.current_time.getTime()
            ),
            pollIntervalMs
          )
        : pollIntervalMs;
    },
    getJobToProcess: async ({
      queueNames,
      context,
    }: {
      queueNames: string[];
      context: BaseDbProviderContext;
    }): Promise<DbJob | undefined> => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => dbProvider.executeSql(context, ...args),
        sql: getJobsToProcessSql,
        params: [queueNames],
      });
      return job;
    },
  };
};
export type ProcessHelper = ReturnType<typeof processHelper>;
