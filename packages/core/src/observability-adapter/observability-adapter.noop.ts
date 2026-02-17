import { type ObservabilityAdapter } from "./observability-adapter.js";

export const createNoopObservabilityAdapter = (): ObservabilityAdapter => ({
  // worker
  workerStarted: () => {},
  workerError: () => {},
  workerStopping: () => {},
  workerStopped: () => {},

  // job
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

  // job chain
  jobChainCreated: () => {},
  jobChainCompleted: () => {},

  // blockers
  jobBlocked: () => {},
  jobUnblocked: () => {},

  // notify adapter
  notifyContextAbsence: () => {},
  notifyAdapterError: () => {},

  // state adapter
  stateAdapterError: () => {},

  // histograms
  jobChainDuration: () => {},
  jobDuration: () => {},
  jobAttemptDuration: () => {},

  // gauges
  jobTypeIdleChange: () => {},
  jobTypeProcessingChange: () => {},

  // tracing
  startJobSpan: () => undefined,
  startBlockerSpan: () => undefined,
  completeBlockerSpan: () => undefined,
  startAttemptSpan: () => undefined,
  completeJobSpan: () => undefined,
});
