export type NotifyAdapter = {
  notifyJobScheduled: (typeName: string) => Promise<void>;
  listenJobScheduled: (typeNames: string[], { signal }: { signal?: AbortSignal }) => Promise<void>;
  notifyJobSequenceCompleted: (sequenceId: string) => Promise<void>;
  listenJobSequenceCompleted: (
    sequenceIds: string[],
    { signal }: { signal?: AbortSignal },
  ) => Promise<string | undefined>;
  notifyJobOwnershipLost: (jobId: string) => Promise<void>;
  listenJobOwnershipLost: (
    jobIds: string[],
    { signal }: { signal?: AbortSignal },
  ) => Promise<string | undefined>;
};
