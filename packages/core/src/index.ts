import { ResolvedJobSequence } from "./entities/job-sequence.js";
import { BaseJobTypeDefinitions, FirstJobTypeDefinitions } from "./entities/job-type.js";
import { BackoffConfig } from "./helpers/backoff.js";
import { Log } from "./log.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { EnqueueBlockerJobSequences, queuertHelper } from "./queuert-helper.js";
import {
  DeduplicationOptions,
  GetStateAdapterContext,
  StateAdapter,
} from "./state-adapter/state-adapter.js";
import { createExecutor, Executor, RegisteredJobTypes } from "./worker/executor.js";
import { JobHandler, LeaseConfig } from "./worker/job-handler.js";

export { type CompletedJobSequence, type JobSequence } from "./entities/job-sequence.js";
export {
  defineUnionJobTypes,
  type BaseJobTypeDefinitions,
  type DefineContinuationInput,
  type DefineContinuationOutput,
} from "./entities/job-type.js";
export { type BackoffConfig } from "./helpers/backoff.js";
export { type RetryConfig } from "./helpers/retry.js";
export { type Log } from "./log.js";
export { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
export {
  type DeduplicationOptions,
  type DeduplicationStrategy,
} from "./state-adapter/state-adapter.js";
export { type StateProvider as QueuerTStateProvider } from "./state-provider/state-provider.js";
export { rescheduleJob, type LeaseConfig } from "./worker/job-handler.js";

type QueuertWorkerDefinition<
  TStateAdapter extends StateAdapter<any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
> = {
  implementJobType: <
    TJobTypeName extends keyof TJobTypeDefinitions & string,
    TBlockers extends readonly ResolvedJobSequence<
      TJobTypeDefinitions,
      keyof TJobTypeDefinitions
    >[],
  >(options: {
    name: TJobTypeName;
    enqueueBlockerJobSequences?: EnqueueBlockerJobSequences<
      TStateAdapter,
      TJobTypeDefinitions,
      TJobTypeName,
      TBlockers
    >;
    handler: JobHandler<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TBlockers>;
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
    } & GetStateAdapterContext<TStateAdapter>,
  ) => Promise<
    ResolvedJobSequence<TJobTypeDefinitions, TFirstJobTypeName> & { deduplicated: boolean }
  >;
  getJobSequence: <
    TFirstJobTypeName extends keyof FirstJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    options: {
      firstJobTypeName: TFirstJobTypeName;
      id: string;
    } & GetStateAdapterContext<TStateAdapter>,
  ) => Promise<ResolvedJobSequence<TJobTypeDefinitions, TFirstJobTypeName> | null>;
  withNotify: <T, TArgs extends any[]>(
    cb: (...args: TArgs) => Promise<T>,
    ...args: TArgs
  ) => Promise<T>;
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
          implementJobType({
            name: typeName,
            enqueueBlockerJobSequences,
            handler,
            retryConfig,
            leaseConfig,
          }) {
            if (registeredJobTypes.has(typeName)) {
              throw new Error(`JobType with name "${typeName}" is already registered`);
            }
            const newRegisteredJobTypes = new Map(registeredJobTypes);
            newRegisteredJobTypes.set(typeName, {
              enqueueBlockerJobSequences: enqueueBlockerJobSequences as any,
              handler: handler as any,
              retryConfig,
              leaseConfig,
            });

            return createWorkerInstance(newRegisteredJobTypes);
          },
          start: (startOptions) =>
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
    startJobSequence: async ({ input, firstJobTypeName, deduplication, ...context }) =>
      helper.startJobSequence({
        firstJobTypeName,
        input,
        context,
        deduplication,
      }),
    getJobSequence: async ({ id, firstJobTypeName, ...context }) =>
      helper.getJobSequence({ id, firstJobTypeName, context }),
    withNotify: async (cb, ...args) => {
      return helper.withNotifyJobTypeContext(() => cb(...args));
    },
  };
};
