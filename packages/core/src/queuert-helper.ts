import { AsyncLocalStorage } from "node:async_hooks";
import { UUID } from "node:crypto";
import { CompletedJobChain, JobChain, mapStateJobPairToJobChain } from "./entities/job-chain.js";
import {
  BaseJobTypeDefinitions,
  BlockerChains,
  ChainJobs,
  ChainJobTypes,
  ContinuationJobs,
  EntryJobTypeDefinitions,
  JobChainOf,
  JobOf,
} from "./entities/job-type.js";
import { Job, JobWithoutBlockers, mapStateJobToJob, PendingJob } from "./entities/job.js";
import { ScheduleOptions } from "./entities/schedule.js";
import { BackoffConfig, calculateBackoffMs } from "./helpers/backoff.js";
import { raceWithSleep } from "./helpers/sleep.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { createNoopNotifyAdapter } from "./notify-adapter/notify-adapter.noop.js";
import { wrapNotifyAdapterWithLogging } from "./notify-adapter/notify-adapter.wrapper.logging.js";
import { Log } from "./observability-adapter/log.js";
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
  TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string =
    keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
> = (options: {
  job: PendingJob<
    JobWithoutBlockers<JobOf<TJobId, TJobTypeDefinitions, TJobTypeName, TChainTypeName>>
  >;
}) => Promise<BlockerChains<TJobId, TJobTypeDefinitions, TJobTypeName>>;

const notifyCompletionStorage = new AsyncLocalStorage<{
  storeId: UUID;
  jobTypeCounts: Map<string, number>;
  chainIds: Set<string>;
  jobOwnershipLostIds: Set<string>;
}>();
const jobContextStorage = new AsyncLocalStorage<{
  storeId: UUID;
  chainId: string;
  chainTypeName: string;
  rootChainId: string;
  originId: string;
}>();

export class JobTakenByAnotherWorkerError extends Error {
  readonly jobId: string | undefined;
  readonly workerId: string | undefined;
  readonly leasedBy: string | null | undefined;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JobTakenByAnotherWorkerError";
    const causeObj = options?.cause as
      | { jobId?: string; workerId?: string; leasedBy?: string | null }
      | undefined;
    this.jobId = causeObj?.jobId;
    this.workerId = causeObj?.workerId;
    this.leasedBy = causeObj?.leasedBy;
  }
}

export class JobNotFoundError extends Error {
  readonly jobId: string | undefined;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JobNotFoundError";
    const causeObj = options?.cause as { jobId?: string } | undefined;
    this.jobId = causeObj?.jobId;
  }
}

export class JobAlreadyCompletedError extends Error {
  readonly jobId: string | undefined;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JobAlreadyCompletedError";
    const causeObj = options?.cause as { jobId?: string } | undefined;
    this.jobId = causeObj?.jobId;
  }
}

export class WaitForJobChainCompletionTimeoutError extends Error {
  readonly chainId: string | undefined;
  readonly timeoutMs: number | undefined;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WaitForJobChainCompletionTimeoutError";
    const causeObj = options?.cause as { chainId?: string; timeoutMs?: number } | undefined;
    this.chainId = causeObj?.chainId;
    this.timeoutMs = causeObj?.timeoutMs;
  }
}

export class StateNotInTransactionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StateNotInTransactionError";
  }
}

export type JobTypeValidationErrorCode =
  | "not_entry_point"
  | "invalid_continuation"
  | "invalid_blockers"
  | "invalid_input"
  | "invalid_output";

export class JobTypeValidationError extends Error {
  readonly code: JobTypeValidationErrorCode;
  readonly typeName: string;
  readonly details: Record<string, unknown>;

