import type { JobTypes } from "./job-types/job-types.ts";
import { wrapJobTypesWithLogging } from "./job-types/job-types.wrapper.logging.ts";
import { createInProcessNotifyAdapter } from "./notify-adapter/notify-adapter.in-process.ts";
import type { NotifyAdapter } from "./notify-adapter/notify-adapter.ts";
import { wrapNotifyAdapterWithLogging } from "./notify-adapter/notify-adapter.wrapper.logging.ts";
import { type NotifyHelper, createNotifyHelper } from "./notify-adapter/notify-helper.ts";
import type { Log } from "./observability-adapter/log.ts";
import { createNoopObservabilityAdapter } from "./observability-adapter/observability-adapter.noop.ts";
import type { ObservabilityAdapter } from "./observability-adapter/observability-adapter.ts";
import { createNoopObservabilityHelper } from "./observability-adapter/observability-helper.noop.ts";
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
  notifyHelper: NotifyHelper;
  observabilityHelper: ObservabilityHelper;
  jobTypes: JobTypes;
} => {
  const observabilityHelper =
    log === undefined && observabilityAdapterOption === undefined
      ? createNoopObservabilityHelper()
      : createObservabilityHelper({
          log,
          adapter: observabilityAdapterOption ?? createNoopObservabilityAdapter(),
        });
  const stateAdapter = wrapStateAdapterWithLogging({
    stateAdapter: stateAdapterOption,
    observabilityHelper,
  });
  const notifyHelper = createNotifyHelper({
    adapter: wrapNotifyAdapterWithLogging({
      notifyAdapter: notifyAdapterOption ?? createInProcessNotifyAdapter(),
      observabilityHelper,
    }),
  });
  const jobTypes = wrapJobTypesWithLogging({
    jobTypes: jobTypesOption,
    observabilityHelper,
  });

  return {
    stateAdapter,
    notifyHelper,
    observabilityHelper,
    jobTypes,
  };
};

export type Helpers = ReturnType<typeof createHelpers>;
