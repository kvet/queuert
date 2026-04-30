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
  jobAttemptLeaseExpired: () => {},
  jobAttemptLeaseRenewed: () => {},
  jobAttemptFailed: () => {},
  jobAttemptCompleted: () => {},
  jobCompleted: () => {},
  jobReaped: () => {},

  chainCreated: () => {},
  chainCompleted: () => {},
  chainDeleted: () => {},

  jobTriggered: () => {},

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
