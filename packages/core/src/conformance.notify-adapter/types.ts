import type { Mode, MaybePromise } from "@queuert/sync-async";

import type { NotifyAdapter } from "../notify-adapter/notify-adapter.ts";

/**
 * The context the notify adapter conformance cases run against, for an adapter of either mode.
 * Create it once, before the cases. Each case creates the adapters it needs from it, and they are
 * closed when the case ends.
 */
export type NotifyAdapterConformanceContext = {
  /**
   * Creates a notify adapter. The adapters a case creates are closed when it ends, so closing one
   * must not release resources the next one needs.
   */
  createNotifyAdapter: () => MaybePromise<NotifyAdapter<Mode>>;
  /**
   * The adapter's mode: `"sync"` for an adapter with `sync: true`, `"async"` otherwise. The contract
   * cases check the adapter's `sync` marker against it, and the end-to-end cases run the adapter
   * with an in-process state adapter of this mode.
   */
  mode: Mode;
};
