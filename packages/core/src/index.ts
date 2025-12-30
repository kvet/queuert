import {
  BaseJobTypeDefinitions,
  FirstJobTypeDefinitions,
  HasBlockers,
  JobSequenceOf,
} from "./entities/job-type.js";
import { BackoffConfig } from "./helpers/backoff.js";
import { Log } from "./log.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import {
  CompleteJobSequenceResult,
  JobSequenceCompleteOptions,
  queuertHelper,
  StartBlockersFn,
} from "./queuert-helper.js";
import {
  DeduplicationOptions,
  GetStateAdapterContext,
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
} from "./entities/job-type.js";
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
  type DeduplicationOptions,
  type DeduplicationStrategy,
} from "./state-adapter/state-adapter.js";
export { type StateProvider as QueuerTStateProvider } from "./state-provider/state-provider.js";
export { rescheduleJob, type LeaseConfig } from "./worker/job-process.js";

type QueuertWorkerDefinition<
  TStateAdapter extends StateAdapter<any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
> = {
  implementJobType: <TJobTypeName extends keyof TJobTypeDefinitions & string>(options: {
    name: TJobTypeName;
    process: JobProcessFn<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;
    retryConfig?: BackoffConfig;
    leaseConfig?: LeaseConfig;
  }) => QueuertWorkerDefinition<TStateAdapter, TJobTypeDefinitions>;
  start: Executor;
};

export type Queuert<
  TStateAdapter extends StateAdapter<any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
> = {
  createWorker: () => QueuertWorkerDefinition<TStateAdapter, TJobTypeDefinitions>;
  startJobSequence: <
    TFirstJobTypeName extends keyof FirstJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    options: {
      firstJobTypeName: TFirstJobTypeName;
      input: TJobTypeDefinitions[TFirstJobTypeName]["input"];
      deduplication?: DeduplicationOptions;
    } & (HasBlockers<TJobTypeDefinitions, TFirstJobTypeName> extends true
      ? { startBlockers: StartBlockersFn<TJobTypeDefinitions, TFirstJobTypeName> }
      : { startBlockers?: never }) &
      GetStateAdapterContext<TStateAdapter>,
  ) => Promise<JobSequenceOf<TJobTypeDefinitions, TFirstJobTypeName> & { deduplicated: boolean }>;
  getJobSequence: <
    TFirstJobTypeName extends keyof FirstJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    options: {
      firstJobTypeName: TFirstJobTypeName;
      id: string;
    } & GetStateAdapterContext<TStateAdapter>,
  ) => Promise<JobSequenceOf<TJobTypeDefinitions, TFirstJobTypeName> | null>;
  deleteJobSequences: (
    options: {
      sequenceIds: string[];
    } & GetStateAdapterContext<TStateAdapter>,
  ) => Promise<void>;
  completeJobSequence: <
    TFirstJobTypeName extends keyof FirstJobTypeDefinitions<TJobTypeDefinitions> & string,
    TCompleteReturn,
  >(
    options: {
      firstJobTypeName: TFirstJobTypeName;
      id: string;
      complete: JobSequenceCompleteOptions<
        TStateAdapter,
        TJobTypeDefinitions,
        TFirstJobTypeName,
        TCompleteReturn
      >;
    } & GetStateAdapterContext<TStateAdapter>,
  ) => Promise<CompleteJobSequenceResult<TJobTypeDefinitions, TFirstJobTypeName, TCompleteReturn>>;
  withNotify: <T, TArgs extends any[]>(
    cb: (...args: TArgs) => Promise<T>,
    ...args: TArgs
  ) => Promise<T>;
  waitForJobSequenceCompletion: <
    TFirstJobTypeName extends keyof FirstJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(options: {
    firstJobTypeName: TFirstJobTypeName;
    id: string;
    timeoutMs: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
  }) => Promise<CompletedJobSequence<JobSequenceOf<TJobTypeDefinitions, TFirstJobTypeName>>>;
};

export const createQueuert = async <
  TStateAdapter extends StateAdapter<any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
>({
  stateAdapter,
  notifyAdapter,
  log,
}: {
  stateAdapter: TStateAdapter;
  notifyAdapter: NotifyAdapter;
  jobTypeDefinitions: TJobTypeDefinitions;
  log: Log;
}): Promise<Queuert<TStateAdapter, TJobTypeDefinitions>> => {
  const helper = queuertHelper({
    stateAdapter,
    notifyAdapter,
    log,
  });

  return {
    createWorker: () => {
      const createWorkerInstance = (
        registeredJobTypes: RegisteredJobTypes,
      ): QueuertWorkerDefinition<TStateAdapter, TJobTypeDefinitions> => {
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
    startJobSequence: async ({
      input,
      firstJobTypeName,
      deduplication,
      startBlockers,
      ...context
    }) =>
      helper.startJobSequence({
        firstJobTypeName,
        input,
        context,
        deduplication,
        startBlockers,
      }),
    getJobSequence: async ({ id, firstJobTypeName, ...context }) =>
      helper.getJobSequence({ id, firstJobTypeName, context }),
    deleteJobSequences: async ({ sequenceIds, ...context }) =>
      helper.deleteJobSequences({ sequenceIds, context }),
    completeJobSequence: ({ id, firstJobTypeName, complete, ...context }) =>
      helper.completeJobSequence({ id, firstJobTypeName, context, complete }) as any,
    waitForJobSequenceCompletion: async ({
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
      }),
    withNotify: async (cb, ...args) => helper.withNotifyContext(async () => cb(...args)),
  };
};
