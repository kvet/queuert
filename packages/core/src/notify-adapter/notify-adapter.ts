/**
 * Adapter for pub/sub notifications between workers and clients.
 *
 * Notifications are hints — the system works correctly even if they are lost or duplicated.
 * `notify*` methods take a non-empty batch of unique items and publish each item as its own
 * notification, and may call listeners before they return. All `listen*` methods return a dispose
 * function to unsubscribe.
 *
 * A listener that throws does not keep other listeners from receiving the notification, and its
 * error does not reach the `notify*` caller.
 */
export type NotifyAdapter = {
  /** Notify that jobs of the given types are available for processing. */
  notifyJobsScheduled: (typeNames: string[]) => Promise<void>;
  /** Listen for job scheduling notifications. Every listener receives each notification. */
  listenJobScheduled: (
    typeNames: string[],
    onNotification: (typeName: string) => void,
  ) => Promise<() => Promise<void>>;
  /** Notify that the given chains have completed. */
  notifyChainsCompleted: (chainIds: string[]) => Promise<void>;
  /** Listen for a specific chain's completion. Returns a dispose function. */
  listenChainCompleted: (
    chainId: string,
    onNotification: () => void,
  ) => Promise<() => Promise<void>>;
  /**
   * Notify that the given jobs lost their attempts: reclaimed from a worker whose lease expired or
   * that stopped, completed workerless, or their chain was deleted.
   */
  notifyJobAttemptsLost: (jobIds: string[]) => Promise<void>;
  /** Listen for attempt loss on a specific job. Returns a dispose function. */
  listenJobAttemptLost: (jobId: string, onNotification: () => void) => Promise<() => Promise<void>>;
  /**
   * Releases internal resources (shared subscriptions, listener registries) and
   * cascades into the underlying provider. Idempotent — the second call is a
   * no-op. After close, `notify*`/`listen*` calls reject, while dispose functions returned before
   * close still work.
   */
  close: () => Promise<void>;

  /** Calls {@link close}, so the adapter can be held with `await using`. */
  [Symbol.asyncDispose]: () => Promise<void>;
};
