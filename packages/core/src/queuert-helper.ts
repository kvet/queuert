import { AsyncLocalStorage } from "node:async_hooks";
import {
  CompatibleQueueTargets,
  CompletedJobChain,
  JobChain,
  mapStateJobPairToJobChain,
  ResolvedJobChain,
} from "./entities/job-chain.js";
import {
  EnqueuedJob,
  enqueuedJobSymbol,
  isEnqueuedJob,
  Job,
  mapStateJobToJob,
  RunningJob,
} from "./entities/job.js";
import { BaseQueueDefinitions } from "./index.js";
import { Log } from "./log.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { StateAdapter, StateJob } from "./state-adapter/state-adapter.js";
import {
  BaseStateProviderContext,
  GetStateProviderContext,
  StateProvider,
} from "./state-provider/state-provider.js";
import { calculateBackoffMs, RescheduleJobError, RetryConfig } from "./worker/job-handler.js";

const notifyQueueStorage = new AsyncLocalStorage<Set<string>>();
const jobContextStorage = new AsyncLocalStorage<{
  originId: string;
  chainId: string;
  rootId: string;
}>();

export class LeaseExpiredError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export type ResolvedQueueJobs<
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof TQueueDefinitions & string,
> = {
  [K in CompatibleQueueTargets<TQueueDefinitions, TQueueName>]: Job<
    K,
    TQueueDefinitions[K]["input"]
  >;
}[CompatibleQueueTargets<TQueueDefinitions, TQueueName>];

export type EnqueueBlockerJobChains<
  TStateProvider extends StateProvider<BaseStateProviderContext>,
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof TQueueDefinitions & string,
  TBlockers extends readonly {
    [K in keyof TQueueDefinitions]: ResolvedJobChain<TQueueDefinitions, K>;
  }[keyof TQueueDefinitions][],
