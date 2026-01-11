import type { ObservabilityAdapter } from "./observability-adapter.js";

export type MetricCall = {
  method: string;
  args: unknown[];
};

export type MockObservabilityAdapter = ObservabilityAdapter & {
  _calls: MetricCall[];
};

export const createMockObservabilityAdapter = (): MockObservabilityAdapter => {
  const calls: MetricCall[] = [];

  const mock = <T extends (...args: any[]) => void>(method: string): T =>
    ((...args: unknown[]) => {
      calls.push({ method, args });
    }) as unknown as T;

  return {
    _calls: calls,

    // worker
    workerStarted: mock("workerStarted"),
    workerError: mock("workerError"),
    workerStopping: mock("workerStopping"),
    workerStopped: mock("workerStopped"),

    // job
    jobCreated: mock("jobCreated"),
    jobAttemptStarted: mock("jobAttemptStarted"),
    jobAttemptTakenByAnotherWorker: mock("jobAttemptTakenByAnotherWorker"),
    jobAttemptAlreadyCompleted: mock("jobAttemptAlreadyCompleted"),
    jobAttemptLeaseExpired: mock("jobAttemptLeaseExpired"),
    jobAttemptLeaseRenewed: mock("jobAttemptLeaseRenewed"),
    jobAttemptFailed: mock("jobAttemptFailed"),
    jobAttemptCompleted: mock("jobAttemptCompleted"),
    jobCompleted: mock("jobCompleted"),
    jobReaped: mock("jobReaped"),

    // job sequence
    jobSequenceCreated: mock("jobSequenceCreated"),
    jobSequenceCompleted: mock("jobSequenceCompleted"),

    // blockers
    jobBlocked: mock("jobBlocked"),
    jobUnblocked: mock("jobUnblocked"),

    // notify adapter
    notifyContextAbsence: mock("notifyContextAbsence"),
    notifyAdapterError: mock("notifyAdapterError"),

    // state adapter
    stateAdapterError: mock("stateAdapterError"),
  };
};
