/**
 * Adapter for pub/sub notifications between workers and clients.
 *
 * Notifications are hints — the system works correctly even if they are lost or duplicated.
 * All `listen*` methods return a dispose function to unsubscribe.
 */
export type NotifyAdapter = {
  /** Notify that jobs of the given type are available for processing. */
  notifyJobScheduled: (typeName: string, count: number) => Promise<void>;
  /** Listen for job scheduling notifications. Returns a dispose function. */
  listenJobScheduled: (
    typeNames: string[],
    onNotification: (typeName: string) => void,
  ) => Promise<() => Promise<void>>;
  /** Notify that a job chain has completed. */
  notifyJobChainCompleted: (chainId: string) => Promise<void>;
  /** Listen for a specific chain's completion. Returns a dispose function. */
  listenJobChainCompleted: (
    chainId: string,
    onNotification: () => void,
  ) => Promise<() => Promise<void>>;
  /** Notify that a job's ownership has been lost (e.g. lease expired or workerless completion). */
  notifyJobOwnershipLost: (jobId: string) => Promise<void>;
  /** Listen for ownership loss on a specific job. Returns a dispose function. */
  listenJobOwnershipLost: (
    jobId: string,
    onNotification: () => void,
  ) => Promise<() => Promise<void>>;
};
