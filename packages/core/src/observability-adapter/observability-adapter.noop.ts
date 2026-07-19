import { type ObservabilityAdapter } from "./observability-adapter.js";

export const createNoopObservabilityAdapter = (): ObservabilityAdapter => ({
  workerStarted: () => {},
  workerError: () => {},
  workerStopping: () => {},
  workerStopped: () => {},

  jobCreated: () => {},
  jobAttemptStarted: () => {},
  jobAttemptTakenByAnotherWorker: () => {},
  jobAttemptAlreadyCompleted: () => {},
  jobAttemptExpired: () => {},
  jobAttemptExtended: () => {},
  jobAttemptFailed: () => {},
  jobAttemptCompleted: () => {},
  jobCompleted: () => {},
  jobAttemptReclaimed: () => {},

  chainCreated: () => {},
  chainCompleted: () => {},
  chainDeleted: () => {},

  jobRescheduled: () => {},

  jobBlocked: () => {},
  jobUnblocked: () => {},

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
