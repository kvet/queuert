import { type JobChain, mapStateJobPairToJobChain } from "./entities/job-chain.js";
import { type JobTypeRegistry } from "./entities/job-type-registry.js";
import { type BaseJobTypeDefinitions, type JobOf } from "./entities/job-type.js";
import { type Job, mapStateJobToJob } from "./entities/job.js";
import { type ScheduleOptions } from "./entities/schedule.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
} from "./errors.js";
import { type BackoffConfig, calculateBackoffMs } from "./helpers/backoff.js";
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
    blockers,
    isChain,
    chainId,
    chainIndex,
    chainTypeName,
    originTraceContext,
    deduplication,
    schedule,
  }: {
    typeName: string;
    input: unknown;
    txContext: BaseTxContext;
    blockers?: JobChain<any, any, any, any>[];
    isChain: boolean;
    chainId?: string;
    chainIndex: number;
    chainTypeName?: string;
    originTraceContext?: unknown;
    deduplication?: DeduplicationOptions;
    schedule?: ScheduleOptions;
  }): Promise<{ job: StateJob; deduplicated: boolean }> => {
    if (isChain) {
      registry.validateEntry(typeName);
    }

    const parsedInput = registry.parseInput(typeName, input);

    const resolvedChainTypeName = isChain ? typeName : chainTypeName!;

    const spanHandle = observabilityHelper.startJobSpan({
      chainTypeName: resolvedChainTypeName,
      jobTypeName: typeName,
      isChainStart: isChain,
      originTraceContext: isChain ? undefined : originTraceContext,
    });

    let createJobResult: { job: StateJob; deduplicated: boolean };
    try {
      createJobResult = await stateAdapter.createJob({
        txContext,
        typeName,
        chainTypeName: resolvedChainTypeName,
        chainIndex,
        input: parsedInput,
        chainId: isChain ? undefined : chainId,
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
        existingTraceContext: job.traceContext,
      });
      return { job, deduplicated };
    }

    let blockerChains: JobChain<any, any, any, any>[] = [];
    let incompleteBlockerChainIds: string[] = [];
    if (blockers && blockers.length > 0) {
      blockerChains = blockers;
      const blockerChainIds = blockerChains.map((b) => b.id);

      const blockerSpanHandles = blockerChains.map((blocker, i) =>
        observabilityHelper.startBlockerSpan({
          chainId: job.chainId,
          chainTypeName: resolvedChainTypeName,
          jobId: job.id,
          jobTypeName: typeName,
          jobTraceContext: spanHandle?.getTraceContext(),
          blockerChainId: blocker.id,
          blockerChainTypeName: blocker.typeName,
          blockerIndex: i,
        }),
      );

      const addBlockersResult = await stateAdapter.addJobBlockers({
        txContext,
        jobId: job.id,
        blockedByChainIds: blockerChainIds,
        blockerTraceContexts: blockerSpanHandles.map((h) => h?.getTraceContext() ?? null),
      });
      job = addBlockersResult.job;
      incompleteBlockerChainIds = addBlockersResult.incompleteBlockerChainIds;

      const incompleteSet = new Set(incompleteBlockerChainIds);
      blockerSpanHandles.forEach((handle, i) => {
        if (!handle) return;
        handle.end({ blockerTraceContext: addBlockersResult.blockerChainTraceContexts[i] });
        if (!incompleteSet.has(blockerChainIds[i])) {
          observabilityHelper.completeBlockerSpan({
            traceContext: handle.getTraceContext(),
            blockerChainTypeName: blockerChains[i].typeName,
          });
        }
      });
    }

    const blockerRefs = blockerChains.map((b) => ({ typeName: b.typeName, input: b.input }));
    registry.validateBlockers(typeName, blockerRefs);

    spanHandle?.end({
      status: "created",
      chainId: job.chainId,
      jobId: job.id,
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
    blockers,
    chainId,
    chainIndex,
    chainTypeName,
    originTraceContext,
    fromTypeName,
  }: {
    typeName: TJobTypeName;
    input: TInput;
    txContext: any;
    schedule?: ScheduleOptions;
    blockers?: JobChain<any, any, any, any>[];
    chainId: string;
    chainIndex: number;
    chainTypeName: string;
    originTraceContext: unknown;
    fromTypeName: string;
  }): Promise<JobOf<string, BaseJobTypeDefinitions, TJobTypeName, string>> => {
    registry.validateContinueWith(fromTypeName, { typeName, input });

    const { job } = await createStateJob({
      typeName,
      input,
      txContext,
      blockers,
      isChain: false,
      chainId,
      chainIndex,
      chainTypeName,
      originTraceContext,
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

    if (workerId === null) {
      observabilityHelper.completeJobSpan(job, {
        continued: hasContinuedJob ? rest.continuedJob : undefined,
        chainCompleted: !hasContinuedJob,
      });
    }

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

      const { unblockedJobs, blockerTraceContexts } = await stateAdapter.scheduleBlockedJobs({
        txContext,
        blockedByChainId: jobChainStartJob.id,
      });
      for (const traceContext of blockerTraceContexts) {
        observabilityHelper.completeBlockerSpan({
          traceContext,
          blockerChainTypeName: jobChainStartJob.chainTypeName,
        });
      }

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
    startJobChain: async <TChainTypeName extends string, TInput, TOutput>({
      typeName,
      input,
      txContext,
      deduplication,
      schedule,
      blockers,
    }: {
      typeName: TChainTypeName;
      input: TInput;
      txContext: any;
      deduplication?: DeduplicationOptions;
      schedule?: ScheduleOptions;
      blockers?: JobChain<any, any, any, any>[];
    }): Promise<JobChain<string, TChainTypeName, TInput, TOutput> & { deduplicated: boolean }> => {
      const { job, deduplicated } = await createStateJob({
        typeName,
        input,
        txContext,
        blockers,
        isChain: true,
        chainIndex: 0,
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
      blockers,
      chainId,
      chainIndex,
      chainTypeName,
      originTraceContext,
      fromTypeName,
    }: {
      typeName: TJobTypeName;
      input: TInput;
      txContext: any;
      schedule?: ScheduleOptions;
      blockers?: JobChain<any, any, any, any>[];
      chainId: string;
      chainIndex: number;
      chainTypeName: string;
      originTraceContext: unknown;
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
