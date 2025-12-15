import { AsyncLocalStorage } from "node:async_hooks";
import {
  CompatibleJobTypeTargets,
  CompletedJobSequence,
  JobSequence,
  mapStateJobPairToJobSequence,
  ResolvedJobSequence,
} from "./entities/job-sequence.js";
import {
  EnqueuedJob,
  enqueuedJobSymbol,
  isEnqueuedJob,
  Job,
  mapStateJobToJob,
  RunningJob,
} from "./entities/job.js";
import { BackoffConfig, calculateBackoffMs } from "./helpers/backoff.js";
import { BaseJobTypeDefinitions, UnwrapContinuationInput } from "./entities/job-type.js";
import { Log } from "./log.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import {
  DeduplicationOptions,
  GetStateAdapterContext,
  StateAdapter,
  StateJob,
} from "./state-adapter/state-adapter.js";
import { BaseStateProviderContext } from "./state-provider/state-provider.js";
import { RescheduleJobError } from "./worker/job-handler.js";

const notifyJobTypeStorage = new AsyncLocalStorage<Set<string>>();
const jobContextStorage = new AsyncLocalStorage<{
  originId: string;
  sequenceId: string;
  rootId: string;
}>();

export class LeaseExpiredError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export type ResolvedJobTypeJobs<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = {
  [K in CompatibleJobTypeTargets<TJobTypeDefinitions, TJobTypeName>]: Job<
    K,
    UnwrapContinuationInput<TJobTypeDefinitions[K]["input"]>
  >;
}[CompatibleJobTypeTargets<TJobTypeDefinitions, TJobTypeName>];

export type EnqueueBlockerJobSequences<
  TStateAdapter extends StateAdapter<BaseStateProviderContext>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
  TBlockers extends readonly {
    [K in keyof TJobTypeDefinitions]: ResolvedJobSequence<TJobTypeDefinitions, K>;
  }[keyof TJobTypeDefinitions][],
> = (
  enqueueBlockerJobSequencesOptions: {
    job: Job<TJobTypeName, TJobTypeDefinitions[TJobTypeName]["input"]>;
  } & GetStateAdapterContext<TStateAdapter>,
) => Promise<TBlockers>;

