import { type StateAdapter } from "./state-adapter/state-adapter.js";
import { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { type ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import { type JobTypeRegistry } from "./entities/job-type-registry.js";
import { type Log } from "./observability-adapter/log.js";
import { createNoopObservabilityAdapter } from "./observability-adapter/observability-adapter.noop.js";
import {
  type ObservabilityHelper,
  createObservabilityHelper,
} from "./observability-adapter/observability-helper.js";
import { wrapStateAdapterWithLogging } from "./state-adapter/state-adapter.wrapper.logging.js";
import { wrapNotifyAdapterWithLogging } from "./notify-adapter/notify-adapter.wrapper.logging.js";
import { createNoopNotifyAdapter } from "./notify-adapter/notify-adapter.noop.js";
import { wrapJobTypeRegistryWithLogging } from "./entities/job-type-registry.wrapper.logging.js";

export const setupHelpers = ({
  stateAdapter: stateAdapterOption,
  notifyAdapter: notifyAdapterOption,
  observabilityAdapter: observabilityAdapterOption,
  registry: registryOption,
  log,
}: {
  stateAdapter: StateAdapter<any, any>;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  registry: JobTypeRegistry;
  log?: Log;
}): {
  stateAdapter: StateAdapter<any, any>;
  notifyAdapter: NotifyAdapter;
  observabilityHelper: ObservabilityHelper;
  registry: JobTypeRegistry;
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
  const registry = wrapJobTypeRegistryWithLogging({
    registry: registryOption,
    observabilityHelper,
  });

  return {
    stateAdapter,
    notifyAdapter,
    observabilityHelper,
    registry,
  };
};
