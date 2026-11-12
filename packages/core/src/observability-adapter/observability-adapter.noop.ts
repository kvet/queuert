import { noop } from "@queuert/helpers/noop";

import type { ObservabilityAdapter } from "./observability-adapter.ts";

export const createNoopObservabilityAdapter = (): ObservabilityAdapter => ({
  workerStarted: noop,
  workerError: noop,
  workerLeaseLost: noop,
  workerStopped: noop,

  chainCreated: noop,
  chainCompleted: noop,
  chainDeleted: noop,

  jobCreated: noop,
  jobCompleted: noop,
  jobRescheduled: noop,
  jobBlocked: noop,
  jobUnblocked: noop,

  jobAttemptStarted: noop,
  jobAttemptLost: noop,
  jobAttemptFailed: noop,
  jobAttemptCompleted: noop,
  jobAttemptReclaimed: noop,

  notifyAdapterError: noop,

  stateAdapterError: noop,

  chainDuration: noop,
  jobDuration: noop,
  jobAttemptDuration: noop,

  jobTypeIdleChange: noop,
  jobTypeProcessingChange: noop,

  startJobSpan: noop,
  startBlockerSpan: noop,
  completeBlockerSpan: noop,
  startAttemptSpan: noop,
  completeJobSpan: noop,
});
