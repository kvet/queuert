import type { Mode, MaybePromise } from "@queuert/sync-async";

import type { NotifyAdapter } from "../notify-adapter/notify-adapter.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";

/**
 * The context the state adapter conformance cases run against, for an adapter of either mode.
 * Create it once, before the cases. Each case creates the adapters it needs from it, and they are
 * closed when the case ends.
 */
export type StateAdapterConformanceContext = {
  /**
   * Creates an adapter over a clean state: no jobs, blockers or workers, such as by clearing the
   * tables before returning the adapter. The adapters a case creates are closed when it ends, so
   * closing one must not release resources the next one needs.
   */
  createStateAdapter: () => MaybePromise<StateAdapter<any, any, any, Mode>>;
  /**
   * Runs the callback with a context of the adapter's shape that is not inside a transaction
   * (e.g. a pool client with no `BEGIN`, or the root ORM handle), so the suite can verify
   * `getTransaction` returns `undefined` for it.
   */
  withNonTransactionContext<T>(fn: (txCtx: any) => MaybePromise<T>): MaybePromise<T>;
  /** Creates the notify adapter an end-to-end case shares; in-process when omitted. */
  createNotifyAdapter?: () => MaybePromise<NotifyAdapter<Mode>>;
};

export type SchemaFenceConformanceContext = StateAdapterConformanceContext & {
  withWritesFenced<T>(fn: () => MaybePromise<T>): MaybePromise<T>;
};

export type SavepointConformanceContext = StateAdapterConformanceContext & {
  withSavepoint?<T>(txCtx: any, fn: (txCtx: any) => MaybePromise<T>): MaybePromise<T>;
};
