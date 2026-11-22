import type { ModeResult, Mode } from "@queuert/sync-async";

import type { AdapterLifecycle } from "../adapter-mode.ts";

/**
 * Adapter for pub/sub notifications between workers and clients.
 *
 * In the `"async"` mode its methods return promises. In the `"sync"` mode it sets
 * `sync: true`, its methods return their results directly and throw instead of rejecting.
 * `NotifyAdapter<"async" | "sync">` is an adapter of either mode. `close` releases internal resources
 * (shared subscriptions, listener registries) and cascades into the underlying provider; after
 * close, `notify*` and `listen*` calls fail, while dispose functions returned before close still
 * work.
 *
 * Notifications are hints — the system works correctly even if they are lost or duplicated.
 * `notify*` methods take a non-empty batch of unique items and publish each item as its own
 * notification, and may call listeners before they return. `listen*` methods take a non-empty list
 * of unique items, call `onNotification` with the item each notification is for, and return a
 * dispose function that unsubscribes from all of them.
 *
 * A listener that throws does not keep other listeners from receiving the notification, and its
 * error does not reach the `notify*` caller.
 *
 * @typeParam TMode - Whether the methods return promises or plain values
 */
export type NotifyAdapter<TMode extends Mode> = {
  /** Notify that jobs of the given types are available for processing. */
  notifyJobsScheduled: (typeNames: string[]) => ModeResult<TMode, void>;
  /**
   * Listen for jobs of any of the given types being scheduled. Every listener receives each
   * notification.
   */
  listenJobsScheduled: (
    typeNames: string[],
    onNotification: (typeName: string) => void,
  ) => ModeResult<TMode, () => ModeResult<TMode, void>>;
  /** Notify that the given chains have completed. */
  notifyChainsCompleted: (chainIds: string[]) => ModeResult<TMode, void>;
  /**
   * Listen for the completion of any of the given chains. Every listener receives each
   * notification.
   */
  listenChainsCompleted: (
    chainIds: string[],
    onNotification: (chainId: string) => void,
  ) => ModeResult<TMode, () => ModeResult<TMode, void>>;
  /**
   * Notify that the given jobs lost their attempts: reclaimed from a worker whose lease expired or
   * that stopped, completed by the client, or their chain was deleted.
   */
  notifyJobAttemptsLost: (jobIds: string[]) => ModeResult<TMode, void>;
  /**
   * Listen for attempt loss on any of the given jobs. Every listener receives each notification.
   */
  listenJobAttemptsLost: (
    jobIds: string[],
    onNotification: (jobId: string) => void,
  ) => ModeResult<TMode, () => ModeResult<TMode, void>>;
} & AdapterLifecycle<TMode>;