  constructor(options: {
    code: JobTypeValidationErrorCode;
    message: string;
    typeName: string;
    details?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = "JobTypeValidationError";
    this.code = options.code;
    this.typeName = options.typeName;
    this.details = options.details ?? {};
  }
}

import { JobTypeRegistry } from "./entities/job-type-registry.js";
import { wrapJobTypeRegistryWithLogging } from "./entities/job-type-registry.wrapper.logging.js";

export const queuertHelper = ({
  stateAdapter: stateAdapterOption,
  notifyAdapter: notifyAdapterOption,
  observabilityAdapter: observabilityAdapterOption,
  jobTypeRegistry,
  log,
}: {
  stateAdapter: StateAdapter<BaseStateAdapterContext, BaseStateAdapterContext, any>;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  jobTypeRegistry: JobTypeRegistry;
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
  const registry = wrapJobTypeRegistryWithLogging({
    registry: jobTypeRegistry,
    observabilityHelper,
  });

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
    isChain,
    deduplication,
    schedule,
  }: {
    typeName: string;
    input: unknown;
    context: BaseStateAdapterContext;
    startBlockers?: StartBlockersFn<string, BaseJobTypeDefinitions, string>;
    isChain: boolean;
    deduplication?: DeduplicationOptions;
    schedule?: ScheduleOptions;
  }): Promise<{ job: StateJob; deduplicated: boolean }> => {
    if (isChain) {
      registry.validateEntry(typeName);
    }

    const parsedInput = registry.parseInput(typeName, input);

    const jobContext = jobContextStorage.getStore();
    const createJobResult = await stateAdapter.createJob({
      context,
      typeName,
      chainTypeName: isChain ? typeName : jobContext!.chainTypeName,
      input: parsedInput,
      originId: jobContext?.originId,
      chainId: isChain ? undefined : jobContext!.chainId,
      rootChainId: isChain ? jobContext?.rootChainId : jobContext!.rootChainId,
      deduplication,
      schedule,
    });
    let job = createJobResult.job;
    const deduplicated = createJobResult.deduplicated;

    if (deduplicated) {
      return { job, deduplicated };
    }

    let blockerChains: JobChain<any, any, any, any>[] = [];
    let incompleteBlockerChainIds: string[] = [];
    if (startBlockers) {
      const blockers = await withJobContext(
        {
          chainId: job.chainId,
          chainTypeName: job.chainTypeName,
          rootChainId: job.rootChainId,
          originId: job.id,
        },
        async () => startBlockers({ job: mapStateJobToJob(job) as any }),
      );

      blockerChains = [...blockers] as JobChain<any, any, any, any>[];
      const blockerChainIds = blockerChains.map((b) => b.id);

      const addBlockersResult = await stateAdapter.addJobBlockers({
        context,
        jobId: job.id,
        blockedByChainIds: blockerChainIds,
      });
      job = addBlockersResult.job;
      incompleteBlockerChainIds = addBlockersResult.incompleteBlockerChainIds;
    }

    const blockerRefs = blockerChains.map((b) => ({ typeName: b.typeName, input: b.input }));
    registry.validateBlockers(typeName, blockerRefs);

    if (isChain) {
      observabilityHelper.jobChainCreated(job, { input });
    }

    observabilityHelper.jobCreated(job, { input, blockers: blockerChains, schedule });

    if (incompleteBlockerChainIds.length > 0) {
      const incompleteBlockerSet = new Set(incompleteBlockerChainIds);
      const incompleteBlockerChains = blockerChains.filter((b) => incompleteBlockerSet.has(b.id));
      observabilityHelper.jobBlocked(job, { blockedByChains: incompleteBlockerChains });
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

  const notifyChainCompletion = (job: StateJob): void => {
    const store = notifyCompletionStorage.getStore();
    if (store) {
      store.chainIds.add(job.chainId);
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
      chainIds: new Set<string>(),
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
        ...Array.from(store.chainIds).map(async (chainId) => {
          try {
            await notifyAdapter.notifyJobChainCompleted(chainId);
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
      chainId: string;
      rootChainId: string;
      chainTypeName: string;
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

  const continueWith = async <TJobTypeName extends string, TInput>({
    typeName,
    input,
    context,
    schedule,
    startBlockers,
    fromTypeName,
  }: {
    typeName: TJobTypeName;
    input: TInput;
    context: any;
    schedule?: ScheduleOptions;
    startBlockers?: StartBlockersFn<string, BaseJobTypeDefinitions, string>;
    fromTypeName: string;
  }): Promise<JobOf<string, BaseJobTypeDefinitions, TJobTypeName, string>> => {
    registry.validateContinueWith(fromTypeName, { typeName, input });

    const { job } = await createStateJob({
      typeName,
      input,
      context,
      startBlockers,
      isChain: false,
      schedule,
    });

    return mapStateJobToJob(job) as JobOf<string, BaseJobTypeDefinitions, TJobTypeName, string>;
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
    | { type: "completeChain"; output: unknown }
    | { type: "continueWith"; continuedJob: Job<any, any, any, any, any[]> }
  )): Promise<StateJob> => {
    const hasContinuedJob = rest.type === "continueWith";
    let output = hasContinuedJob ? null : rest.output;

    if (!hasContinuedJob) {
      output = registry.parseOutput(job.typeName, output);
    }

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
    observabilityHelper.jobDuration(job);

    if (!hasContinuedJob) {
      const jobChainStartJob = await stateAdapter.getJobById({
        context,
        jobId: job.chainId,
      });

      if (!jobChainStartJob) {
        throw new JobNotFoundError(`Job chain with id ${job.chainId} not found`);
      }

      observabilityHelper.jobChainCompleted(jobChainStartJob, { output });
      observabilityHelper.jobChainDuration(jobChainStartJob, job);
      notifyChainCompletion(job);

      const unblockedJobs = await stateAdapter.scheduleBlockedJobs({
        context,
        blockedByChainId: jobChainStartJob.id,
      });

      if (unblockedJobs.length > 0) {
        unblockedJobs.forEach((unblockedJob) => {
          notifyJobScheduled(unblockedJob);
          observabilityHelper.jobUnblocked(unblockedJob, {
            unblockedByChain: jobChainStartJob,
          });
        });
      }
    }

    return job;
  };

  return {
    // oxlint-disable-next-line no-unnecessary-type-assertion -- needed for --isolatedDeclarations
    stateAdapter: stateAdapter as StateAdapter<
      BaseStateAdapterContext,
      BaseStateAdapterContext,
      any
    >,
    // oxlint-disable-next-line no-unnecessary-type-assertion -- needed for --isolatedDeclarations
    notifyAdapter: notifyAdapter as NotifyAdapter,
    // oxlint-disable-next-line no-unnecessary-type-assertion -- needed for --isolatedDeclarations
    observabilityHelper: observabilityHelper as ObservabilityHelper,
    withNotifyContext: withNotifyContext as <T>(cb: () => Promise<T>) => Promise<T>,
    withJobContext: withJobContext as <T>(
      context: {
        chainId: string;
        chainTypeName: string;
        rootChainId: string;
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
    startJobChain: async <TChainTypeName extends string, TInput, TOutput>({
      typeName,
      input,
      context,
      deduplication,
      schedule,
      startBlockers,
    }: {
      typeName: TChainTypeName;
      input: TInput;
      context: any;
      deduplication?: DeduplicationOptions;
      schedule?: ScheduleOptions;
      startBlockers?: StartBlockersFn<string, BaseJobTypeDefinitions, string>;
    }): Promise<JobChain<string, TChainTypeName, TInput, TOutput> & { deduplicated: boolean }> => {
      await assertInTransaction(context);

      const { job, deduplicated } = await createStateJob({
        typeName,
        input,
        context,
        startBlockers,
        isChain: true,
        deduplication,
        schedule,
      });

      return { ...mapStateJobPairToJobChain([job, undefined]), deduplicated };
    },
    getJobChain: async <TChainTypeName extends string, TInput, TOutput>({
      id,
      context,
    }: {
      id: string;
      typeName: TChainTypeName;
      context: any;
    }): Promise<JobChain<string, TChainTypeName, TInput, TOutput> | null> => {
      const jobChain = await stateAdapter.getJobChainById({
        context,
        jobId: id,
      });

      return jobChain ? mapStateJobPairToJobChain(jobChain) : null;
    },
    continueWith: continueWith as <TJobTypeName extends string, TInput>({
      typeName,
      input,
      context,
      schedule,
      startBlockers,
      fromTypeName,
    }: {
      typeName: TJobTypeName;
      input: TInput;
      context: any;
      schedule?: ScheduleOptions;
      startBlockers?: StartBlockersFn<string, BaseJobTypeDefinitions, string>;
      fromTypeName: string;
    }) => Promise<JobOf<string, BaseJobTypeDefinitions, TJobTypeName, string>>,
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
        | { type: "completeChain"; output: unknown }
        | { type: "continueWith"; continuedJob: Job<any, any, any, any, any[]> }
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
        observabilityHelper.jobAttemptAlreadyCompleted(fetchedJob, { workerId });
        throw new JobAlreadyCompletedError("Job is already completed", {
          cause: { jobId: fetchedJob.id },
        });
      }

      if (
        fetchedJob.leasedBy !== workerId &&
        !(allowEmptyWorker ? fetchedJob.leasedBy === null : false)
      ) {
        observabilityHelper.jobAttemptTakenByAnotherWorker(fetchedJob, { workerId });
        throw new JobTakenByAnotherWorkerError(`Job taken by another worker`, {
          cause: {
            jobId: fetchedJob.id,
            workerId,
            leasedBy: fetchedJob.leasedBy,
          },
        });
      }

      if (fetchedJob.leasedUntil && fetchedJob.leasedUntil.getTime() < Date.now()) {
        observabilityHelper.jobAttemptLeaseExpired(fetchedJob, { workerId });
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
    deleteJobChains: async ({
      rootChainIds,
      context,
    }: {
      rootChainIds: string[];
      context: BaseStateAdapterContext;
    }): Promise<void> => {
      await assertInTransaction(context);

      const chainJobs = await Promise.all(
        rootChainIds.map(async (chainId) =>
          stateAdapter.getJobById({
            context,
            jobId: chainId,
          }),
        ),
      );

      for (let i = 0; i < rootChainIds.length; i++) {
        const chainJob = chainJobs[i];
        const chainId = rootChainIds[i];

        if (!chainJob) {
          throw new JobNotFoundError(`Job chain with id ${chainId} not found`);
        }

        if (chainJob.rootChainId !== chainJob.id) {
          throw new Error(
            `Cannot delete job chain ${chainId}: must delete from the root chain (rootChainId: ${chainJob.rootChainId})`,
          );
        }
      }

      const externalBlockers = await stateAdapter.getExternalBlockers({
        context,
        rootChainIds,
      });

      if (externalBlockers.length > 0) {
        const uniqueBlockedRootIds = [
          ...new Set(externalBlockers.map((b) => b.blockedRootChainId)),
        ];
        throw new Error(
          `Cannot delete job chains: external job chains depend on them. ` +
            `Include the following root chains in the deletion: ${uniqueBlockedRootIds.join(", ")}`,
        );
      }

      await stateAdapter.deleteJobsByRootChainIds({
        context,
        rootChainIds,
      });
    },
    completeJobChain: async <TChainTypeName extends string, TInput, TOutput>({
      id,
      context,
      complete: completeCallback,
    }: {
      id: string;
      typeName: TChainTypeName;
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
    }): Promise<JobChain<string, TChainTypeName, TInput, TOutput>> => {
      await assertInTransaction(context);

      const currentJob = await stateAdapter.getCurrentJobForUpdate({
        context,
        chainId: id,
      });

      if (!currentJob) {
        throw new JobNotFoundError(`Job chain with id ${id} not found`);
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
            { cause: { jobId: job.id } },
          );
        }

        let continuedJob: Job<any, any, any, any, any[]> | null = null;

        const output = await jobCompleteCallback({
          continueWith: async ({ typeName, input, schedule, startBlockers }) => {
            if (continuedJob) {
              throw new Error("continueWith can only be called once");
            }

            return withJobContext(
              {
                originId: job.id,
                chainId: job.chainId,
                rootChainId: job.rootChainId,
                chainTypeName: job.chainTypeName,
              },
              async () =>
                continueWith({
                  typeName,
                  input,
                  context,
                  schedule,
                  startBlockers: startBlockers as any,
                  fromTypeName: job.typeName,
                }),
            );
          },
          ...context,
        });

        const wasRunning = job.status === "running";

        await finishJob(
          continuedJob
            ? { job, context, workerId: null, type: "continueWith", continuedJob }
            : { job, context, workerId: null, type: "completeChain", output },
        );

        if (wasRunning) {
          notifyJobOwnershipLost(job.id);
        }

        return continuedJob ?? output;
      };

      await completeCallback({ job: currentJob, complete });

      const updatedChain = await stateAdapter.getJobChainById({
        context,
        jobId: id,
      });

      if (!updatedChain) {
        throw new JobNotFoundError(`Job chain with id ${id} not found after complete`);
      }

      return mapStateJobPairToJobChain(updatedChain);
    },
    waitForJobChainCompletion: async <TChainTypeName extends string, TInput, TOutput>({
      id,
      timeoutMs,
      pollIntervalMs = 15_000,
      signal,
    }: {
      id: string;
      typeName: TChainTypeName;
      timeoutMs: number;
      pollIntervalMs?: number;
      signal?: AbortSignal;
    }): Promise<CompletedJobChain<JobChain<string, TChainTypeName, TInput, TOutput>>> => {
      const checkChain = async (): Promise<CompletedJobChain<
        JobChain<string, TChainTypeName, TInput, TOutput>
      > | null> => {
        const chain = await stateAdapter.provideContext(async (context) =>
          stateAdapter.getJobChainById({ context, jobId: id }),
        );
        if (!chain) {
          throw new JobNotFoundError(`Job chain with id ${id} not found`);
        }
        const jobChain = mapStateJobPairToJobChain(chain);
        return jobChain.status === "completed"
          ? (jobChain as CompletedJobChain<JobChain<string, TChainTypeName, TInput, TOutput>>)
          : null;
      };

      const completedChain = await checkChain();
      if (completedChain) {
        return completedChain;
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
        dispose = await notifyAdapter.listenJobChainCompleted(id, () => {
          resolveNotification?.();
        });
      } catch {}
      try {
        while (!combinedSignal.aborted) {
          await raceWithSleep(notificationPromise, pollIntervalMs, { signal: combinedSignal });
          resetNotificationPromise();

          const chain = await checkChain();
          if (chain) return chain;

          if (combinedSignal.aborted) break;
        }

        throw new WaitForJobChainCompletionTimeoutError(
          signal?.aborted
            ? `Wait for job chain ${id} was aborted`
            : `Timeout waiting for job chain ${id} to complete after ${timeoutMs}ms`,
          { cause: { chainId: id, timeoutMs } },
        );
      } finally {
        await dispose();
      }
    },
  };
};
export type ProcessHelper = ReturnType<typeof queuertHelper>;

export type JobChainCompleteOptions<
  TStateAdapter extends StateAdapter<any, any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
  TCompleteReturn,
> = (options: {
  job: ChainJobs<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>;
  complete: <
    TJobTypeName extends ChainJobTypes<TJobTypeDefinitions, TChainTypeName> & string,
    TReturn extends
      | TJobTypeDefinitions[TJobTypeName]["output"]
      | ContinuationJobs<
          GetStateAdapterJobId<TStateAdapter>,
          TJobTypeDefinitions,
          TJobTypeName,
          TChainTypeName
        >
      | Promise<TJobTypeDefinitions[TJobTypeName]["output"]>
      | Promise<
          ContinuationJobs<
            GetStateAdapterJobId<TStateAdapter>,
            TJobTypeDefinitions,
            TJobTypeName,
            TChainTypeName
          >
        >,
  >(
    job: JobOf<
      GetStateAdapterJobId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName
    >,
    completeCallback: (
      completeOptions: CompleteCallbackOptions<
        TStateAdapter,
        TJobTypeDefinitions,
        TJobTypeName,
        TChainTypeName
      >,
    ) => TReturn,
  ) => Promise<Awaited<TReturn>>;
}) => Promise<TCompleteReturn>;

export type CompleteJobChainResult<
  TStateAdapter extends StateAdapter<any, any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends keyof TJobTypeDefinitions & string,
  TCompleteReturn,
> = [TCompleteReturn] extends [void]
  ? JobChainOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>
  : TCompleteReturn extends Job<any, any, any, any, any[]>
    ? JobChainOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>
    : CompletedJobChain<
        JobChain<
          GetStateAdapterJobId<TStateAdapter>,
          TChainTypeName,
          TJobTypeDefinitions[TChainTypeName]["input"],
          TCompleteReturn
        >
      >;
