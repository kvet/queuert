import { type ObservabilityAdapter } from "./observability-adapter.js";

export const createNoopObservabilityAdapter = (): ObservabilityAdapter => ({
  workerStarted: () => {},
  workerError: () => {},
  workerLeaseLost: () => {},
  workerStopped: () => {},

  chainCreated: () => {},
  chainCompleted: () => {},
  chainDeleted: () => {},

  jobCreated: () => {},
  jobCompleted: () => {},
  jobRescheduled: () => {},
  jobBlocked: () => {},
  jobUnblocked: () => {},

  jobAttemptStarted: () => {},
  jobAttemptLost: () => {},
  jobAttemptFailed: () => {},
  jobAttemptCompleted: () => {},
  jobAttemptReclaimed: () => {},

  notifyAdapterError: () => {},

  stateAdapterError: () => {},

  chainDuration: () => {},
  jobDuration: () => {},
  jobAttemptDuration: () => {},

  jobTypeIdleChange: () => {},
  jobTypeProcessingChange: () => {},

  startJobSpan: () => undefined,
  startBlockerSpan: () => undefined,
  completeBlockerSpan: () => undefined,
  startAttemptSpan: () => undefined,
  completeJobSpan: () => undefined,
});
