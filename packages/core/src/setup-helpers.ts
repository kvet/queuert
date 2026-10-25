import { type Operation, runOperation } from "@queuert/helpers";

import { type JobTypes } from "./job-types/job-types.js";
import { wrapJobTypesWithLogging } from "./job-types/job-types.wrapper.logging.js";
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
import { type StateOperations, createStateOperations } from "./state-adapter/state-operations.js";

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
  state: StateOperations;
  run: <T>(operation: () => Operation<T>) => T | Promise<T>;
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
    state: createStateOperations(stateAdapter),
    run: <T>(operation: () => Operation<T>): T | Promise<T> =>
      runOperation(stateAdapter.mode, operation),
    notifyAdapter,
    observabilityHelper,
    jobTypes,
  };
};

export type Helpers = ReturnType<typeof createHelpers>;
