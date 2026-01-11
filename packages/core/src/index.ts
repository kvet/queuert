import {
  BaseJobTypeDefinitions,
  ExternalJobTypeDefinitions,
  HasBlockers,
  JobSequenceOf,
} from "./entities/job-type.js";
import { ScheduleOptions } from "./entities/schedule.js";
import { BackoffConfig } from "./helpers/backoff.js";
import { Log } from "./observability-adapter/log.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import {
  CompleteJobSequenceResult,
  JobSequenceCompleteOptions,
  queuertHelper,
  StartBlockersFn,
} from "./queuert-helper.js";
import {
  DeduplicationOptions,
  GetStateAdapterJobId,
  GetStateAdapterTxContext,
  StateAdapter,
} from "./state-adapter/state-adapter.js";
import { createExecutor, Executor, RegisteredJobTypes } from "./worker/executor.js";
import { JobProcessFn, LeaseConfig } from "./worker/job-process.js";

import { CompletedJobSequence } from "./entities/job-sequence.js";
export { type CompletedJobSequence, type JobSequence } from "./entities/job-sequence.js";
export {
  defineUnionJobTypes,
  type BaseJobTypeDefinitions,
  type DefineBlocker,
  type DefineContinuationInput,
  type DefineContinuationOutput,
  type DefineJobTypeDefinitions,
} from "./entities/job-type.js";
export { type ValidatedJobTypeDefinitions } from "./entities/job-type.validation.js";
export { type CompletedJob, type Job } from "./entities/job.js";
export { type ScheduleOptions } from "./entities/schedule.js";
export { type TypedAbortSignal } from "./helpers/abort.js";
export { type BackoffConfig } from "./helpers/backoff.js";
export { type RetryConfig } from "./helpers/retry.js";
export { createConsoleLog } from "./observability-adapter/log.console.js";
export { type Log } from "./observability-adapter/log.js";
export { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
export { type ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
export {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
  StateNotInTransactionError,
  WaitForJobSequenceCompletionTimeoutError,
} from "./queuert-helper.js";
export {
  type BaseStateAdapterContext,
  type DeduplicationOptions,
  type DeduplicationStrategy,
  type GetStateAdapterJobId,
  type StateAdapter,
  type StateJob,
} from "./state-adapter/state-adapter.js";
export {
  rescheduleJob,
  RescheduleJobError,
  type JobAbortReason,
  type LeaseConfig,
} from "./worker/job-process.js";

// In-process adapters
export { createInProcessNotifyAdapter } from "./notify-adapter/notify-adapter.in-process.js";
export {
  createInProcessStateAdapter,
  type InProcessContext,
  type InProcessStateAdapter,
} from "./state-adapter/state-adapter.in-process.js";

export type QueuertWorkerDefinition<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any, any>,
> = {
  implementJobType: <TJobTypeName extends keyof TJobTypeDefinitions & string>(options: {
    typeName: TJobTypeName;
    process: JobProcessFn<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;
    retryConfig?: BackoffConfig;
    leaseConfig?: LeaseConfig;
  }) => QueuertWorkerDefinition<TJobTypeDefinitions, TStateAdapter>;
  start: Executor;
};

export type Queuert<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any, any>,
> = {
  createWorker: () => QueuertWorkerDefinition<TJobTypeDefinitions, TStateAdapter>;
  startJobSequence: <
    TSequenceTypeName extends keyof ExternalJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    options: {
      typeName: TSequenceTypeName;
      input: TJobTypeDefinitions[TSequenceTypeName]["input"];
      deduplication?: DeduplicationOptions;
      schedule?: ScheduleOptions;
    } & (HasBlockers<TJobTypeDefinitions, TSequenceTypeName> extends true
      ? {
          startBlockers: StartBlockersFn<
            GetStateAdapterJobId<TStateAdapter>,
            TJobTypeDefinitions,
            TSequenceTypeName
          >;
        }
      : { startBlockers?: never }) &
      GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    JobSequenceOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TSequenceTypeName> & {
      deduplicated: boolean;
    }
  >;
  getJobSequence: <
    TSequenceTypeName extends keyof ExternalJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    options: {
      typeName: TSequenceTypeName;
      id: GetStateAdapterJobId<TStateAdapter>;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<JobSequenceOf<
    GetStateAdapterJobId<TStateAdapter>,
    TJobTypeDefinitions,
    TSequenceTypeName
  > | null>;
  deleteJobSequences: (
    options: {
      rootSequenceIds: GetStateAdapterJobId<TStateAdapter>[];
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<void>;
  completeJobSequence: <
    TSequenceTypeName extends keyof ExternalJobTypeDefinitions<TJobTypeDefinitions> & string,
    TCompleteReturn,
  >(
    options: {
      typeName: TSequenceTypeName;
      id: GetStateAdapterJobId<TStateAdapter>;
      complete: JobSequenceCompleteOptions<
        TStateAdapter,
        TJobTypeDefinitions,
        TSequenceTypeName,
        TCompleteReturn
      >;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    CompleteJobSequenceResult<
      TStateAdapter,
      TJobTypeDefinitions,
      TSequenceTypeName,
      TCompleteReturn
    >
  >;
  withNotify: <T>(cb: () => Promise<T>) => Promise<T>;
  waitForJobSequenceCompletion: <
    TSequenceTypeName extends keyof ExternalJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    jobSequence: {
      typeName: TSequenceTypeName;
      id: GetStateAdapterJobId<TStateAdapter>;
    },
    options: {
      timeoutMs: number;
      pollIntervalMs?: number;
      signal?: AbortSignal;
    },
  ) => Promise<
    CompletedJobSequence<
      JobSequenceOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TSequenceTypeName>
    >
  >;
};

export const createQueuert = async <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any, any>,
>({
  stateAdapter,
  notifyAdapter,
  observabilityAdapter,
  log,
}: {
  stateAdapter: TStateAdapter;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  log: Log;
  jobTypeDefinitions: TJobTypeDefinitions;
}): Promise<Queuert<TJobTypeDefinitions, TStateAdapter>> => {
  const helper = queuertHelper({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
  });

  return {
    createWorker: () => {
      const createWorkerInstance = (
        registeredJobTypes: RegisteredJobTypes,
      ): QueuertWorkerDefinition<TJobTypeDefinitions, TStateAdapter> => {
        return {
          implementJobType({ typeName, process, retryConfig, leaseConfig }) {
            if (registeredJobTypes.has(typeName)) {
              throw new Error(`JobType with typeName "${typeName}" is already registered`);
            }
            const newRegisteredJobTypes = new Map(registeredJobTypes);
            newRegisteredJobTypes.set(typeName, {
              process: process as any,
              retryConfig,
              leaseConfig,
            });

            return createWorkerInstance(newRegisteredJobTypes);
          },
          start: async (startOptions) =>
            createExecutor({
              helper,
              registeredJobTypes,
            })(startOptions),
        };
      };

      return createWorkerInstance(new Map());
    },
    startJobSequence: (async ({
      input,
      typeName,
      deduplication,
      schedule,
      startBlockers,
      ...context
    }) =>
      helper.startJobSequence({
        typeName,
        input,
        context,
        deduplication,
        schedule,
        startBlockers,
      })) as Queuert<TJobTypeDefinitions, TStateAdapter>["startJobSequence"],
    getJobSequence: (async ({ id, typeName, ...context }) =>
      helper.getJobSequence({ id, typeName, context })) as Queuert<
      TJobTypeDefinitions,
      TStateAdapter
    >["getJobSequence"],
    deleteJobSequences: async ({ rootSequenceIds, ...context }) =>
      helper.deleteJobSequences({ rootSequenceIds, context }),
    completeJobSequence: (async ({ id, typeName, complete, ...context }) =>
      helper.completeJobSequence({ id, typeName, context, complete })) as Queuert<
      TJobTypeDefinitions,
      TStateAdapter
    >["completeJobSequence"],
    waitForJobSequenceCompletion: (async (jobSequence, options) =>
      helper.waitForJobSequenceCompletion({
        id: jobSequence.id,
        typeName: jobSequence.typeName,
        timeoutMs: options.timeoutMs,
        pollIntervalMs: options.pollIntervalMs,
        signal: options.signal,
      })) as Queuert<TJobTypeDefinitions, TStateAdapter>["waitForJobSequenceCompletion"],
    withNotify: async (cb, ...args) => helper.withNotifyContext(async () => cb(...args)),
  };
};
