import {
  BaseJobTypeDefinitions,
  FirstJobTypeDefinitions,
  HasBlockers,
  JobSequenceOf,
} from "./entities/job-type.js";
import { ScheduleOptions } from "./entities/schedule.js";
import { BackoffConfig } from "./helpers/backoff.js";
import { Log } from "./log.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { createNoopNotifyAdapter } from "./notify-adapter/notify-adapter.noop.js";
import {
  CompleteJobSequenceResult,
  JobSequenceCompleteOptions,
  queuertHelper,
  StartBlockersFn,
} from "./queuert-helper.js";
import {
  DeduplicationOptions,
  GetStateAdapterContext,
  GetStateAdapterJobId,
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
export { type BackoffConfig } from "./helpers/backoff.js";
export { type RetryConfig } from "./helpers/retry.js";
export { type Log } from "./log.js";
export { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
export {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
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
export { rescheduleJob, type LeaseConfig } from "./worker/job-process.js";

// In-process adapters
export { createInProcessNotifyAdapter } from "./notify-adapter/notify-adapter.in-process.js";
export {
  createInProcessStateAdapter,
  type InProcessContext,
  type InProcessStateAdapter,
} from "./state-adapter/state-adapter.in-process.js";

export type QueuertWorkerDefinition<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
> = {
  implementJobType: <TJobTypeName extends keyof TJobTypeDefinitions & string>(options: {
    name: TJobTypeName;
    process: JobProcessFn<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;
    retryConfig?: BackoffConfig;
    leaseConfig?: LeaseConfig;
  }) => QueuertWorkerDefinition<TJobTypeDefinitions, TStateAdapter>;
  start: Executor;
};

export type Queuert<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
> = {
  createWorker: () => QueuertWorkerDefinition<TJobTypeDefinitions, TStateAdapter>;
  startJobSequence: <
    TFirstJobTypeName extends keyof FirstJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    options: {
      firstJobTypeName: TFirstJobTypeName;
      input: TJobTypeDefinitions[TFirstJobTypeName]["input"];
      deduplication?: DeduplicationOptions;
      schedule?: ScheduleOptions;
    } & (HasBlockers<TJobTypeDefinitions, TFirstJobTypeName> extends true
      ? {
          startBlockers: StartBlockersFn<
            GetStateAdapterJobId<TStateAdapter>,
            TJobTypeDefinitions,
            TFirstJobTypeName
          >;
        }
      : { startBlockers?: never }) &
      GetStateAdapterContext<TStateAdapter>,
  ) => Promise<
    JobSequenceOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TFirstJobTypeName> & {
      deduplicated: boolean;
    }
  >;
  getJobSequence: <
    TFirstJobTypeName extends keyof FirstJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    options: {
      firstJobTypeName: TFirstJobTypeName;
      id: GetStateAdapterJobId<TStateAdapter>;
    } & GetStateAdapterContext<TStateAdapter>,
  ) => Promise<JobSequenceOf<
    GetStateAdapterJobId<TStateAdapter>,
    TJobTypeDefinitions,
    TFirstJobTypeName
  > | null>;
  deleteJobSequences: (
    options: {
      sequenceIds: GetStateAdapterJobId<TStateAdapter>[];
    } & GetStateAdapterContext<TStateAdapter>,
  ) => Promise<void>;
  completeJobSequence: <
    TFirstJobTypeName extends keyof FirstJobTypeDefinitions<TJobTypeDefinitions> & string,
    TCompleteReturn,
  >(
    options: {
      firstJobTypeName: TFirstJobTypeName;
      id: GetStateAdapterJobId<TStateAdapter>;
      complete: JobSequenceCompleteOptions<
        TStateAdapter,
        TJobTypeDefinitions,
        TFirstJobTypeName,
        TCompleteReturn
      >;
    } & GetStateAdapterContext<TStateAdapter>,
  ) => Promise<
    CompleteJobSequenceResult<
      TStateAdapter,
      TJobTypeDefinitions,
      TFirstJobTypeName,
      TCompleteReturn
    >
  >;
  withNotify: <T, TArgs extends any[]>(
    cb: (...args: TArgs) => Promise<T>,
    ...args: TArgs
  ) => Promise<T>;
  waitForJobSequenceCompletion: <
    TFirstJobTypeName extends keyof FirstJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(options: {
    firstJobTypeName: TFirstJobTypeName;
    id: GetStateAdapterJobId<TStateAdapter>;
    timeoutMs: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
  }) => Promise<
    CompletedJobSequence<
      JobSequenceOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TFirstJobTypeName>
    >
  >;
};

export const createQueuert = async <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
>({
  stateAdapter,
  notifyAdapter = createNoopNotifyAdapter(),
  log,
}: {
  stateAdapter: TStateAdapter;
  notifyAdapter?: NotifyAdapter;
  jobTypeDefinitions: TJobTypeDefinitions;
  log: Log;
}): Promise<Queuert<TJobTypeDefinitions, TStateAdapter>> => {
  const helper = queuertHelper({
    stateAdapter,
    notifyAdapter,
    log,
  });

  return {
    createWorker: () => {
      const createWorkerInstance = (
        registeredJobTypes: RegisteredJobTypes,
      ): QueuertWorkerDefinition<TJobTypeDefinitions, TStateAdapter> => {
        return {
          implementJobType({ name: typeName, process, retryConfig, leaseConfig }) {
            if (registeredJobTypes.has(typeName)) {
              throw new Error(`JobType with name "${typeName}" is already registered`);
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
              notifyAdapter,
              log,
              registeredJobTypes,
            })(startOptions),
        };
      };

      return createWorkerInstance(new Map());
    },
    startJobSequence: (async ({
      input,
      firstJobTypeName,
      deduplication,
      schedule,
      startBlockers,
      ...context
    }) =>
      helper.startJobSequence({
        firstJobTypeName,
        input,
        context,
        deduplication,
        schedule,
        startBlockers,
      })) as Queuert<TJobTypeDefinitions, TStateAdapter>["startJobSequence"],
    getJobSequence: (async ({ id, firstJobTypeName, ...context }) =>
      helper.getJobSequence({ id, firstJobTypeName, context })) as Queuert<
      TJobTypeDefinitions,
      TStateAdapter
    >["getJobSequence"],
    deleteJobSequences: async ({ sequenceIds, ...context }) =>
      helper.deleteJobSequences({ sequenceIds, context }),
    completeJobSequence: (async ({ id, firstJobTypeName, complete, ...context }) =>
      helper.completeJobSequence({ id, firstJobTypeName, context, complete })) as Queuert<
      TJobTypeDefinitions,
      TStateAdapter
    >["completeJobSequence"],
    waitForJobSequenceCompletion: (async ({
      id,
      firstJobTypeName,
      timeoutMs,
      pollIntervalMs,
      signal,
    }) =>
      helper.waitForJobSequenceCompletion({
        id,
        firstJobTypeName,
        timeoutMs,
        pollIntervalMs,
        signal,
      })) as Queuert<TJobTypeDefinitions, TStateAdapter>["waitForJobSequenceCompletion"],
    withNotify: async (cb, ...args) => helper.withNotifyContext(async () => cb(...args)),
  };
};
