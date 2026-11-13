import type { MaybePromise } from "@queuert/helpers/maybe-promise";

import type { ConformanceNotifyAdapter } from "../conformance/adapters.ts";

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
  createNotifyAdapter: () => MaybePromise<ConformanceNotifyAdapter>;
};
