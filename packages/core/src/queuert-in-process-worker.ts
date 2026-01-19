import { JobTypeRegistry } from "./entities/job-type-registry.js";
import { BaseJobTypeDefinitions } from "./entities/job-type.js";
import { BackoffConfig } from "./helpers/backoff.js";
import { NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { Log } from "./observability-adapter/log.js";
import { ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import { queuertHelper } from "./queuert-helper.js";
import { StateAdapter } from "./state-adapter/state-adapter.js";
import { createExecutor, RegisteredJobTypes } from "./worker/executor.js";
import { JobAttemptMiddleware, JobProcessFn, LeaseConfig } from "./worker/job-process.js";

export type InProcessWorkerProcessingConfig<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
> = {
  pollIntervalMs?: number;
  nextJobDelayMs?: number;
  defaultRetryConfig?: BackoffConfig;
  defaultLeaseConfig?: LeaseConfig;
  workerLoopRetryConfig?: BackoffConfig;
  jobAttemptMiddlewares?: JobAttemptMiddleware<TStateAdapter, TJobTypeDefinitions>[];
};

export type InProcessWorkerJobTypeProcessor<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = {
  process: JobProcessFn<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;
  retryConfig?: BackoffConfig;
  leaseConfig?: LeaseConfig;
};

export type InProcessWorkerJobTypeProcessors<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
> = {
  [K in keyof TJobTypeDefinitions & string]?: InProcessWorkerJobTypeProcessor<
    TStateAdapter,
    TJobTypeDefinitions,
    K
  >;
};

export type QueuertInProcessWorker = {
  start: () => Promise<() => Promise<void>>;
};

export const createQueuertInProcessWorker = async <
  TJobTypeRegistry extends JobTypeRegistry<any>,
  TStateAdapter extends StateAdapter<any, any>,
>({
  stateAdapter,
  notifyAdapter,
  observabilityAdapter,
  jobTypeRegistry,
  log,
  workerId,
  jobTypeProcessing,
  jobTypeProcessors,
}: {
  stateAdapter: TStateAdapter;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  jobTypeRegistry: TJobTypeRegistry;
  log: Log;
  workerId?: string;
  jobTypeProcessing?: InProcessWorkerProcessingConfig<
    TStateAdapter,
    TJobTypeRegistry["$definitions"]
  >;
  jobTypeProcessors: InProcessWorkerJobTypeProcessors<
    TStateAdapter,
    TJobTypeRegistry["$definitions"]
  >;
}): Promise<QueuertInProcessWorker> => {
  const helper = queuertHelper({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    jobTypeRegistry,
    log,
  });

  const registeredJobTypes: RegisteredJobTypes = new Map();
  for (const [typeName, processor] of Object.entries(jobTypeProcessors)) {
    if (processor) {
      registeredJobTypes.set(typeName, {
        process: processor.process,
        retryConfig: processor.retryConfig,
        leaseConfig: processor.leaseConfig,
      });
    }
  }

  const executor = createExecutor<TStateAdapter, TJobTypeRegistry["$definitions"]>({
    helper,
    registeredJobTypes,
    workerId,
    jobTypeProcessing,
  });

  return {
    start: executor,
  };
};
