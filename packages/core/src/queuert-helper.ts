import { AsyncLocalStorage } from "node:async_hooks";
import { UUID } from "node:crypto";
import {
  CompletedJobSequence,
  JobSequence,
  mapStateJobPairToJobSequence,
} from "./entities/job-sequence.js";
import {
  BaseJobTypeDefinitions,
  BlockerSequences,
  ContinuationJobs,
  JobOf,
  JobSequenceOf,
  SequenceJobs,
  SequenceJobTypes,
} from "./entities/job-type.js";
import { Job, JobWithoutBlockers, mapStateJobToJob, PendingJob } from "./entities/job.js";
import { ScheduleOptions } from "./entities/schedule.js";
import { BackoffConfig, calculateBackoffMs } from "./helpers/backoff.js";
import { sleep } from "./helpers/sleep.js";
import { createLogHelper, LogHelper } from "./log-helper.js";
import { Log } from "./log.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { createNoopNotifyAdapter } from "./notify-adapter/notify-adapter.noop.js";
import {
  BaseStateAdapterContext,
  DeduplicationOptions,
  GetStateAdapterJobId,
  StateAdapter,
  StateJob,
} from "./state-adapter/state-adapter.js";
import { CompleteCallbackOptions, RescheduleJobError } from "./worker/job-process.js";

export type StartBlockersFn<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = (options: {
  job: PendingJob<JobWithoutBlockers<JobOf<TJobId, TJobTypeDefinitions, TJobTypeName>>>;
}) => Promise<BlockerSequences<TJobId, TJobTypeDefinitions, TJobTypeName>>;

const notifyCompletionStorage = new AsyncLocalStorage<{
  storeId: UUID;
  jobTypeCounts: Map<string, number>;
  sequenceIds: Set<string>;
  jobOwnershipLostIds: Set<string>;
}>();
const jobContextStorage = new AsyncLocalStorage<{
  storeId: UUID;
  originId: string;
  sequenceId: string;
  rootId: string;
}>();

export class JobTakenByAnotherWorkerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class JobNotFoundError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class JobAlreadyCompletedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class WaitForJobSequenceCompletionTimeoutError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export const queuertHelper = ({
  stateAdapter,
  notifyAdapter: notifyAdapterOption,
  log,
}: {
  stateAdapter: StateAdapter<BaseStateAdapterContext, any>;
  notifyAdapter?: NotifyAdapter;
  log: Log;
}) => {
  const notifyAdapter = notifyAdapterOption ?? createNoopNotifyAdapter();
  const logHelper = createLogHelper({ log });
  const createStateJob = async ({
    typeName,
    input,
    context,
    startBlockers,
    isSequence,
    deduplication,
    schedule,
  }: {
    typeName: string;
    input: unknown;
    context: BaseStateAdapterContext;
    startBlockers?: StartBlockersFn<string, BaseJobTypeDefinitions, string>;
    isSequence: boolean;
    deduplication?: DeduplicationOptions;
    schedule?: ScheduleOptions;
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
      schedule,
    });
    let job = createJobResult.job;
    const deduplicated = createJobResult.deduplicated;

    if (deduplicated) {
      return { job, deduplicated };
    }

    let blockerSequences: JobSequence<any, any, any, any>[] = [];
    if (startBlockers) {
      const blockers = await withJobContext(
        {
          originId: job.id,
          sequenceId: job.sequenceId,
          rootId: job.rootId,
        },
        async () => startBlockers({ job: mapStateJobToJob(job) as any }),
      );

      blockerSequences = [...blockers] as JobSequence<any, any, any, any>[];
      const blockerSequenceIds = blockerSequences.map((b) => b.id);

      job = await stateAdapter.addJobBlockers({
        context,
        jobId: job.id,
        blockedBySequenceIds: blockerSequenceIds,
      });
    }

    if (isSequence) {
      logHelper.jobSequenceCreated(job, { input });
    }

    logHelper.jobCreated(job, { input, blockers: blockerSequences, schedule });

    notifyJobScheduled(job);

    return { job, deduplicated };
  };

  const notifyJobScheduled = (job: StateJob): void => {
    const store = notifyCompletionStorage.getStore();
    if (store) {
      store.jobTypeCounts.set(job.typeName, (store.jobTypeCounts.get(job.typeName) ?? 0) + 1);
    } else if (notifyAdapterOption) {
      logHelper.notifyContextAbsence(job);
    }
  };

  const notifySequenceCompletion = (job: StateJob): void => {
    const store = notifyCompletionStorage.getStore();
    if (store) {
      store.sequenceIds.add(job.sequenceId);
    }
  };

  const notifyJobOwnershipLost = (jobId: string): void => {
    const store = notifyCompletionStorage.getStore();
    if (store) {
      store.jobOwnershipLostIds.add(jobId);
    }
  };

  const withNotifyContext = async <T, TArgs extends any[]>(
    cb: (...args: TArgs) => Promise<T>,
    ...args: TArgs
  ): Promise<T> => {
    if (notifyCompletionStorage.getStore()) {
      return cb(...args);
    }

    const store = {
      storeId: crypto.randomUUID(),
      jobTypeCounts: new Map<string, number>(),
      sequenceIds: new Set<string>(),
      jobOwnershipLostIds: new Set<string>(),
    };
    return notifyCompletionStorage.run(store, async () => {
      const result = await cb(...args);

      await Promise.all([
        ...Array.from(store.jobTypeCounts.entries()).map(async ([typeName, count]) => {
          try {
            await notifyAdapter.notifyJobScheduled(typeName, count);
          } catch (error) {
            logHelper.notifyAdapterError("notifyJobScheduled", error);
          }
        }),
        ...Array.from(store.sequenceIds).map(async (sequenceId) => {
          try {
            await notifyAdapter.notifyJobSequenceCompleted(sequenceId);
          } catch (error) {
            logHelper.notifyAdapterError("notifyJobSequenceCompleted", error);
          }
        }),
        ...Array.from(store.jobOwnershipLostIds).map(async (jobId) => {
          try {
            await notifyAdapter.notifyJobOwnershipLost(jobId);
          } catch (error) {
            logHelper.notifyAdapterError("notifyJobOwnershipLost", error);
          }
        }),
      ]);

      return result;
    });
  };

  const withJobContext = async <T>(
    context: { originId: string; sequenceId: string; rootId: string },
    cb: () => Promise<T>,
  ): Promise<T> => {
    return jobContextStorage.run(
      {
        storeId: crypto.randomUUID(),
        ...context,
      },
      cb,
    );
  };

  const finishJob = async ({
    job,
    context,
    workerId,
    ...rest
  }: {
    job: StateJob;
    context: BaseStateAdapterContext;
    workerId: string | null;
  } & (
    | { type: "completeSequence"; output: unknown }
    | { type: "continueWith"; continuedJob: Job<any, any, any, any> }
  )): Promise<StateJob> => {
    const hasContinuedJob = rest.type === "continueWith";
    const output = hasContinuedJob ? null : rest.output;

    job = await stateAdapter.completeJob({
      context,
      jobId: job.id,
      output,
      workerId,
    });

    logHelper.jobCompleted(job, {
      output,
      continuedWith: hasContinuedJob ? rest.continuedJob : undefined,
      workerId,
    });

    if (!hasContinuedJob) {
      const jobSequenceStartJob = await stateAdapter.getJobById({
        context,
        jobId: job.sequenceId,
      });

      if (!jobSequenceStartJob) {
        throw new JobNotFoundError(`Job sequence with id ${job.sequenceId} not found`);
      }

      logHelper.jobSequenceCompleted(jobSequenceStartJob, { output });
      notifySequenceCompletion(job);

      const unblockedJobs = await stateAdapter.scheduleBlockedJobs({
        context,
        blockedBySequenceId: jobSequenceStartJob.id,
      });

      if (unblockedJobs.length > 0) {
        unblockedJobs.forEach((unblockedJob) => {
          notifyJobScheduled(unblockedJob);
        });

        logHelper.jobSequenceUnblockedJobs(jobSequenceStartJob, { unblockedJobs });
      }
    }

    return job;
  };

  return {
    // oxlint-disable-next-line no-unnecessary-type-assertion -- needed for --isolatedDeclarations
    notifyAdapter: notifyAdapter as NotifyAdapter,
    // oxlint-disable-next-line no-unnecessary-type-assertion -- needed for --isolatedDeclarations
    logHelper: logHelper as LogHelper,
    withNotifyContext: withNotifyContext as <T>(cb: () => Promise<T>) => Promise<T>,
    withJobContext: withJobContext as <T>(
      context: { originId: string; sequenceId: string; rootId: string },
      cb: () => Promise<T>,
    ) => Promise<T>,
    runInTransaction: async <T>(
      cb: (context: BaseStateAdapterContext) => Promise<T>,
    ): Promise<T> => {
      return stateAdapter.provideContext(async (context) =>
        stateAdapter.runInTransaction(context, cb),
      );
    },
    getJobBlockers: async ({
      jobId,
      context,
    }: {
      jobId: string;
      context: BaseStateAdapterContext;
    }): Promise<[StateJob, StateJob | undefined][]> =>
      stateAdapter.getJobBlockers({ context, jobId }),
    startJobSequence: async <TFirstJobTypeName extends string, TInput, TOutput>({
      firstJobTypeName,
      input,
      context,
      deduplication,
      schedule,
      startBlockers,
    }: {
      firstJobTypeName: TFirstJobTypeName;
      input: TInput;
      context: any;
      deduplication?: DeduplicationOptions;
      schedule?: ScheduleOptions;
      startBlockers?: StartBlockersFn<string, BaseJobTypeDefinitions, string>;
    }): Promise<
      JobSequence<string, TFirstJobTypeName, TInput, TOutput> & { deduplicated: boolean }
    > => {
      await stateAdapter.assertInTransaction(context);

      const { job, deduplicated } = await createStateJob({
        typeName: firstJobTypeName,
        input,
        context,
        startBlockers,
        isSequence: true,
        deduplication,
        schedule,
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
    }): Promise<JobSequence<string, TFirstJobTypeName, TInput, TOutput> | null> => {
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
      schedule,
      startBlockers,
    }: {
      typeName: TJobTypeName;
      input: TInput;
      context: any;
      schedule?: ScheduleOptions;
      startBlockers?: StartBlockersFn<string, BaseJobTypeDefinitions, string>;
    }): Promise<JobOf<string, BaseJobTypeDefinitions, TJobTypeName>> => {
      const { job } = await createStateJob({
        typeName,
        input,
        context,
        startBlockers,
        isSequence: false,
        schedule,
      });

      return mapStateJobToJob(job) as JobOf<string, BaseJobTypeDefinitions, TJobTypeName>;
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
      context: BaseStateAdapterContext;
      retryConfig: BackoffConfig;
      workerId: string;
    }): Promise<void> => {
      if (
        error instanceof JobTakenByAnotherWorkerError ||
        error instanceof JobNotFoundError ||
        error instanceof JobAlreadyCompletedError
      ) {
        return;
      }

      const isRescheduled = error instanceof RescheduleJobError;
      const schedule: ScheduleOptions = isRescheduled
        ? error.schedule
        : { afterMs: calculateBackoffMs(job.attempt, retryConfig) };
      const errorString = isRescheduled ? String(error.cause) : String(error);

      logHelper.jobAttemptFailed(job, { workerId, rescheduledSchedule: schedule, error });

      await stateAdapter.rescheduleJob({
        context,
        jobId: job.id,
        schedule,
        error: errorString,
      });
    },
    finishJob: finishJob as (
      options: {
        job: StateJob;
        context: BaseStateAdapterContext;
        workerId: string | null;
      } & (
        | { type: "completeSequence"; output: unknown }
        | { type: "continueWith"; continuedJob: Job<any, any, any, any> }
      ),
    ) => Promise<StateJob>,
    refetchJobForUpdate: async ({
      context,
      job,
      workerId,
      allowEmptyWorker,
    }: {
      context: BaseStateAdapterContext;
      job: StateJob;
      workerId: string;
      allowEmptyWorker: boolean;
    }): Promise<StateJob> => {
      const fetchedJob = await stateAdapter.getJobForUpdate({
        context,
        jobId: job.id,
      });

      if (!fetchedJob) {
        throw new JobNotFoundError(`Job not found`, {
          cause: {
            jobId: job.id,
          },
        });
      }

      if (fetchedJob.status === "completed") {
        throw new JobAlreadyCompletedError("Job is already completed");
      }

      if (
        fetchedJob.leasedBy !== workerId &&
        !(allowEmptyWorker ? fetchedJob.leasedBy === null : false)
      ) {
        logHelper.jobTakenByAnotherWorker(fetchedJob, { workerId });
        throw new JobTakenByAnotherWorkerError(`Job taken by another worker`, {
          cause: {
            jobId: fetchedJob.id,
            workerId,
            leasedBy: fetchedJob.leasedBy,
          },
        });
      }

      if (fetchedJob.leasedUntil && fetchedJob.leasedUntil.getTime() < Date.now()) {
        logHelper.jobLeaseExpired(fetchedJob, { workerId });
      }

      return fetchedJob;
    },
    renewJobLease: async ({
      context,
      job,
      leaseMs,
      workerId,
    }: {
      context: BaseStateAdapterContext;
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
      const nextJobAvailableInMs = await stateAdapter.provideContext(async (context) =>
        stateAdapter.getNextJobAvailableInMs({
          context,
          typeNames,
        }),
      );

      return nextJobAvailableInMs !== null
        ? Math.min(Math.max(0, nextJobAvailableInMs), pollIntervalMs)
        : pollIntervalMs;
    },
    acquireJob: async ({
      typeNames,
      context,
      workerId,
    }: {
      typeNames: string[];
      context: BaseStateAdapterContext;
      workerId: string;
    }): Promise<StateJob | undefined> => {
      const job = await stateAdapter.acquireJob({
        context,
        typeNames,
      });

      if (job) {
        logHelper.jobAttemptStarted(job, { workerId });
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
      const job = await stateAdapter.provideContext(async (context) =>
        stateAdapter.removeExpiredJobLease({ context, typeNames }),
      );
      if (job) {
        logHelper.jobReaped(job, { workerId });

        try {
          await notifyAdapter.notifyJobScheduled(job.typeName, 1);
        } catch (error) {
          logHelper.notifyAdapterError("notifyJobScheduled", error);
        }
        try {
          await notifyAdapter.notifyJobOwnershipLost(job.id);
        } catch (error) {
          logHelper.notifyAdapterError("notifyJobOwnershipLost", error);
        }
      }
    },
    deleteJobSequences: async ({
      sequenceIds,
      context,
    }: {
      sequenceIds: string[];
      context: BaseStateAdapterContext;
    }): Promise<void> => {
      await stateAdapter.assertInTransaction(context);

      const sequenceJobs = await Promise.all(
        sequenceIds.map(async (sequenceId) =>
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
          throw new JobNotFoundError(`Job sequence with id ${sequenceId} not found`);
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
          logHelper.jobSequenceDeleted(sequenceJob, {
            deletedJobIds: deletedJobsForSequence.map((j) => j.id),
          });
        }
      }
    },
    completeJobSequence: async <TFirstJobTypeName extends string, TInput, TOutput>({
      id,
      context,
      complete: completeCallback,
    }: {
      id: string;
      firstJobTypeName: TFirstJobTypeName;
      context: BaseStateAdapterContext;
      complete: (options: {
        job: StateJob;
        complete: (
          job: StateJob,
          completeCallback: (
            options: {
              continueWith: (options: {
                typeName: string;
                input: unknown;
                startBlockers?: StartBlockersFn<string, BaseJobTypeDefinitions, string>;
              }) => Promise<unknown>;
            } & BaseStateAdapterContext,
          ) => unknown,
        ) => Promise<unknown>;
      }) => Promise<void>;
    }): Promise<JobSequence<string, TFirstJobTypeName, TInput, TOutput>> => {
      await stateAdapter.assertInTransaction(context);

      const currentJob = await stateAdapter.getCurrentJobForUpdate({
        context,
        sequenceId: id,
      });

      if (!currentJob) {
        throw new JobNotFoundError(`Job sequence with id ${id} not found`);
      }

      const complete = async (
        job: StateJob,
        jobCompleteCallback: (
          options: {
            continueWith: (options: {
              typeName: string;
              input: unknown;
              schedule?: ScheduleOptions;
              startBlockers?: StartBlockersFn<string, BaseJobTypeDefinitions, string>;
            }) => Promise<unknown>;
          } & BaseStateAdapterContext,
        ) => unknown,
      ): Promise<unknown> => {
        if (job.status === "completed") {
          throw new JobAlreadyCompletedError(
            `Cannot complete job ${job.id}: job is already completed`,
          );
        }

        let continuedJob: Job<any, any, any, any> | null = null;

        const output = await jobCompleteCallback({
          continueWith: async ({ typeName, input, schedule, startBlockers }) => {
            if (continuedJob) {
              throw new Error("continueWith can only be called once");
            }

            continuedJob = await withJobContext(
              {
                originId: job.originId ?? job.id,
                sequenceId: job.sequenceId,
                rootId: job.rootId,
              },
              async () => {
                const { job: newJob } = await createStateJob({
                  typeName,
                  input,
                  context,
                  startBlockers: startBlockers as any,
                  isSequence: false,
                  schedule,
                });

                return mapStateJobToJob(newJob) as Job<any, any, any, any>;
              },
            );

            return continuedJob;
          },
          ...context,
        });

        const wasRunning = job.status === "running";

        await finishJob(
          continuedJob
            ? { job, context, workerId: null, type: "continueWith", continuedJob }
            : { job, context, workerId: null, type: "completeSequence", output },
        );

        if (wasRunning) {
          notifyJobOwnershipLost(job.id);
        }

        return continuedJob ?? output;
      };

      await completeCallback({ job: currentJob, complete });

      const updatedSequence = await stateAdapter.getJobSequenceById({
        context,
        jobId: id,
      });

      if (!updatedSequence) {
        throw new JobNotFoundError(`Job sequence with id ${id} not found after complete`);
      }

      return mapStateJobPairToJobSequence(updatedSequence);
    },
    waitForJobSequenceCompletion: async <TFirstJobTypeName extends string, TInput, TOutput>({
      id,
      timeoutMs,
      pollIntervalMs = 15_000,
      signal,
    }: {
      id: string;
      firstJobTypeName: TFirstJobTypeName;
      timeoutMs: number;
      pollIntervalMs?: number;
      signal?: AbortSignal;
    }): Promise<CompletedJobSequence<JobSequence<string, TFirstJobTypeName, TInput, TOutput>>> => {
      const checkSequence = async (): Promise<CompletedJobSequence<
        JobSequence<string, TFirstJobTypeName, TInput, TOutput>
      > | null> => {
        const sequence = await stateAdapter.provideContext(async (context) =>
          stateAdapter.getJobSequenceById({ context, jobId: id }),
        );
        if (!sequence) {
          throw new JobNotFoundError(`Job sequence with id ${id} not found`);
        }
        const jobSequence = mapStateJobPairToJobSequence(sequence);
        return jobSequence.status === "completed"
          ? (jobSequence as CompletedJobSequence<
              JobSequence<string, TFirstJobTypeName, TInput, TOutput>
            >)
          : null;
      };

      const completedSequence = await checkSequence();
      if (completedSequence) {
        return completedSequence;
      }

      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

      let resolveNotification: (() => void) | null = null;
      let notificationPromise!: Promise<void>;
      const resetNotificationPromise = (): void => {
        const { promise, resolve } = Promise.withResolvers<void>();
        notificationPromise = promise;
        resolveNotification = resolve;
      };
      resetNotificationPromise();

      let dispose: () => Promise<void> = async () => {};
      try {
        dispose = await notifyAdapter.listenJobSequenceCompleted(id, () => {
          resolveNotification?.();
        });
      } catch (error) {
        logHelper.notifyAdapterError("listenJobSequenceCompleted", error);
      }
      try {
        while (!combinedSignal.aborted) {
          await Promise.race([
            notificationPromise,
            sleep(pollIntervalMs, { signal: combinedSignal }),
          ]);
          resetNotificationPromise();

          const sequence = await checkSequence();
          if (sequence) return sequence;

          if (combinedSignal.aborted) break;
        }

        throw new WaitForJobSequenceCompletionTimeoutError(
          signal?.aborted
            ? `Wait for job sequence ${id} was aborted`
            : `Timeout waiting for job sequence ${id} to complete after ${timeoutMs}ms`,
          { cause: { sequenceId: id, timeoutMs } },
        );
      } finally {
        await dispose();
      }
    },
  };
};
export type ProcessHelper = ReturnType<typeof queuertHelper>;

