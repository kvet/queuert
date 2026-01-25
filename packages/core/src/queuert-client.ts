import { type JobTypeRegistry } from "./entities/job-type-registry.js";
import {
  type BaseJobTypeDefinitions,
  type EntryJobTypeDefinitions,
  type HasBlockers,
  type JobChainOf,
} from "./entities/job-type.js";
import { type ScheduleOptions } from "./entities/schedule.js";
import { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { type Log } from "./observability-adapter/log.js";
import { type ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import {
  type CompleteJobChainResult,
  type JobChainCompleteOptions,
  type StartBlockersFn,
  queuertHelper,
} from "./queuert-helper.js";
import {
  type DeduplicationOptions,
  type GetStateAdapterJobId,
  type GetStateAdapterTxContext,
  type StateAdapter,
} from "./state-adapter/state-adapter.js";

import { type CompletedJobChain } from "./entities/job-chain.js";

export type QueuertClient<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
> = {
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

export const createQueuertClient = async <
  TJobTypeRegistry extends JobTypeRegistry<any>,
  TStateAdapter extends StateAdapter<any, any>,
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
}): Promise<QueuertClient<TJobTypeRegistry["$definitions"], TStateAdapter>> => {
  const helper = queuertHelper({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    jobTypeRegistry,
    log,
  });

  return {
    startJobChain: (async ({
      input,
      typeName,
      deduplication,
      schedule,
      startBlockers,
      ...txContext
    }) =>
      helper.startJobChain({
        typeName,
        input,
        txContext,
        deduplication,
        schedule,
        startBlockers,
      })) as QueuertClient<TJobTypeRegistry["$definitions"], TStateAdapter>["startJobChain"],
    getJobChain: (async ({ id, typeName, ...txContext }) =>
      helper.getJobChain({ id, typeName, txContext })) as QueuertClient<
      TJobTypeRegistry["$definitions"],
      TStateAdapter
    >["getJobChain"],
    deleteJobChains: async ({ rootChainIds, ...txContext }) =>
      helper.deleteJobChains({ rootChainIds, txContext }),
    completeJobChain: (async ({ id, typeName, complete, ...txContext }) =>
      helper.completeJobChain({ id, typeName, txContext, complete })) as QueuertClient<
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
      })) as QueuertClient<
      TJobTypeRegistry["$definitions"],
      TStateAdapter
    >["waitForJobChainCompletion"],
    withNotify: async (cb, ...args) => helper.withNotifyContext(async () => cb(...args)),
  };
};
