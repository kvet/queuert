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
  jobTakenByAnotherWorker: () => {},
  jobLeaseExpired: () => {},
  jobLeaseRenewed: () => {},
  jobAttemptFailed: () => {},
  jobAttemptCompleted: () => {},
  jobCompleted: () => {},
  jobReaped: () => {},

  // job sequence
  jobSequenceCreated: () => {},
  jobSequenceCompleted: () => {},
  jobSequenceDeleted: () => {},

  // blockers
  jobBlocked: () => {},
  jobUnblocked: () => {},

  // notify adapter
  notifyContextAbsence: () => {},
  notifyAdapterError: () => {},

  // state adapter
  stateAdapterError: () => {},
});