> = (
  enqueueBlockerJobChainsOptions: {
    job: Job<TQueueName, TQueueDefinitions[TQueueName]["input"]>;
  } & GetStateProviderContext<TStateProvider>,
) => Promise<TBlockers>;

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
    isChain,
  }: {
    queueName: string;
    input: unknown;
    context: BaseStateProviderContext;
    isChain: boolean;
  }): Promise<StateJob> => {
    const jobContext = jobContextStorage.getStore();
    const job = await stateAdapter.createJob({
      context,
      queueName,
      input,
      originId: jobContext?.originId,
      chainId: isChain ? undefined : jobContext?.chainId,
      rootId: jobContext?.rootId,
    });

    if (isChain) {
      log({
        type: "job_chain_created",
        level: "info",
        message: "Job chain created",
        args: [
          {
            chainName: job.queueName,
            chainId: job.chainId,
            originId: job.originId,
            rootId: job.rootId,
            input,
          },
        ],
      });
    }

    log({
      type: "job_created",
      level: "info",
      message: "Job created",
      args: [
        {
          jobId: job.id,
          queueName: job.queueName,
          originId: job.originId,
          chainId: job.chainId,
          rootId: job.rootId,
          input,
        },
      ],
    });

    const notifyQueueSet = notifyQueueStorage.getStore();
    if (notifyQueueSet) {
      notifyQueueSet.add(queueName);
    } else {
      log({
        type: "notify_context_absence",
        level: "warn",
        message:
          "Not withNotify context when enqueueing job for queue. The job processing may be delayed.",
        args: [
          {
            jobId: job.id,
            queueName: job.queueName,
            chainId: job.chainId,
            rootId: job.rootId,
            originId: job.originId,
          },
        ],
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
          notifyAdapter.notifyJobScheduled(queueName),
        ),
      );

      return result;
    });
  };

  return {
    withNotifyQueueContext: withNotifyQueueContext as <T>(cb: () => Promise<T>) => Promise<T>,
    withJobContext: async <T>(
      context: { originId: string; chainId: string; rootId: string },
      cb: () => Promise<T>,
    ): Promise<T> => {
      return jobContextStorage.run(context, cb);
    },
    runInTransaction: async <T>(
      cb: (context: GetStateProviderContext<StateProvider<BaseStateProviderContext>>) => Promise<T>,
    ): Promise<T> => {
      return stateProvider.provideContext((context) =>
        withNotifyQueueContext(() => stateProvider.runInTransaction(context, cb)),
      );
    },
    scheduleBlockerJobChains: async ({
      job,
      enqueueBlockerJobChains,
      context,
    }: {
      job: StateJob;
      enqueueBlockerJobChains?: EnqueueBlockerJobChains<
        StateProvider<BaseStateProviderContext>,
        BaseQueueDefinitions,
        string,
        readonly JobChain<any, any, any>[]
      >;
      context: BaseStateProviderContext;
    }): Promise<StateJob> => {
      if (job.status !== "created") {
        return job;
      }

      const blockerJobChains = enqueueBlockerJobChains
        ? await enqueueBlockerJobChains({
            job: mapStateJobToJob(job),
            ...context,
          })
        : [];
      if (blockerJobChains.length) {
        await stateAdapter.addJobBlockers({
          context,
          jobId: job.id,
          blockedByChainIds: blockerJobChains.map((b: JobChain<any, any, any>) => b.id),
        });
        log({
          type: "job_blockers_added",
          level: "info",
          message: "Job blockers added",
          args: [
            {
              jobId: job.id,
              queueName: job.queueName,
              status: job.status,
              attempt: job.attempt,
              originId: job.originId,
              chainId: job.chainId,
              rootId: job.rootId,
              blockers: blockerJobChains.map((b: JobChain<any, any, any>) => ({
                chainId: b.id,
                chainName: b.chainName,
                rootId: b.rootId,
                originId: b.originId,
              })),
            },
          ],
        });
      }
      const incompleteBlockers = blockerJobChains.filter(
        (b: JobChain<any, any, any>) => b.status !== "completed",
      );
      if (incompleteBlockers.length) {
        job = await stateAdapter.markJobAsWaiting({
          context,
          jobId: job.id,
        });
        log({
          type: "job_blocked",
          level: "info",
          message: "Job is blocked",
          args: [
            {
              jobId: job.id,
              queueName: job.queueName,
              status: job.status,
              attempt: job.attempt,
              originId: job.originId,
              chainId: job.chainId,
              rootId: job.rootId,
              incompleteBlockers: incompleteBlockers.map((b: JobChain<any, any, any>) => ({
                chainId: b.id,
                chainName: b.chainName,
                rootId: b.rootId,
                originId: b.originId,
              })),
            },
          ],
        });
      } else {
        job = await stateAdapter.markJobAsPending({
          context,
          jobId: job.id,
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
      blockers: CompletedJobChain<JobChain<any, any, any>>[];
    }> => {
      const runningJob = await stateAdapter.startJobAttempt({
        context,
        jobId: job.id,
      });

      const blockers = await stateAdapter.getJobBlockers({
        context,
        jobId: job.id,
      });

      if (blockers.some((blocker) => blocker[1]?.status !== "completed")) {
        throw new Error("Some blockers are not completed", {
          cause: {
            jobId: job.id,
            blockerIds: blockers.map((blocker) => blocker[0]?.id),
            incompleteBlockerIds: blockers
              .filter((blocker) => blocker[1]?.status !== "completed")
              .map((blocker) => blocker[0]?.id),
          },
        });
      }

      return {
        job: mapStateJobToJob(runningJob) as RunningJob<Job<any, any>>,
        blockers: blockers.map(mapStateJobPairToJobChain) as CompletedJobChain<
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
      await stateProvider.assertInTransaction(context);

      const job = await enqueueStateJob({
        queueName: chainName,
        input,
        context,
        isChain: true,
      });

      return mapStateJobPairToJobChain([job, undefined]);
    },
    getJobChain: async <TChainName extends string, TInput, TOutput>({
      id,
      context,
    }: {
      id: string;
      chainName: TChainName;
      context: any;
    }): Promise<JobChain<TChainName, TInput, TOutput> | null> => {
      const jobChain = await stateAdapter.getJobChainById({
        context,
        jobId: id,
      });

      return jobChain ? mapStateJobPairToJobChain(jobChain) : null;
    },
    // TODO: ensure only one job is enqueued per call and it should be returned
    continueWith: async <TQueueName extends string, TInput>({
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
        isChain: false,
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
      retryConfig,
      workerId,
    }: {
      job: StateJob;
      error: unknown;
      context: BaseStateProviderContext;
      retryConfig: RetryConfig;
      workerId: string;
    }): Promise<void> => {
      if (error instanceof LeaseExpiredError) {
        return;
      }

      const isRescheduled = error instanceof RescheduleJobError;
      const afterMs = isRescheduled ? error.afterMs : calculateBackoffMs(job.attempt, retryConfig);
      const errorString = isRescheduled ? String(error.cause) : String(error);

      log({
        type: "job_attempt_failed",
        level: "error",
        message: "Job attempt failed",
        args: [
          {
            jobId: job.id,
            queueName: job.queueName,
            status: job.status,
            attempt: job.attempt,
            workerId,
            chainId: job.chainId,
            rootId: job.rootId,
            originId: job.originId,
            rescheduledAfterMs: afterMs,
          },
          error,
        ],
      });

      await stateAdapter.rescheduleJob({
        context,
        jobId: job.id,
        afterMs,
        error: errorString,
      });
    },
    finishJob: async ({
      job,
      output,
      context,
      workerId,
    }: {
      job: StateJob;
      output: unknown;
      context: BaseStateProviderContext;
      workerId: string;
    }): Promise<void> => {
      const hasChainedJob = isEnqueuedJob(output);

      job = await stateAdapter.completeJob({
        context,
        jobId: job.id,
        output: hasChainedJob ? null : output,
      });

      log({
        type: "job_completed",
        level: "info",
        message: "Job completed",
        args: [
          {
            jobId: job.id,
            queueName: job.queueName,
            status: job.status,
            attempt: job.attempt,
            output,
            workerId,
            chainId: job.chainId,
            rootId: job.rootId,
            originId: job.originId,
          },
        ],
      });

      if (!hasChainedJob) {
        const jobChainStartJob = await stateAdapter.getJobById({
          context,
          jobId: job.chainId,
        });

        if (!jobChainStartJob) {
          throw new Error(`Job chain with id ${job.chainId} not found`);
        }

        log({
          type: "job_chain_completed",
          level: "info",
          message: "Job chain completed",
          args: [
            {
              chainName: jobChainStartJob.queueName,
              chainId: jobChainStartJob.chainId,
              originId: jobChainStartJob.originId,
              rootId: jobChainStartJob.rootId,
              output,
            },
          ],
        });

        const unblockedJobs = await stateAdapter.scheduleBlockedJobs({
          context,
          blockedByChainId: jobChainStartJob.id,
        });

        if (unblockedJobs.length > 0) {
          log({
            type: "job_chain_unblocked_jobs",
            level: "info",
            message: "Job chain completed and unblocked jobs",
            args: [
              {
                chainName: jobChainStartJob.queueName,
                originId: jobChainStartJob.originId,
                chainId: jobChainStartJob.chainId,
                rootId: jobChainStartJob.rootId,
                unblockedJobs: unblockedJobs.map((j) => ({
                  jobId: j.id,
                  queueName: j.queueName,
                  chainId: j.chainId,
                  originId: j.originId,
                  rootId: j.rootId,
                })),
              },
            ],
          });
        }
      }
    },
    refetchJobForUpdate: async ({
      context,
      job,
      workerId,
      allowEmptyWorker,
    }: {
      context: BaseStateProviderContext;
      job: StateJob;
      workerId: string;
      allowEmptyWorker: boolean;
    }): Promise<StateJob> => {
      const fetchedJob = await stateAdapter.getJobById({
        context,
        jobId: job.id,
      });

      if (!fetchedJob) {
        throw new Error(`Job with id ${job.id} not found`);
      }

      if (
        fetchedJob.leasedBy !== workerId &&
        !(allowEmptyWorker ? fetchedJob.leasedBy === null : false)
      ) {
        log({
          type: "job_lease_expired",
          level: "warn",
          message: "Job lease expired",
          args: [
            {
              jobId: fetchedJob.id,
              queueName: fetchedJob.queueName,
              status: fetchedJob.status,
              attempt: fetchedJob.attempt,
              workerId,
              chainId: fetchedJob.chainId,
              rootId: fetchedJob.rootId,
              originId: fetchedJob.originId,
              leasedBy: fetchedJob.leasedBy!,
              leasedUntil: fetchedJob.leasedUntil!,
            },
          ],
        });
        throw new LeaseExpiredError(`Job lease taken by another worker`, {
          cause: {
            jobId: fetchedJob.id,
            workerId,
            leasedBy: fetchedJob.leasedBy,
          },
        });
      }

      if (fetchedJob.leasedUntil && fetchedJob.leasedUntil.getTime() < Date.now()) {
        log({
          type: "job_lease_expired",
          level: "warn",
          message: `Job lease expired`,
          args: [
            {
              jobId: fetchedJob.id,
              queueName: fetchedJob.queueName,
              status: fetchedJob.status,
              attempt: fetchedJob.attempt,
              workerId,
              chainId: fetchedJob.chainId,
              rootId: fetchedJob.rootId,
              originId: fetchedJob.originId,
              leasedBy: fetchedJob.leasedBy!,
              leasedUntil: fetchedJob.leasedUntil!,
            },
          ],
        });
      }

      return fetchedJob;
    },
    renewJobLease: async ({
      context,
      job,
      leaseMs,
      workerId,
    }: {
      context: BaseStateProviderContext;
      job: StateJob;
      leaseMs: number;
      workerId: string;
    }): Promise<StateJob> => {
      return stateAdapter.renewJobLease({
        context,
        jobId: job.id,
        workerId,
        leaseDurationMs: leaseMs,
      });
    },
    getNextJobAvailableInMs: async ({
      queueNames,
      pollIntervalMs,
    }: {
      queueNames: string[];
      pollIntervalMs: number;
    }): Promise<number> => {
      const nextJobAvailableInMs = await stateProvider.provideContext((context) =>
        stateAdapter.getNextJobAvailableInMs({
          context,
          queueNames,
        }),
      );

      return nextJobAvailableInMs
        ? Math.min(Math.max(0, nextJobAvailableInMs), pollIntervalMs)
        : pollIntervalMs;
    },
    acquireJob: async ({
      queueNames,
      context,
      workerId,
    }: {
      queueNames: string[];
      context: BaseStateProviderContext;
      workerId: string;
    }): Promise<StateJob | undefined> => {
      const job = await stateAdapter.acquireJob({
        context,
        queueNames,
      });

      if (job) {
        log({
          type: "job_acquired",
          level: "info",
          message: `Job acquired`,
          args: [
            {
              status: job.status,
              attempt: job.attempt,
              jobId: job.id,
              queueName: job.queueName,
              chainId: job.chainId,
              originId: job.originId,
              rootId: job.rootId,
              workerId,
            },
          ],
        });
      }

      return job;
    },
    removeExpiredJobLease: async ({
      queueNames,
      workerId,
    }: {
      queueNames: string[];
      workerId: string;
    }): Promise<void> => {
      const job = await stateProvider.provideContext((context) =>
        stateAdapter.removeExpiredJobLease({ context, queueNames }),
      );
      if (job) {
        log({
          type: "job_reaped",
          level: "info",
          message: "Reaped expired job lease",
          args: [
            {
              jobId: job.id,
              queueName: job.queueName,
              leasedBy: job.leasedBy!,
              leasedUntil: job.leasedUntil!,
              chainId: job.chainId,
              originId: job.originId,
              rootId: job.rootId,
              workerId,
            },
          ],
        });
      }
    },
  };
};
export type ProcessHelper = ReturnType<typeof queuertHelper>;
