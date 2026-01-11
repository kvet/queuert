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
  ExternalJobTypeDefinitions,
  JobOf,
  JobSequenceOf,
  SequenceJobs,
  SequenceJobTypes,
} from "./entities/job-type.js";
import { Job, JobWithoutBlockers, mapStateJobToJob, PendingJob } from "./entities/job.js";
import { ScheduleOptions } from "./entities/schedule.js";
import { BackoffConfig, calculateBackoffMs } from "./helpers/backoff.js";
import { raceWithSleep } from "./helpers/sleep.js";
import { Log } from "./observability-adapter/log.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { createNoopNotifyAdapter } from "./notify-adapter/notify-adapter.noop.js";
import { wrapNotifyAdapterWithLogging } from "./notify-adapter/notify-adapter.wrapper.logging.js";
import { ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import { createNoopObservabilityAdapter } from "./observability-adapter/observability-adapter.noop.js";
import {
  createObservabilityHelper,
  ObservabilityHelper,
} from "./observability-adapter/observability-helper.js";
import {
  BaseStateAdapterContext,
  DeduplicationOptions,
  GetStateAdapterJobId,
  StateAdapter,
  StateJob,
} from "./state-adapter/state-adapter.js";
import { wrapStateAdapterWithLogging } from "./state-adapter/state-adapter.wrapper.logging.js";
import { CompleteCallbackOptions, RescheduleJobError } from "./worker/job-process.js";

export type StartBlockersFn<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
  TSequenceTypeName extends keyof ExternalJobTypeDefinitions<TJobTypeDefinitions> & string =
    keyof ExternalJobTypeDefinitions<TJobTypeDefinitions> & string,
> = (options: {
  job: PendingJob<
    JobWithoutBlockers<JobOf<TJobId, TJobTypeDefinitions, TJobTypeName, TSequenceTypeName>>
  >;
}) => Promise<BlockerSequences<TJobId, TJobTypeDefinitions, TJobTypeName>>;

const notifyCompletionStorage = new AsyncLocalStorage<{
  storeId: UUID;
  jobTypeCounts: Map<string, number>;
  sequenceIds: Set<string>;
  jobOwnershipLostIds: Set<string>;
}>();
const jobContextStorage = new AsyncLocalStorage<{
  storeId: UUID;
  sequenceId: string;
  sequenceTypeName: string;
  rootSequenceId: string;
  originId: string;
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

export class StateNotInTransactionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export const queuertHelper = ({
  stateAdapter: stateAdapterOption,
  notifyAdapter: notifyAdapterOption,
  observabilityAdapter: observabilityAdapterOption,
  log,
}: {
  stateAdapter: StateAdapter<BaseStateAdapterContext, BaseStateAdapterContext, any>;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  log: Log;
}) => {
  const observabilityAdapter = observabilityAdapterOption ?? createNoopObservabilityAdapter();
  const observabilityHelper = createObservabilityHelper({ log, adapter: observabilityAdapter });
  const stateAdapter = wrapStateAdapterWithLogging({
    stateAdapter: stateAdapterOption,
    observabilityHelper,
  });
  const notifyAdapter = notifyAdapterOption
    ? wrapNotifyAdapterWithLogging({
        notifyAdapter: notifyAdapterOption,
        observabilityHelper,
      })
    : createNoopNotifyAdapter();

  const assertInTransaction = async (context: BaseStateAdapterContext): Promise<void> => {
    if (!(await stateAdapter.isInTransaction(context))) {
      throw new StateNotInTransactionError("Operation must be called within a transaction");
    }
  };

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
      sequenceTypeName: isSequence ? typeName : jobContext!.sequenceTypeName,
      input,
      originId: jobContext?.originId,
      sequenceId: isSequence ? undefined : jobContext!.sequenceId,
      rootSequenceId: isSequence ? jobContext?.rootSequenceId : jobContext!.rootSequenceId,
      deduplication,
      schedule,
    });
    let job = createJobResult.job;
    const deduplicated = createJobResult.deduplicated;

    if (deduplicated) {
      return { job, deduplicated };
    }

    let blockerSequences: JobSequence<any, any, any, any>[] = [];
    let incompleteBlockerSequenceIds: string[] = [];
    if (startBlockers) {
      const blockers = await withJobContext(
        {
          sequenceId: job.sequenceId,
          sequenceTypeName: job.sequenceTypeName,
          rootSequenceId: job.rootSequenceId,
          originId: job.id,
        },
        async () => startBlockers({ job: mapStateJobToJob(job) as any }),
      );

      blockerSequences = [...blockers] as JobSequence<any, any, any, any>[];
      const blockerSequenceIds = blockerSequences.map((b) => b.id);

      const addBlockersResult = await stateAdapter.addJobBlockers({
        context,
        jobId: job.id,
        blockedBySequenceIds: blockerSequenceIds,
      });
      job = addBlockersResult.job;
      incompleteBlockerSequenceIds = addBlockersResult.incompleteBlockerSequenceIds;
    }

    if (isSequence) {
      observabilityHelper.jobSequenceCreated(job, { input });
    }

    observabilityHelper.jobCreated(job, { input, blockers: blockerSequences, schedule });

    if (incompleteBlockerSequenceIds.length > 0) {
      const incompleteBlockerSet = new Set(incompleteBlockerSequenceIds);
      const incompleteBlockerSequences = blockerSequences.filter((b) =>
        incompleteBlockerSet.has(b.id),
      );
      observabilityHelper.jobBlocked(job, { blockedBySequences: incompleteBlockerSequences });
    }

    notifyJobScheduled(job);

    return { job, deduplicated };
  };

  const notifyJobScheduled = (job: StateJob): void => {
    const store = notifyCompletionStorage.getStore();
    if (store) {
      store.jobTypeCounts.set(job.typeName, (store.jobTypeCounts.get(job.typeName) ?? 0) + 1);
    } else if (notifyAdapterOption) {
      observabilityHelper.notifyContextAbsence(job);
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

  const withNotifyContext = async <T>(cb: () => Promise<T>): Promise<T> => {
    if (notifyCompletionStorage.getStore()) {
      return cb();
    }

    const store = {
      storeId: crypto.randomUUID(),
      jobTypeCounts: new Map<string, number>(),
      sequenceIds: new Set<string>(),
      jobOwnershipLostIds: new Set<string>(),
    };
    return notifyCompletionStorage.run(store, async () => {
      const result = await cb();

      await Promise.all([
        ...Array.from(store.jobTypeCounts.entries()).map(async ([typeName, count]) => {
          try {
            await notifyAdapter.notifyJobScheduled(typeName, count);
          } catch {}
        }),
        ...Array.from(store.sequenceIds).map(async (sequenceId) => {
          try {
            await notifyAdapter.notifyJobSequenceCompleted(sequenceId);
          } catch {}
        }),
        ...Array.from(store.jobOwnershipLostIds).map(async (jobId) => {
          try {
            await notifyAdapter.notifyJobOwnershipLost(jobId);
          } catch {}
        }),
      ]);

      return result;
    });
  };

  const withJobContext = async <T>(
    context: {
      originId: string;
      sequenceId: string;
      rootSequenceId: string;
      sequenceTypeName: string;
    },
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
    | { type: "continueWith"; continuedJob: Job<any, any, any, any, any[]> }
  )): Promise<StateJob> => {
    const hasContinuedJob = rest.type === "continueWith";
    const output = hasContinuedJob ? null : rest.output;

    job = await stateAdapter.completeJob({
      context,
      jobId: job.id,
      output,
      workerId,
    });

    observabilityHelper.jobCompleted(job, {
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

      observabilityHelper.jobSequenceCompleted(jobSequenceStartJob, { output });
      notifySequenceCompletion(job);

      const unblockedJobs = await stateAdapter.scheduleBlockedJobs({
        context,
        blockedBySequenceId: jobSequenceStartJob.id,
      });

      if (unblockedJobs.length > 0) {
        unblockedJobs.forEach((unblockedJob) => {
          notifyJobScheduled(unblockedJob);
          observabilityHelper.jobUnblocked(unblockedJob, {
            unblockedBySequence: jobSequenceStartJob,
          });
        });
      }
    }

    return job;
  };

  return {
    // oxlint-disable-next-line no-unnecessary-type-assertion -- needed for --isolatedDeclarations
    notifyAdapter: notifyAdapter as NotifyAdapter,
    // oxlint-disable-next-line no-unnecessary-type-assertion -- needed for --isolatedDeclarations
    observabilityHelper: observabilityHelper as ObservabilityHelper,
    withNotifyContext: withNotifyContext as <T>(cb: () => Promise<T>) => Promise<T>,
    withJobContext: withJobContext as <T>(
      context: {
        sequenceId: string;
        sequenceTypeName: string;
        rootSequenceId: string;
        originId: string;
      },
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
    startJobSequence: async <TSequenceTypeName extends string, TInput, TOutput>({
      typeName,
      input,
      context,
      deduplication,
      schedule,
      startBlockers,
    }: {
      typeName: TSequenceTypeName;
      input: TInput;
      context: any;
      deduplication?: DeduplicationOptions;
      schedule?: ScheduleOptions;
      startBlockers?: StartBlockersFn<string, BaseJobTypeDefinitions, string>;
    }): Promise<
      JobSequence<string, TSequenceTypeName, TInput, TOutput> & { deduplicated: boolean }
    > => {
      await assertInTransaction(context);

      const { job, deduplicated } = await createStateJob({
        typeName,
        input,
        context,
        startBlockers,
        isSequence: true,
        deduplication,
        schedule,
      });

      return { ...mapStateJobPairToJobSequence([job, undefined]), deduplicated };
    },
    getJobSequence: async <TSequenceTypeName extends string, TInput, TOutput>({
      id,
      context,
    }: {
      id: string;
      typeName: TSequenceTypeName;
      context: any;
    }): Promise<JobSequence<string, TSequenceTypeName, TInput, TOutput> | null> => {
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
    }): Promise<JobOf<string, BaseJobTypeDefinitions, TJobTypeName, string>> => {
      const { job } = await createStateJob({
        typeName,
        input,
        context,
        startBlockers,
        isSequence: false,
        schedule,
      });

      return mapStateJobToJob(job) as JobOf<string, BaseJobTypeDefinitions, TJobTypeName, string>;
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

      observabilityHelper.jobAttemptFailed(job, { workerId, rescheduledSchedule: schedule, error });

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
        | { type: "continueWith"; continuedJob: Job<any, any, any, any, any[]> }
      ),
    ) => Promise<StateJob>,
    logJobAttemptCompleted: ({
      job,
      output,
      continuedWith,
      workerId,
    }: {
      job: StateJob;
      output: unknown;
      continuedWith?: Job<any, any, any, any, any[]>;
      workerId: string;
    }): void => {
      observabilityHelper.jobAttemptCompleted(job, { output, continuedWith, workerId });
    },
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
        observabilityHelper.jobTakenByAnotherWorker(fetchedJob, { workerId });
        throw new JobTakenByAnotherWorkerError(`Job taken by another worker`, {
          cause: {
            jobId: fetchedJob.id,
            workerId,
            leasedBy: fetchedJob.leasedBy,
          },
        });
      }

      if (fetchedJob.leasedUntil && fetchedJob.leasedUntil.getTime() < Date.now()) {
        observabilityHelper.jobLeaseExpired(fetchedJob, { workerId });
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
        observabilityHelper.jobAttemptStarted(job, { workerId });
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
        observabilityHelper.jobReaped(job, { workerId });

        try {
          await notifyAdapter.notifyJobScheduled(job.typeName, 1);
        } catch {}
        try {
          await notifyAdapter.notifyJobOwnershipLost(job.id);
        } catch {}
      }
    },
    deleteJobSequences: async ({
      rootSequenceIds,
      context,
    }: {
      rootSequenceIds: string[];
      context: BaseStateAdapterContext;
    }): Promise<void> => {
      await assertInTransaction(context);

      const sequenceJobs = await Promise.all(
        rootSequenceIds.map(async (sequenceId) =>
          stateAdapter.getJobById({
            context,
            jobId: sequenceId,
          }),
        ),
      );

      for (let i = 0; i < rootSequenceIds.length; i++) {
        const sequenceJob = sequenceJobs[i];
        const sequenceId = rootSequenceIds[i];

        if (!sequenceJob) {
          throw new JobNotFoundError(`Job sequence with id ${sequenceId} not found`);
        }

        if (sequenceJob.rootSequenceId !== sequenceJob.id) {
          throw new Error(
            `Cannot delete job sequence ${sequenceId}: must delete from the root sequence (rootSequenceId: ${sequenceJob.rootSequenceId})`,
          );
        }
      }

      const externalBlockers = await stateAdapter.getExternalBlockers({
        context,
        rootSequenceIds,
      });

      if (externalBlockers.length > 0) {
        const uniqueBlockedRootIds = [
          ...new Set(externalBlockers.map((b) => b.blockedRootSequenceId)),
        ];
        throw new Error(
          `Cannot delete job sequences: external job sequences depend on them. ` +
            `Include the following root sequences in the deletion: ${uniqueBlockedRootIds.join(", ")}`,
        );
      }

      const deletedJobs = await stateAdapter.deleteJobsByRootSequenceIds({
        context,
        rootSequenceIds,
      });

      for (const sequenceJob of sequenceJobs as StateJob[]) {
        const deletedJobsForSequence = deletedJobs.filter(
          (j) => j.rootSequenceId === sequenceJob.id,
        );
        if (deletedJobsForSequence.length > 0) {
          observabilityHelper.jobSequenceDeleted(sequenceJob, {
            deletedJobIds: deletedJobsForSequence.map((j) => j.id),
          });
        }
      }
    },
    completeJobSequence: async <TSequenceTypeName extends string, TInput, TOutput>({
      id,
      context,
      complete: completeCallback,
    }: {
      id: string;
      typeName: TSequenceTypeName;
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
    }): Promise<JobSequence<string, TSequenceTypeName, TInput, TOutput>> => {
      await assertInTransaction(context);

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

        let continuedJob: Job<any, any, any, any, any[]> | null = null;

        const output = await jobCompleteCallback({
          continueWith: async ({ typeName, input, schedule, startBlockers }) => {
            if (continuedJob) {
              throw new Error("continueWith can only be called once");
            }

            continuedJob = await withJobContext(
              {
                originId: job.originId ?? job.id,
                sequenceId: job.sequenceId,
                rootSequenceId: job.rootSequenceId,
                sequenceTypeName: job.sequenceTypeName,
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

                return mapStateJobToJob(newJob) as Job<any, any, any, any, any[]>;
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
    waitForJobSequenceCompletion: async <TSequenceTypeName extends string, TInput, TOutput>({
      id,
      timeoutMs,
      pollIntervalMs = 15_000,
      signal,
    }: {
      id: string;
      typeName: TSequenceTypeName;
      timeoutMs: number;
      pollIntervalMs?: number;
      signal?: AbortSignal;
    }): Promise<CompletedJobSequence<JobSequence<string, TSequenceTypeName, TInput, TOutput>>> => {
      const checkSequence = async (): Promise<CompletedJobSequence<
        JobSequence<string, TSequenceTypeName, TInput, TOutput>
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
              JobSequence<string, TSequenceTypeName, TInput, TOutput>
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
      } catch {}
      try {
        while (!combinedSignal.aborted) {
          await raceWithSleep(notificationPromise, pollIntervalMs, { signal: combinedSignal });
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
  TStateAdapter extends StateAdapter<any, any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TSequenceTypeName extends keyof ExternalJobTypeDefinitions<TJobTypeDefinitions> & string,
  TCompleteReturn,
> = (options: {
  job: SequenceJobs<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TSequenceTypeName>;
  complete: <
    TJobTypeName extends SequenceJobTypes<TJobTypeDefinitions, TSequenceTypeName> & string,
    TReturn extends
      | TJobTypeDefinitions[TJobTypeName]["output"]
      | ContinuationJobs<
          GetStateAdapterJobId<TStateAdapter>,
          TJobTypeDefinitions,
          TJobTypeName,
          TSequenceTypeName
        >
      | Promise<TJobTypeDefinitions[TJobTypeName]["output"]>
      | Promise<
          ContinuationJobs<
            GetStateAdapterJobId<TStateAdapter>,
            TJobTypeDefinitions,
            TJobTypeName,
            TSequenceTypeName
          >
        >,
  >(
    job: JobOf<
      GetStateAdapterJobId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      TSequenceTypeName
    >,
    completeCallback: (
      completeOptions: CompleteCallbackOptions<
        TStateAdapter,
        TJobTypeDefinitions,
        TJobTypeName,
        TSequenceTypeName
      >,
    ) => TReturn,
  ) => Promise<Awaited<TReturn>>;
}) => Promise<TCompleteReturn>;

export type CompleteJobSequenceResult<
  TStateAdapter extends StateAdapter<any, any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TSequenceTypeName extends keyof TJobTypeDefinitions & string,
  TCompleteReturn,
> = [TCompleteReturn] extends [void]
  ? JobSequenceOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TSequenceTypeName>
  : TCompleteReturn extends Job<any, any, any, any, any[]>
    ? JobSequenceOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TSequenceTypeName>
    : CompletedJobSequence<
        JobSequence<
          GetStateAdapterJobId<TStateAdapter>,
          TSequenceTypeName,
          TJobTypeDefinitions[TSequenceTypeName]["input"],
          TCompleteReturn
        >
      >;
