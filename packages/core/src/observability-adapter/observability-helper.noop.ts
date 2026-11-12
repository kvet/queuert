import { noop } from "@queuert/helpers/noop";

import type { ObservabilityHelper } from "./observability-helper.ts";

export const createNoopObservabilityHelper = (): ObservabilityHelper => ({
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
  jobTypeValidationError: noop,
  jobAttemptDuration: noop,
  jobTypeIdleChange: noop,
  jobTypeProcessingChange: noop,
  startJobSpan: noop,
  startAttemptSpan: noop,
  completeJobSpan: noop,
  startBlockerSpan: noop,
  completeBlockerSpan: noop,
});
