export type ListenResult<T> = { received: true; value: T } | { received: false };

export type Listener<T> = {
  wait: (opts?: { signal?: AbortSignal }) => Promise<ListenResult<T>>;
  dispose: () => Promise<void>;
  [Symbol.asyncDispose]: () => Promise<void>;
};

export type NotifyAdapter = {
  notifyJobScheduled: (typeName: string) => Promise<void>;
  listenJobScheduled: (typeNames: string[]) => Promise<Listener<string>>;
  notifyJobSequenceCompleted: (sequenceId: string) => Promise<void>;
  listenJobSequenceCompleted: (sequenceId: string) => Promise<Listener<void>>;
  notifyJobOwnershipLost: (jobId: string) => Promise<void>;
  listenJobOwnershipLost: (jobId: string) => Promise<Listener<void>>;
};
