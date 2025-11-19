import { AsyncLocalStorage } from "node:async_hooks";
import {
  FinishedJobChain,
  JobChain,
  mapStateJobChainToJobChain,
} from "./entities/job-chain.js";
import {
  EnqueuedJob,
  enqueuedJobSymbol,
  isEnqueuedJob,
  Job,
  mapStateJobToJob,
  RunningJob,
} from "./entities/job.js";
import { BaseChainDefinitions, BaseQueueDefinitions } from "./index.js";
import { Log } from "./log.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { StateAdapter, StateJob } from "./state-adapter/state-adapter.js";
import {
  BaseStateProviderContext,
  GetStateProviderContext,
  StateProvider,
} from "./state-provider/state-provider.js";

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
  TStateProvider extends StateProvider<BaseStateProviderContext>,
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
  } & GetStateProviderContext<TStateProvider>
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

export const queuertHelper = ({
  stateProvider,
  stateAdapter,
  notifyAdapter,
  log,
}: {
  stateProvider: StateProvider<BaseStateProviderContext>;
  stateAdapter: StateAdapter;
  notifyAdapter: NotifyAdapter;
  log: Log;
}) => {
  const enqueueStateJob = async ({
    queueName,
    input,
    context,
  }: {
    queueName: string;
    input: unknown;
    context: BaseStateProviderContext;
  }): Promise<StateJob> => {
    const job = await stateAdapter.createJob({
      context,
      queueName,
      input,
    });

    const notifyQueueSet = notifyQueueStorage.getStore();
    if (notifyQueueSet) {
      notifyQueueSet.add(queueName);
    } else {
      log({
        level: "warn",
        message: `Not withNotify context when enqueueing job for queue. The job processing may be delayed.`,
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
          notifyAdapter.notifyJobScheduled(queueName)
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
        context: GetStateProviderContext<
          StateProvider<BaseStateProviderContext>
        >
      ) => Promise<T>
    ): Promise<T> => {
      return stateProvider.provideContext((context) =>
        withNotifyQueueContext(() =>
          stateProvider.runInTransaction(context, cb)
        )
      );
    },
    scheduleDependentJobChains: async ({
      job,
      enqueueDependencyJobChains,
      context,
    }: {
      job: StateJob;
      enqueueDependencyJobChains?: ResolveEnqueueDependencyJobChains<
        StateProvider<BaseStateProviderContext>,
        BaseChainDefinitions,
        string,
        BaseQueueDefinitions,
        string,
        readonly JobChain<any, any, any>[]
      >;
      context: BaseStateProviderContext;
    }): Promise<StateJob> => {
      if (job.status !== "created") {
        return job;
      }

      const dependencyJobChains = enqueueDependencyJobChains
        ? await enqueueDependencyJobChains({
            job: mapStateJobToJob(job),
            ...context,
          })
        : [];
      if (dependencyJobChains.length) {
        await stateAdapter.addJobDependencies({
          context,
          jobId: job.id,
          dependsOnChainIds: dependencyJobChains.map((d) => d.id),
        });
        log({
          level: "info",
          message: "Enqueued dependent job chains",
          args: [
            {
              jobId: job.id,
              queueName: job.queueName,
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
        job = await stateAdapter.markJob({
          context,
          jobId: job.id,
          status: "waiting",
        });
        log({
          level: "info",
          message: "Scheduled job for later",
          args: [
            {
              jobId: job.id,
              queueName: job.queueName,
              status: job.status,
              incompleteDependencyIds: incompleteDependencies.map((d) => d.id),
            },
          ],
        });
      } else {
        job = await stateAdapter.markJob({
          context,
          jobId: job.id,
          status: "pending",
        });
      }
      return job;
    },
    getJobHandlerInput: async ({
      job,
      context,
    }: {
      job: StateJob;
      context: BaseStateProviderContext;
    }): Promise<{
      job: RunningJob<Job<any, any>>;
      dependencies: FinishedJobChain<JobChain<any, any, any>>[];
    }> => {
      const runningJob = await stateAdapter.markJob({
        context,
        jobId: job.id,
        status: "running",
      });

      const dependencies = await stateAdapter.getJobDependencies({
        context,
        jobId: job.id,
      });

      if (dependencies.some((dep) => dep[1]?.status !== "completed")) {
        log({
          level: "error",
          message: `Job ${job.id} has unfinished or failed dependencies`,
          args: [
            {
              jobId: job.id,
              dependencyIds: dependencies.map((dep) => dep[0]?.id),
              incompleteDependencyIds: dependencies
                .filter((dep) => dep[1]?.status !== "completed")
                .map((dep) => dep[0]?.id),
            },
          ],
        });
        throw new Error("Some dependencies are not finished successfully");
      }

      return {
        job: mapStateJobToJob(runningJob) as RunningJob<Job<any, any>>,
        dependencies: dependencies.map(
          mapStateJobChainToJobChain
        ) as FinishedJobChain<JobChain<any, any, any>>[],
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
      await stateProvider.assertInTransaction(context);

      const job = await enqueueStateJob({
        queueName: chainName,
        input,
        context,
      });

      log({
        level: "debug",
        message: `Enqueued job chain ${chainName} with id ${job.id}`,
        args: [{ jobId: job.id, chainName, input }],
      });

      return mapStateJobChainToJobChain([job, undefined]);
    },
    getJobChain: async <TChainName extends string, TInput, TOutput>({
      id,
      context,
    }: {
      id: string;
      context: any;
    }): Promise<JobChain<TChainName, TInput, TOutput> | null> => {
      const jobChain = await stateAdapter.getJobChainById({
        context,
        jobId: id,
      });

      return jobChain ? mapStateJobChainToJobChain(jobChain) : null;
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
      let job = await enqueueStateJob({
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
        ...mapStateJobToJob(job),
        [enqueuedJobSymbol]: true,
      };
    },
    handleJobHandlerError: async ({
      job,
      error,
      context,
      pollIntervalMs,
    }: {
      job: StateJob;
      error: unknown;
      context: BaseStateProviderContext;
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

      await stateAdapter.rescheduleJob({
        context,
        jobId: job.id,
        afterMs,
        error: String(cause),
      });
    },
    finishJob: async ({
      job,
      output,
      context,
    }: {
      job: StateJob;
      output: unknown;
      context: BaseStateProviderContext;
    }): Promise<void> => {
      const hasChainedJob = isEnqueuedJob(output);

      job = await stateAdapter.completeJob({
        context,
        jobId: job.id,
        output: hasChainedJob ? null : output,
      });

      if (hasChainedJob) {
        await stateAdapter.linkJob({
          context,
          jobId: output.id,
          chainId: job.chainId,
        });
      } else {
        const scheduledJobIds = await stateAdapter.scheduleDependentJobs({
          context,
          dependsOnChainId: job.chainId!,
        });

        if (scheduledJobIds.length > 0) {
          log({
            level: "info",
            message: `Scheduled dependent jobs`,
            args: [
              {
                jobId: job.id,
                queueName: job.queueName,
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
            queueName: job.queueName,
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
      context: BaseStateProviderContext;
      job: StateJob;
      leaseMs: number;
      allowEmptyWorker: boolean;
      workerId: string;
    }): Promise<StateJob> => {
      const fetchedJob = await stateAdapter.getJobById({
        context,
        jobId: job.id,
      });

      if (!fetchedJob) {
        throw new Error(`Job with id ${job.id} not found for heartbeat`);
      }

      if (
        fetchedJob.lockedBy !== workerId &&
        !(allowEmptyWorker ? fetchedJob.lockedBy === null : false)
      ) {
        throw new Error(
          `Job with id ${job.id} is not locked by this worker for heartbeat`
        );
      }

      return stateAdapter.sendHeartbeat({
        context,
        jobId: job.id,
        workerId,
        lockDurationMs: leaseMs,
      });
    },
    getNextJobAvailableInMs: async ({
      queueNames,
      pollIntervalMs,
    }: {
      queueNames: string[];
      pollIntervalMs: number;
    }): Promise<number> => {
      const nextJobAvailableInMs = await stateProvider.provideContext(
        (context) =>
          stateAdapter.getNextJobAvailableInMs({
            context,
            queueNames,
          })
      );

      return nextJobAvailableInMs
        ? Math.min(Math.max(0, nextJobAvailableInMs), pollIntervalMs)
        : pollIntervalMs;
    },
    acquireJob: async ({
      queueNames,
      context,
    }: {
      queueNames: string[];
      context: BaseStateProviderContext;
    }): Promise<StateJob | undefined> =>
      stateAdapter.acquireJob({
        context,
        queueNames,
      }),
  };
};
export type ProcessHelper = ReturnType<typeof queuertHelper>;
