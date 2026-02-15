import { type JobChain, mapStateJobPairToJobChain } from "./entities/job-chain.js";
import { type JobTypeRegistry } from "./entities/job-type-registry.js";
import {
  type BaseJobTypeDefinitions,
  type BlockerChains,
  type EntryJobTypeDefinitions,
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
} from "./errors.js";
import { type BackoffConfig, calculateBackoffMs } from "./helpers/backoff.js";
import { jobContextStorage, withJobContext } from "./helpers/job-context.js";
import {
  notifyChainCompletion,
  notifyJobScheduled,
  withNotifyContext,
} from "./helpers/notify-context.js";
import { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { type Log } from "./observability-adapter/log.js";
import { type ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import { setupHelpers } from "./setup-helpers.js";
import {
  type BaseTxContext,
  type DeduplicationOptions,
  type StateAdapter,
  type StateJob,
} from "./state-adapter/state-adapter.js";
import { RescheduleJobError } from "./worker/job-process.js";

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

export const helper = ({
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
  const { stateAdapter, notifyAdapter, observabilityHelper, registry } = setupHelpers({
    stateAdapter: stateAdapterOption,
    notifyAdapter: notifyAdapterOption,
    observabilityAdapter: observabilityAdapterOption,
    registry: registryOption,
    log,
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
    const chainTypeName = isChain ? typeName : jobContext!.chainTypeName;

    const spanHandle = observabilityHelper.startJobSpan({
      chainTypeName,
      jobTypeName: typeName,
      isChainStart: isChain,
      originTraceContext: isChain ? undefined : jobContext?.originTraceContext,
      rootChainTraceContext: isChain ? jobContext?.originTraceContext : undefined,
    });

    let createJobResult: { job: StateJob; deduplicated: boolean };
    try {
      createJobResult = await stateAdapter.createJob({
        txContext,
        typeName,
        chainTypeName,
        input: parsedInput,
        originId: jobContext?.originId,
        chainId: isChain ? undefined : jobContext!.chainId,
        rootChainId: isChain ? jobContext?.rootChainId : jobContext!.rootChainId,
        deduplication,
        schedule,
        traceContext: spanHandle?.getTraceContext(),
      });
    } catch (error) {
      spanHandle?.end({ status: "error", error });
      throw error;
    }

    let job = createJobResult.job;
    const deduplicated = createJobResult.deduplicated;

    if (deduplicated) {
      spanHandle?.end({
        status: "deduplicated",
        chainId: job.chainId,
        jobId: job.id,
        rootChainId: job.rootChainId !== job.chainId ? job.rootChainId : null,
        existingTraceContext: job.traceContext,
      });
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
          originTraceContext: spanHandle?.getTraceContext(),
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

    spanHandle?.end({
      status: "created",
      chainId: job.chainId,
      jobId: job.id,
      rootChainId: job.rootChainId !== job.chainId ? job.rootChainId : null,
      originId: job.originId ?? null,
    });

    if (isChain) {
      observabilityHelper.jobChainCreated(job, { input });
    }

    observabilityHelper.jobCreated(job, { input, blockers: blockerChains, schedule });

    if (incompleteBlockerChainIds.length > 0) {
      const incompleteBlockerSet = new Set(incompleteBlockerChainIds);
      const incompleteBlockerChains = blockerChains.filter((b) => incompleteBlockerSet.has(b.id));
      observabilityHelper.jobBlocked(job, { blockedByChains: incompleteBlockerChains });
    }

    notifyJobScheduled(job, notifyAdapterOption, observabilityHelper);

    return { job, deduplicated };
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
          notifyJobScheduled(unblockedJob, notifyAdapterOption, observabilityHelper);
          observabilityHelper.jobUnblocked(unblockedJob, {
            unblockedByChain: jobChainStartJob,
          });
        });
      }
    }

    return job;
  };

  return {
    stateAdapter,
    notifyAdapter,
    observabilityHelper,
    withNotifyContext: (async <T>(cb: () => Promise<T>) =>
      withNotifyContext(notifyAdapter, cb)) as <T>(cb: () => Promise<T>) => Promise<T>,
    withJobContext: withJobContext as <T>(
      context: {
        chainId: string;
        chainTypeName: string;
        rootChainId: string;
        originId: string;
        originTraceContext: unknown;
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
    }): Promise<{
      schedule?: ScheduleOptions;
    }> => {
      if (
        error instanceof JobTakenByAnotherWorkerError ||
        error instanceof JobAlreadyCompletedError ||
        error instanceof JobNotFoundError
      ) {
        return {};
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

      return { schedule };
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
  };
};

export type Helper = ReturnType<typeof helper>;
