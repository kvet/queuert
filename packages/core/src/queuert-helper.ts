import { AsyncLocalStorage } from "node:async_hooks";
import {
  CompatibleJobTypeTargets,
  JobSequence,
  mapStateJobPairToJobSequence,
  ResolveBlockerSequences,
} from "./entities/job-sequence.js";
import { BaseJobTypeDefinitions, UnwrapContinuationInput } from "./entities/job-type.js";
import {
  ContinuedJob,
  continuedJobSymbol,
  isContinuedJob,
  Job,
  mapStateJobToJob,
  PendingJob,
} from "./entities/job.js";
import { BackoffConfig, calculateBackoffMs } from "./helpers/backoff.js";
import { Log } from "./log.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { DeduplicationOptions, StateAdapter, StateJob } from "./state-adapter/state-adapter.js";
import { BaseStateProviderContext } from "./state-provider/state-provider.js";
import { RescheduleJobError } from "./worker/job-handler.js";

export type StartBlockersFn<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = (options: {
  job: PendingJob<
    Job<TJobTypeName, UnwrapContinuationInput<TJobTypeDefinitions[TJobTypeName]["input"]>>
  >;
}) => Promise<ResolveBlockerSequences<TJobTypeDefinitions, TJobTypeName>>;

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

export class JobDeletedError extends Error {
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

export const queuertHelper = ({
  stateAdapter,
  notifyAdapter,
  log,
}: {
  stateAdapter: StateAdapter;
  notifyAdapter: NotifyAdapter;
  log: Log;
}) => {
  const createStateJob = async ({
    typeName,
    input,
    context,
    startBlockers,
    isSequence,
    deduplication,
  }: {
    typeName: string;
    input: unknown;
    context: BaseStateProviderContext;
    startBlockers?: StartBlockersFn<BaseJobTypeDefinitions, string>;
    isSequence: boolean;
    deduplication?: DeduplicationOptions;
  }): Promise<{ job: StateJob; deduplicated: boolean }> => {
    const jobContext = jobContextStorage.getStore();
    const createJobResult = await stateAdapter.createJob({
      context,
      typeName,
      input,
      originId: jobContext?.originId,
      sequenceId: isSequence ? undefined : jobContext?.sequenceId,
      rootId: jobContext?.rootId,
      deduplication,
    });
    let job = createJobResult.job;
    const deduplicated = createJobResult.deduplicated;

    if (deduplicated) {
      return { job, deduplicated };
    }

    let blockerSequences: JobSequence<any, any, any>[] = [];
    if (startBlockers) {
      const blockers = await withJobContext(
        {
          originId: job.id,
          sequenceId: job.sequenceId,
          rootId: job.rootId,
        },
        () => startBlockers({ job: mapStateJobToJob(job) as any }),
      );

      blockerSequences = [...blockers] as JobSequence<any, any, any>[];
      const blockerSequenceIds = blockerSequences.map((b) => b.id);

      job = await stateAdapter.addJobBlockers({
        context,
        jobId: job.id,
        blockedBySequenceIds: blockerSequenceIds,
      });
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
          blockers: blockerSequences.map((b) => ({
            sequenceId: b.id,
            firstJobTypeName: b.firstJobTypeName,
            originId: b.originId,
            rootId: b.rootId,
          })),
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
          "Not withNotify context when creating job for queue. The job processing may be delayed.",
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

  const withJobContext = async <T>(
    context: { originId: string; sequenceId: string; rootId: string },
    cb: () => Promise<T>,
  ): Promise<T> => {
    return jobContextStorage.run(context, cb);
  };

  return {
    withNotifyJobTypeContext: withNotifyJobTypeContext as <T>(cb: () => Promise<T>) => Promise<T>,
    withJobContext: withJobContext as <T>(
      context: { originId: string; sequenceId: string; rootId: string },
      cb: () => Promise<T>,
    ) => Promise<T>,
    runInTransaction: async <T>(
      cb: (context: BaseStateProviderContext) => Promise<T>,
    ): Promise<T> => {
      return stateAdapter.provideContext((context) =>
        withNotifyJobTypeContext(() => stateAdapter.runInTransaction(context, cb)),
      );
    },
    getJobBlockers: async ({
      jobId,
      context,
    }: {
      jobId: string;
      context: BaseStateProviderContext;
    }): Promise<[StateJob, StateJob | undefined][]> =>
      stateAdapter.getJobBlockers({ context, jobId }),
    startJobSequence: async <TFirstJobTypeName extends string, TInput, TOutput>({
      firstJobTypeName,
      input,
      context,
      deduplication,
      startBlockers,
    }: {
      firstJobTypeName: TFirstJobTypeName;
      input: TInput;
      context: any;
      deduplication?: DeduplicationOptions;
      startBlockers?: StartBlockersFn<BaseJobTypeDefinitions, string>;
    }): Promise<JobSequence<TFirstJobTypeName, TInput, TOutput> & { deduplicated: boolean }> => {
      await stateAdapter.assertInTransaction(context);

      const { job, deduplicated } = await createStateJob({
        typeName: firstJobTypeName,
        input,
        context,
        startBlockers,
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
      startBlockers,
    }: {
      typeName: TJobTypeName;
      input: TInput;
      context: any;
      startBlockers?: StartBlockersFn<BaseJobTypeDefinitions, string>;
    }): Promise<ContinuedJob<TJobTypeName, TInput>> => {
      const { job } = await createStateJob({
        typeName,
        input,
        context,
        startBlockers,
        isSequence: false,
      });

      return { ...mapStateJobToJob(job), [continuedJobSymbol]: true };
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
      if (error instanceof LeaseExpiredError || error instanceof JobDeletedError) {
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
      const hasContinuedJob = isContinuedJob(output);

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
        throw new JobDeletedError(`Job has been deleted`, {
          cause: {
            jobId: job.id,
          },
        });
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
          type: "job_attempt_started",
          level: "info",
          message: "Job attempt started",
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
    deleteJobSequences: async ({
      sequenceIds,
      context,
    }: {
      sequenceIds: string[];
      context: BaseStateProviderContext;
    }): Promise<StateJob[]> => {
      await stateAdapter.assertInTransaction(context);

      const sequenceJobs = await Promise.all(
        sequenceIds.map((sequenceId) =>
          stateAdapter.getJobById({
            context,
            jobId: sequenceId,
          }),
        ),
      );

      for (let i = 0; i < sequenceIds.length; i++) {
        const sequenceJob = sequenceJobs[i];
        const sequenceId = sequenceIds[i];

        if (!sequenceJob) {
          throw new Error(`Job sequence with id ${sequenceId} not found`);
        }

        if (sequenceJob.rootId !== sequenceJob.id) {
          throw new Error(
            `Cannot delete job sequence ${sequenceId}: must delete from the root sequence (rootId: ${sequenceJob.rootId})`,
          );
        }
      }

      const externalBlockers = await stateAdapter.getExternalBlockers({
        context,
        rootIds: sequenceIds,
      });

      if (externalBlockers.length > 0) {
        const uniqueBlockedRootIds = [...new Set(externalBlockers.map((b) => b.blockedRootId))];
        throw new Error(
          `Cannot delete job sequences: external job sequences depend on them. ` +
            `Include the following root sequences in the deletion: ${uniqueBlockedRootIds.join(", ")}`,
        );
      }

      const deletedJobs = await stateAdapter.deleteJobsByRootIds({
        context,
        rootIds: sequenceIds,
      });

      for (const sequenceJob of sequenceJobs as StateJob[]) {
        const deletedJobsForSequence = deletedJobs.filter((j) => j.rootId === sequenceJob.id);
        if (deletedJobsForSequence.length > 0) {
          log({
            type: "job_sequence_deleted",
            level: "info",
            message: "Job sequence deleted",
            args: [
              {
                sequenceId: sequenceJob.sequenceId,
                firstJobTypeName: sequenceJob.typeName,
                originId: sequenceJob.originId,
                rootId: sequenceJob.rootId,
                deletedJobIds: deletedJobsForSequence.map((j) => j.id),
              },
            ],
          });
        }
      }

      return deletedJobs;
    },
  };
};
export type ProcessHelper = ReturnType<typeof queuertHelper>;
