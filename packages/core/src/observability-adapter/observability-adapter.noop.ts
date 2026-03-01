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

  jobChainCreated: () => {},
  jobChainCompleted: () => {},

  jobBlocked: () => {},
  jobUnblocked: () => {},

  notifyAdapterError: () => {},

  stateAdapterError: () => {},

  jobChainDuration: () => {},
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
