import { type ObservabilityAdapter } from "./observability-adapter.js";

export const createNoopObservabilityAdapter = (): ObservabilityAdapter => ({
  workerStarted: () => {},
  workerError: () => {},
  workerStopping: () => {},
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
  jobAttemptTakenByAnotherWorker: () => {},
  jobAttemptAlreadyCompleted: () => {},
  jobAttemptExpired: () => {},
  jobAttemptExtended: () => {},
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
