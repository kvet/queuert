import type { ObservabilityAdapter } from "./observability-adapter.js";

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

  // job sequence
  jobSequenceCreated: () => {},
  jobSequenceCompleted: () => {},

  // blockers
  jobBlocked: () => {},
  jobUnblocked: () => {},

  // notify adapter
  notifyContextAbsence: () => {},
  notifyAdapterError: () => {},

  // state adapter
  stateAdapterError: () => {},

  // histograms
  jobSequenceDuration: () => {},
  jobDuration: () => {},
  jobAttemptDuration: () => {},
});
