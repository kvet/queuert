import { JobTypeRegistry } from "./entities/job-type-registry.js";
import {
  BaseJobTypeDefinitions,
  EntryJobTypeDefinitions,
  HasBlockers,
  JobChainOf,
} from "./entities/job-type.js";
import { ScheduleOptions } from "./entities/schedule.js";
import { BackoffConfig } from "./helpers/backoff.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { Log } from "./observability-adapter/log.js";
import { ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import {
  CompleteJobChainResult,
  JobChainCompleteOptions,
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

import { CompletedJobChain } from "./entities/job-chain.js";

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
  start: Executor<TStateAdapter, TJobTypeDefinitions>;
};

export type Queuert<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any, any>,
> = {
  createWorker: () => QueuertWorkerDefinition<TJobTypeDefinitions, TStateAdapter>;
  startJobChain: <
    TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    options: {
      typeName: TChainTypeName;
      input: TJobTypeDefinitions[TChainTypeName]["input"];
      deduplication?: DeduplicationOptions;
      schedule?: ScheduleOptions;
    } & (HasBlockers<TJobTypeDefinitions, TChainTypeName> extends true
      ? {
          startBlockers: StartBlockersFn<
            GetStateAdapterJobId<TStateAdapter>,
            TJobTypeDefinitions,
            TChainTypeName
          >;
        }
      : { startBlockers?: never }) &
      GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    JobChainOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName> & {
      deduplicated: boolean;
    }
  >;
  getJobChain: <TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string>(
    options: {
      typeName: TChainTypeName;
      id: GetStateAdapterJobId<TStateAdapter>;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<JobChainOf<
    GetStateAdapterJobId<TStateAdapter>,
    TJobTypeDefinitions,
    TChainTypeName
  > | null>;
  deleteJobChains: (
    options: {
      rootChainIds: GetStateAdapterJobId<TStateAdapter>[];
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<void>;
  completeJobChain: <
    TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
    TCompleteReturn,
  >(
    options: {
      typeName: TChainTypeName;
      id: GetStateAdapterJobId<TStateAdapter>;
      complete: JobChainCompleteOptions<
        TStateAdapter,
        TJobTypeDefinitions,
        TChainTypeName,
        TCompleteReturn
      >;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    CompleteJobChainResult<TStateAdapter, TJobTypeDefinitions, TChainTypeName, TCompleteReturn>
  >;
  withNotify: <T>(cb: () => Promise<T>) => Promise<T>;
  waitForJobChainCompletion: <
    TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    jobChain: {
      typeName: TChainTypeName;
      id: GetStateAdapterJobId<TStateAdapter>;
    },
    options: {
      timeoutMs: number;
      pollIntervalMs?: number;
      signal?: AbortSignal;
    },
  ) => Promise<
    CompletedJobChain<
      JobChainOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>
    >
  >;
};

export const createQueuert = async <
  TJobTypeRegistry extends JobTypeRegistry<any>,
  TStateAdapter extends StateAdapter<any, any, any>,
>({
  stateAdapter,
  notifyAdapter,
  observabilityAdapter,
  jobTypeRegistry,
  log,
}: {
  stateAdapter: TStateAdapter;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  jobTypeRegistry: TJobTypeRegistry;
  log: Log;
}): Promise<Queuert<TJobTypeRegistry["$definitions"], TStateAdapter>> => {
  const helper = queuertHelper({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    jobTypeRegistry,
    log,
  });

  return {
    createWorker: () => {
      const createWorkerInstance = (
        registeredJobTypes: RegisteredJobTypes,
      ): QueuertWorkerDefinition<TJobTypeRegistry["$definitions"], TStateAdapter> => {
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
            createExecutor<TStateAdapter, TJobTypeRegistry["$definitions"]>({
              helper,
              registeredJobTypes,
            })(startOptions),
        };
      };

      return createWorkerInstance(new Map());
    },
    startJobChain: (async ({
      input,
      typeName,
      deduplication,
      schedule,
      startBlockers,
      ...context
    }) =>
      helper.startJobChain({
        typeName,
        input,
        context,
        deduplication,
        schedule,
        startBlockers,
      })) as Queuert<TJobTypeRegistry["$definitions"], TStateAdapter>["startJobChain"],
    getJobChain: (async ({ id, typeName, ...context }) =>
      helper.getJobChain({ id, typeName, context })) as Queuert<
      TJobTypeRegistry["$definitions"],
      TStateAdapter
    >["getJobChain"],
    deleteJobChains: async ({ rootChainIds, ...context }) =>
      helper.deleteJobChains({ rootChainIds, context }),
    completeJobChain: (async ({ id, typeName, complete, ...context }) =>
      helper.completeJobChain({ id, typeName, context, complete })) as Queuert<
      TJobTypeRegistry["$definitions"],
      TStateAdapter
    >["completeJobChain"],
    waitForJobChainCompletion: (async (jobChain, options) =>
      helper.waitForJobChainCompletion({
        id: jobChain.id,
        typeName: jobChain.typeName,
        timeoutMs: options.timeoutMs,
        pollIntervalMs: options.pollIntervalMs,
        signal: options.signal,
      })) as Queuert<TJobTypeRegistry["$definitions"], TStateAdapter>["waitForJobChainCompletion"],
    withNotify: async (cb, ...args) => helper.withNotifyContext(async () => cb(...args)),
  };
};
