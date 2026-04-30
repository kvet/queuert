/**
 * Adapter for pub/sub notifications between workers and clients.
 *
 * Notifications are hints — the system works correctly even if they are lost or duplicated.
 * All `listen*` methods return a dispose function to unsubscribe.
 */
export type NotifyAdapter = {
  /** Notify that jobs of the given type are available for processing. */
  notifyJobScheduled: (typeName: string) => Promise<void>;
  /** Listen for job scheduling notifications. Returns a dispose function. */
  listenJobScheduled: (
    typeNames: string[],
    onNotification: (typeName: string) => void,
  ) => Promise<() => Promise<void>>;
  /**
   * Add `count` wakeups to the budget for `typeName`. Budgets compose
   * additively across concurrent publishers — calling `provideWakeHint(t, 3)`
   * twice yields a budget of 6. Adapters without hint support implement this
   * as a no-op. Call before `notifyJobScheduled` so the budget exists by the
   * time listeners receive the notification.
   */
  provideWakeHint: (typeName: string, count: number) => Promise<void>;
  /**
   * Atomically claim one slot of the budget for `typeName`. Returns true if a
   * slot was claimed (caller should wake) or no budget is currently tracked
   * (graceful degradation: caller wakes). Returns false only when an explicit
   * budget was set and is now exhausted by other consumers. Adapters without
   * hint support always return true.
   */
  consumeWakeHint: (typeName: string) => Promise<boolean>;
  /** Notify that a chain has completed. */
  notifyChainCompleted: (chainId: string) => Promise<void>;
  /** Listen for a specific chain's completion. Returns a dispose function. */
  listenChainCompleted: (
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
  /**
   * Releases internal resources (shared subscriptions, listener registries) and
   * cascades into the underlying provider. Idempotent — the second call is a
   * no-op. After close, `notify*`/`listen*` calls reject.
   */
  close: () => Promise<void>;
};