export type JobSequenceCompleteOptions<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TFirstJobTypeName extends string,
  TCompleteReturn,
> = (options: {
  job: SequenceJobs<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TFirstJobTypeName>;
  complete: <
    TJobTypeName extends SequenceJobTypes<TJobTypeDefinitions, TFirstJobTypeName> & string,
    TReturn extends
      | TJobTypeDefinitions[TJobTypeName]["output"]
      | ContinuationJobs<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TJobTypeName>
      | Promise<TJobTypeDefinitions[TJobTypeName]["output"]>
      | Promise<
          ContinuationJobs<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TJobTypeName>
        >,
  >(
    job: JobOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TJobTypeName>,
    completeCallback: (
      completeOptions: CompleteCallbackOptions<TStateAdapter, TJobTypeDefinitions, TJobTypeName>,
    ) => TReturn,
  ) => Promise<Awaited<TReturn>>;
}) => Promise<TCompleteReturn>;

export type CompleteJobSequenceResult<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TFirstJobTypeName extends keyof TJobTypeDefinitions & string,
  TCompleteReturn,
> = [TCompleteReturn] extends [void]
  ? JobSequenceOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TFirstJobTypeName>
  : TCompleteReturn extends Job<any, any, any, any>
    ? JobSequenceOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TFirstJobTypeName>
    : CompletedJobSequence<
        JobSequence<
          GetStateAdapterJobId<TStateAdapter>,
          TFirstJobTypeName,
          TJobTypeDefinitions[TFirstJobTypeName]["input"],
          TCompleteReturn
        >
      >;