export const queuertHelper = ({
  stateAdapter,
  notifyAdapter,
  log,
}: {
  stateAdapter: StateAdapter;
  notifyAdapter: NotifyAdapter;
  log: Log;
}) => {
  const enqueueStateJob = async ({
    typeName,
    input,
    context,
    isSequence,
    deduplication,
  }: {
    typeName: string;
    input: unknown;
    context: BaseStateProviderContext;
    isSequence: boolean;
    deduplication?: DeduplicationOptions;
  }): Promise<{ job: StateJob; deduplicated: boolean }> => {
    const jobContext = jobContextStorage.getStore();
    const { job, deduplicated } = await stateAdapter.createJob({
      context,
      typeName,
      input,
      originId: jobContext?.originId,
      sequenceId: isSequence ? undefined : jobContext?.sequenceId,
      rootId: jobContext?.rootId,
      deduplication,
    });

    if (deduplicated) {
      return { job, deduplicated };
    }

    if (isSequence) {
      log({
        type: "job_sequence_created",
        level: "info",
        message: "Job sequence created",
        args: [
          {
            firstJobTypeName: job.typeName,
            sequenceId: job.sequenceId,
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
          id: job.id,
          typeName: job.typeName,
          originId: job.originId,
          sequenceId: job.sequenceId,
          rootId: job.rootId,
          input,
        },
      ],
    });

    const notifyJobTypeSet = notifyJobTypeStorage.getStore();
    if (notifyJobTypeSet) {
      notifyJobTypeSet.add(typeName);
    } else {
      log({
        type: "notify_context_absence",
        level: "warn",
        message:
          "Not withNotify context when enqueueing job for queue. The job processing may be delayed.",
        args: [
          {
            id: job.id,
            typeName: job.typeName,
            sequenceId: job.sequenceId,
            rootId: job.rootId,
            originId: job.originId,
          },
        ],
      });
    }

    return { job, deduplicated };
  };

  const withNotifyJobTypeContext = async <T, TArgs extends any[]>(
    cb: (...args: TArgs) => Promise<T>,
    ...args: TArgs
  ): Promise<T> => {
    return notifyJobTypeStorage.run(new Set(), async () => {
      const result = await cb(...args);

      await Promise.all(
        Array.from(notifyJobTypeStorage.getStore() ?? []).map((typeName) =>
          notifyAdapter.notifyJobScheduled(typeName),
        ),
      );

      return result;
    });
  };

  return {
    withNotifyJobTypeContext: withNotifyJobTypeContext as <T>(cb: () => Promise<T>) => Promise<T>,
    withJobContext: async <T>(
      context: { originId: string; sequenceId: string; rootId: string },
      cb: () => Promise<T>,
    ): Promise<T> => {
      return jobContextStorage.run(context, cb);
    },
    runInTransaction: async <T>(
      cb: (context: BaseStateProviderContext) => Promise<T>,
    ): Promise<T> => {
      return stateAdapter.provideContext((context) =>
        withNotifyJobTypeContext(() => stateAdapter.runInTransaction(context, cb)),
      );
    },
    scheduleBlockerJobSequences: async ({
      job,
      enqueueBlockerJobSequences,
      context,
    }: {
      job: StateJob;
      enqueueBlockerJobSequences?: EnqueueBlockerJobSequences<
        StateAdapter<BaseStateProviderContext>,
        BaseJobTypeDefinitions,
        string,
        readonly JobSequence<any, any, any>[]
      >;
      context: BaseStateProviderContext;
    }): Promise<StateJob> => {
      if (job.status !== "created") {
        return job;
      }

      const blockerJobSequences = enqueueBlockerJobSequences
        ? await enqueueBlockerJobSequences({
            job: mapStateJobToJob(job),
            ...context,
          })
        : [];
      if (blockerJobSequences.length) {
        await stateAdapter.addJobBlockers({
          context,
          jobId: job.id,
          blockedBySequenceIds: blockerJobSequences.map((b: JobSequence<any, any, any>) => b.id),
        });
        log({
          type: "job_blockers_added",
          level: "info",
          message: "Job blockers added",
          args: [
            {
              id: job.id,
              typeName: job.typeName,
              status: job.status,
              attempt: job.attempt,
              originId: job.originId,
              sequenceId: job.sequenceId,
              rootId: job.rootId,
              blockers: blockerJobSequences.map((b: JobSequence<any, any, any>) => ({
                sequenceId: b.id,
                firstJobTypeName: b.firstJobTypeName,
                rootId: b.rootId,
                originId: b.originId,
              })),
            },
          ],
        });
      }
      const incompleteBlockers = blockerJobSequences.filter(
        (b: JobSequence<any, any, any>) => b.status !== "completed",
      );
      if (incompleteBlockers.length) {
        job = await stateAdapter.markJobAsBlocked({
          context,
          jobId: job.id,
        });
        log({
          type: "job_blocked",
          level: "info",
          message: "Job is blocked",
          args: [
            {
              id: job.id,
              typeName: job.typeName,
              status: job.status,
              attempt: job.attempt,
              originId: job.originId,
              sequenceId: job.sequenceId,
              rootId: job.rootId,
              incompleteBlockers: incompleteBlockers.map((b: JobSequence<any, any, any>) => ({
                sequenceId: b.id,
                firstJobTypeName: b.firstJobTypeName,
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
      blockers: CompletedJobSequence<JobSequence<any, any, any>>[];
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
        blockers: blockers.map(mapStateJobPairToJobSequence) as CompletedJobSequence<
          JobSequence<any, any, any>
        >[],
      };
    },
    startJobSequence: async <TFirstJobTypeName extends string, TInput, TOutput>({
      firstJobTypeName,
      input,
      context,
      deduplication,
    }: {
      firstJobTypeName: TFirstJobTypeName;
      input: TInput;
      context: any;
      deduplication?: DeduplicationOptions;
    }): Promise<JobSequence<TFirstJobTypeName, TInput, TOutput> & { deduplicated: boolean }> => {
      await stateAdapter.assertInTransaction(context);

      const { job, deduplicated } = await enqueueStateJob({
        typeName: firstJobTypeName,
        input,
        context,
        isSequence: true,
        deduplication,
      });

      return { ...mapStateJobPairToJobSequence([job, undefined]), deduplicated };
    },
    getJobSequence: async <TFirstJobTypeName extends string, TInput, TOutput>({
      id,
      context,
    }: {
      id: string;
      firstJobTypeName: TFirstJobTypeName;
      context: any;
    }): Promise<JobSequence<TFirstJobTypeName, TInput, TOutput> | null> => {
      const jobSequence = await stateAdapter.getJobSequenceById({
        context,
        jobId: id,
      });

      return jobSequence ? mapStateJobPairToJobSequence(jobSequence) : null;
    },
    continueWith: async <TJobTypeName extends string, TInput>({
      typeName,
      input,
      context,
    }: {
      typeName: TJobTypeName;
      input: TInput;
      context: any;
    }): Promise<EnqueuedJob<TJobTypeName, TInput>> => {
      const { job } = await enqueueStateJob({
        typeName,
        input,
        context,
        isSequence: false,
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
      retryConfig: BackoffConfig;
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
            id: job.id,
            typeName: job.typeName,
            status: job.status,
            attempt: job.attempt,
            workerId,
            sequenceId: job.sequenceId,
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
      const hasContinuedJob = isEnqueuedJob(output);

      job = await stateAdapter.completeJob({
        context,
        jobId: job.id,
        output: hasContinuedJob ? null : output,
      });

      log({
        type: "job_completed",
        level: "info",
        message: "Job completed",
        args: [
          {
            id: job.id,
            typeName: job.typeName,
            status: job.status,
            attempt: job.attempt,
            output,
            workerId,
            sequenceId: job.sequenceId,
            rootId: job.rootId,
            originId: job.originId,
          },
        ],
      });

      if (!hasContinuedJob) {
        const jobSequenceStartJob = await stateAdapter.getJobById({
          context,
          jobId: job.sequenceId,
        });

        if (!jobSequenceStartJob) {
          throw new Error(`Job sequence with id ${job.sequenceId} not found`);
        }

        log({
          type: "job_sequence_completed",
          level: "info",
          message: "Job sequence completed",
          args: [
            {
              firstJobTypeName: jobSequenceStartJob.typeName,
              sequenceId: jobSequenceStartJob.sequenceId,
              originId: jobSequenceStartJob.originId,
              rootId: jobSequenceStartJob.rootId,
              output,
            },
          ],
        });

        const unblockedJobs = await stateAdapter.scheduleBlockedJobs({
          context,
          blockedBySequenceId: jobSequenceStartJob.id,
        });

        if (unblockedJobs.length > 0) {
          log({
            type: "job_sequence_unblocked_jobs",
            level: "info",
            message: "Job sequence completed and unblocked jobs",
            args: [
              {
                firstJobTypeName: jobSequenceStartJob.typeName,
                originId: jobSequenceStartJob.originId,
                sequenceId: jobSequenceStartJob.sequenceId,
                rootId: jobSequenceStartJob.rootId,
                unblockedJobs: unblockedJobs.map((j) => ({
                  id: j.id,
                  typeName: j.typeName,
                  sequenceId: j.sequenceId,
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
              id: fetchedJob.id,
              typeName: fetchedJob.typeName,
              status: fetchedJob.status,
              attempt: fetchedJob.attempt,
              workerId,
              sequenceId: fetchedJob.sequenceId,
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
              id: fetchedJob.id,
              typeName: fetchedJob.typeName,
              status: fetchedJob.status,
              attempt: fetchedJob.attempt,
              workerId,
              sequenceId: fetchedJob.sequenceId,
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
      typeNames,
      pollIntervalMs,
    }: {
      typeNames: string[];
      pollIntervalMs: number;
    }): Promise<number> => {
      const nextJobAvailableInMs = await stateAdapter.provideContext((context) =>
        stateAdapter.getNextJobAvailableInMs({
          context,
          typeNames,
        }),
      );

      return nextJobAvailableInMs
        ? Math.min(Math.max(0, nextJobAvailableInMs), pollIntervalMs)
        : pollIntervalMs;
    },
    acquireJob: async ({
      typeNames,
      context,
      workerId,
    }: {
      typeNames: string[];
      context: BaseStateProviderContext;
      workerId: string;
    }): Promise<StateJob | undefined> => {
      const job = await stateAdapter.acquireJob({
        context,
        typeNames,
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
              id: job.id,
              typeName: job.typeName,
              sequenceId: job.sequenceId,
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
      typeNames,
      workerId,
    }: {
      typeNames: string[];
      workerId: string;
    }): Promise<void> => {
      const job = await stateAdapter.provideContext((context) =>
        stateAdapter.removeExpiredJobLease({ context, typeNames }),
      );
      if (job) {
        log({
          type: "job_reaped",
          level: "info",
          message: "Reaped expired job lease",
          args: [
            {
              id: job.id,
              typeName: job.typeName,
              leasedBy: job.leasedBy!,
              leasedUntil: job.leasedUntil!,
              sequenceId: job.sequenceId,
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
