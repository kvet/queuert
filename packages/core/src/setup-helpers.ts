import { type JobTypeRegistry } from "./entities/job-type-registry.js";
import { wrapJobTypeRegistryWithLogging } from "./entities/job-type-registry.wrapper.logging.js";
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
import { type StateAdapter } from "./state-adapter/state-adapter.js";
import { wrapStateAdapterWithLogging } from "./state-adapter/state-adapter.wrapper.logging.js";

export const createHelpers = ({
  stateAdapter: stateAdapterOption,
  notifyAdapter: notifyAdapterOption,
  observabilityAdapter: observabilityAdapterOption,
  jobTypeRegistry: jobTypeRegistryOption,
  log,
}: {
  stateAdapter: StateAdapter<any, any>;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  jobTypeRegistry: JobTypeRegistry;
  log?: Log;
}): {
  stateAdapter: StateAdapter<any, any>;
  notifyAdapter: NotifyAdapter;
  observabilityHelper: ObservabilityHelper;
  jobTypeRegistry: JobTypeRegistry;
} => {
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
  const jobTypeRegistry = wrapJobTypeRegistryWithLogging({
    jobTypeRegistry: jobTypeRegistryOption,
    observabilityHelper,
  });

  return {
    stateAdapter,
    notifyAdapter,
    observabilityHelper,
    jobTypeRegistry,
  };
};

export type Helpers = ReturnType<typeof createHelpers>;
