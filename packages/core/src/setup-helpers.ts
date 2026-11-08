import type { JobTypes } from "./job-types/job-types.ts";
import { wrapJobTypesWithLogging } from "./job-types/job-types.wrapper.logging.ts";
import { createNoopNotifyAdapter } from "./notify-adapter/notify-adapter.noop.ts";
import type { NotifyAdapter } from "./notify-adapter/notify-adapter.ts";
import { wrapNotifyAdapterWithLogging } from "./notify-adapter/notify-adapter.wrapper.logging.ts";
import type { Log } from "./observability-adapter/log.ts";
import { createNoopObservabilityAdapter } from "./observability-adapter/observability-adapter.noop.ts";
import type { ObservabilityAdapter } from "./observability-adapter/observability-adapter.ts";
import {
  type ObservabilityHelper,
  createObservabilityHelper,
} from "./observability-adapter/observability-helper.ts";
import type { StateAdapter } from "./state-adapter/state-adapter.ts";
import { wrapStateAdapterWithLogging } from "./state-adapter/state-adapter.wrapper.logging.ts";

export const createHelpers = ({
  stateAdapter: stateAdapterOption,
  notifyAdapter: notifyAdapterOption,
  observabilityAdapter: observabilityAdapterOption,
  jobTypes: jobTypesOption,
  log,
}: {
  stateAdapter: StateAdapter<any, any, any>;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  jobTypes: JobTypes;
  log?: Log;
}): {
  stateAdapter: StateAdapter<any, any, any>;
  notifyAdapter: NotifyAdapter;
  observabilityHelper: ObservabilityHelper;
  jobTypes: JobTypes;
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
  const jobTypes = wrapJobTypesWithLogging({
    jobTypes: jobTypesOption,
    observabilityHelper,
  });

  return {
    stateAdapter,
    notifyAdapter,
    observabilityHelper,
    jobTypes,
  };
};

export type Helpers = ReturnType<typeof createHelpers>;
