import { AsyncLocalStorage } from "node:async_hooks";
import { type UUID } from "node:crypto";
import {
  type CompletedJobChain,
  type JobChain,
  mapStateJobPairToJobChain,
} from "./entities/job-chain.js";
import { type JobTypeRegistry } from "./entities/job-type-registry.js";
import { wrapJobTypeRegistryWithLogging } from "./entities/job-type-registry.wrapper.logging.js";
import {
  type BaseJobTypeDefinitions,
  type BlockerChains,
  type ChainJobTypes,
  type ChainJobs,
  type ContinuationJobs,
  type EntryJobTypeDefinitions,
  type JobChainOf,
  type JobOf,
} from "./entities/job-type.js";
import {
  type Job,
  type JobWithoutBlockers,
  type PendingJob,
  mapStateJobToJob,
} from "./entities/job.js";
import { type ScheduleOptions } from "./entities/schedule.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
  WaitForJobChainCompletionTimeoutError,
} from "./errors.js";
import { type BackoffConfig, calculateBackoffMs } from "./helpers/backoff.js";
import { raceWithSleep } from "./helpers/sleep.js";
import { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { createNoopNotifyAdapter } from "./notify-adapter/notify-adapter.noop.js";
import { wrapNotifyAdapterWithLogging } from "./notify-adapter/notify-adapter.wrapper.logging.js";
import { type Log } from "./observability-adapter/log.js";
import { type ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import { createNoopObservabilityAdapter } from "./observability-adapter/observability-adapter.noop.js";
import {
  type ObservabilityHelper,
  createObservabilityHelper,
} from "./observability-adapter/observability-helper.js";
import {
  type BaseTxContext,
  type DeduplicationOptions,
  type GetStateAdapterJobId,
  type StateAdapter,
  type StateJob,
} from "./state-adapter/state-adapter.js";
import { wrapStateAdapterWithLogging } from "./state-adapter/state-adapter.wrapper.logging.js";
import { type CompleteCallbackOptions, RescheduleJobError } from "./worker/job-process.js";

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

export const queuertHelper = ({
  stateAdapter: stateAdapterOption,
  notifyAdapter: notifyAdapterOption,
  observabilityAdapter: observabilityAdapterOption,
  registry: registryOption,
  log,
}: {
  stateAdapter: StateAdapter<BaseTxContext, any>;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  registry: JobTypeRegistry;
  log?: Log;
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
    registry: registryOption,
    observabilityHelper,
  });

  const createStateJob = async ({
    typeName,
    input,
    txContext,
    startBlockers,
    isChain,
    deduplication,
    schedule,
  }: {
    typeName: string;
    input: unknown;
    txContext: BaseTxContext;
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
      txContext,
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
        txContext,
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
    txContext,
    schedule,
    startBlockers,
    fromTypeName,
  }: {
    typeName: TJobTypeName;
    input: TInput;
    txContext: any;
    schedule?: ScheduleOptions;
    startBlockers?: StartBlockersFn<string, BaseJobTypeDefinitions, string>;
    fromTypeName: string;
  }): Promise<JobOf<string, BaseJobTypeDefinitions, TJobTypeName, string>> => {
    registry.validateContinueWith(fromTypeName, { typeName, input });

    const { job } = await createStateJob({
      typeName,
      input,
      txContext,
      startBlockers,
      isChain: false,
      schedule,
    });

    return mapStateJobToJob(job) as JobOf<string, BaseJobTypeDefinitions, TJobTypeName, string>;
  };

  const finishJob = async ({
    job,
    txContext,
    workerId,
    ...rest
  }: {
    job: StateJob;
    txContext: BaseTxContext;
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
      txContext,
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
        txContext,
        jobId: job.chainId,
      });

      if (!jobChainStartJob) {
        throw new JobNotFoundError(`Job chain with id ${job.chainId} not found`);
      }

      observabilityHelper.jobChainCompleted(jobChainStartJob, { output });
      observabilityHelper.jobChainDuration(jobChainStartJob, job);
      notifyChainCompletion(job);

      const unblockedJobs = await stateAdapter.scheduleBlockedJobs({
        txContext,
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
    stateAdapter: stateAdapter as StateAdapter<BaseTxContext, any>,
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
    startJobChain: async <TChainTypeName extends string, TInput, TOutput>({
      typeName,
      input,
      txContext,
      deduplication,
      schedule,
      startBlockers,
    }: {
      typeName: TChainTypeName;
      input: TInput;
      txContext: any;
      deduplication?: DeduplicationOptions;
      schedule?: ScheduleOptions;
      startBlockers?: StartBlockersFn<string, BaseJobTypeDefinitions, string>;
    }): Promise<JobChain<string, TChainTypeName, TInput, TOutput> & { deduplicated: boolean }> => {
      const { job, deduplicated } = await createStateJob({
        typeName,
        input,
        txContext,
        startBlockers,
        isChain: true,
        deduplication,
        schedule,
      });

      return { ...mapStateJobPairToJobChain([job, undefined]), deduplicated };
    },
    getJobChain: async <TChainTypeName extends string, TInput, TOutput>({
      id,
      txContext,
    }: {
      id: string;
      typeName: TChainTypeName;
      txContext: any;
    }): Promise<JobChain<string, TChainTypeName, TInput, TOutput> | null> => {
      const jobChain = await stateAdapter.getJobChainById({
        txContext,
        jobId: id,
      });

      return jobChain ? mapStateJobPairToJobChain(jobChain) : null;
    },
    continueWith: continueWith as <TJobTypeName extends string, TInput>({
      typeName,
      input,
      txContext,
      schedule,
      startBlockers,
      fromTypeName,
    }: {
      typeName: TJobTypeName;
      input: TInput;
      txContext: any;
      schedule?: ScheduleOptions;
      startBlockers?: StartBlockersFn<string, BaseJobTypeDefinitions, string>;
      fromTypeName: string;
    }) => Promise<JobOf<string, BaseJobTypeDefinitions, TJobTypeName, string>>,
    handleJobHandlerError: async ({
      job,
      error,
      txContext,
      retryConfig,
      workerId,
    }: {
      job: StateJob;
      error: unknown;
      txContext: BaseTxContext;
      retryConfig: BackoffConfig;
      workerId: string;
    }): Promise<void> => {
      if (
        error instanceof JobTakenByAnotherWorkerError ||
        error instanceof JobAlreadyCompletedError ||
        error instanceof JobNotFoundError
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
        txContext,
        jobId: job.id,
        schedule,
        error: errorString,
      });
    },
    finishJob: finishJob as (
      options: {
        job: StateJob;
        txContext: BaseTxContext;
        workerId: string | null;
      } & (
        | { type: "completeChain"; output: unknown }
        | { type: "continueWith"; continuedJob: Job<any, any, any, any, any[]> }
      ),
    ) => Promise<StateJob>,
    refetchJobForUpdate: async ({
      txContext,
      job,
      workerId,
      allowEmptyWorker,
    }: {
      txContext: BaseTxContext;
      job: StateJob;
      workerId: string;
      allowEmptyWorker: boolean;
    }): Promise<StateJob> => {
      const fetchedJob = await stateAdapter.getJobForUpdate({
        txContext,
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
    getNextJobAvailableInMs: async ({
      typeNames,
      pollIntervalMs,
    }: {
      typeNames: string[];
      pollIntervalMs: number;
    }): Promise<number> => {
      const nextJobAvailableInMs = await stateAdapter.getNextJobAvailableInMs({
        typeNames,
      });

      return nextJobAvailableInMs !== null
        ? Math.min(Math.max(0, nextJobAvailableInMs), pollIntervalMs)
        : pollIntervalMs;
    },
    removeExpiredJobLease: async ({
      typeNames,
      workerId,
      ignoredJobIds,
    }: {
      typeNames: string[];
      workerId: string;
      ignoredJobIds?: string[];
    }): Promise<boolean> => {
      const job = await stateAdapter.removeExpiredJobLease({ typeNames, ignoredJobIds });
      if (job) {
        observabilityHelper.jobReaped(job, { workerId });

        try {
          await notifyAdapter.notifyJobScheduled(job.typeName, 1);
        } catch {}
        try {
          await notifyAdapter.notifyJobOwnershipLost(job.id);
        } catch {}
      }
      return !!job;
    },
    deleteJobChains: async ({
      rootChainIds,
      txContext,
    }: {
      rootChainIds: string[];
      txContext: BaseTxContext;
    }): Promise<void> => {
      const chainJobs = await Promise.all(
        rootChainIds.map(async (chainId) =>
          stateAdapter.getJobById({
            txContext,
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
        txContext,
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
        txContext,
        rootChainIds,
      });
    },
    completeJobChain: async <TChainTypeName extends string, TInput, TOutput>({
      id,
      txContext,
      complete: completeCallback,
    }: {
      id: string;
      typeName: TChainTypeName;
      txContext: BaseTxContext;
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
            } & BaseTxContext,
          ) => unknown,
        ) => Promise<unknown>;
      }) => Promise<void>;
    }): Promise<JobChain<string, TChainTypeName, TInput, TOutput>> => {
      const currentJob = await stateAdapter.getCurrentJobForUpdate({
        txContext,
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
          } & BaseTxContext,
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
                  txContext,
                  schedule,
                  startBlockers: startBlockers as any,
                  fromTypeName: job.typeName,
                }),
            );
          },
          ...txContext,
        });

        const wasRunning = job.status === "running";

        await finishJob(
          continuedJob
            ? { job, txContext, workerId: null, type: "continueWith", continuedJob }
            : { job, txContext, workerId: null, type: "completeChain", output },
        );

        if (wasRunning) {
          notifyJobOwnershipLost(job.id);
        }

        return continuedJob ?? output;
      };

      await completeCallback({ job: currentJob, complete });

      const updatedChain = await stateAdapter.getJobChainById({
        txContext,
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
        const chain = await stateAdapter.getJobChainById({ jobId: id });
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

export type QueuertHelper = ReturnType<typeof queuertHelper>;

export type JobChainCompleteOptions<
  TStateAdapter extends StateAdapter<any, any>,
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
  TStateAdapter extends StateAdapter<any, any>,
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
