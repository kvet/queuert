import type { NotifyAdapter } from "../notify-adapter/notify-adapter.ts";

/**
 * The context the notify adapter conformance cases run against. Create it once, before the cases.
 * Each case creates the adapters it needs from it, and they are closed when the case ends.
 */
export type NotifyAdapterConformanceContext = {
  /**
   * Creates a notify adapter. The adapters a case creates are closed when it ends, so closing one
   * must not release resources the next one needs.
   */
  createNotifyAdapter: () => Promise<NotifyAdapter>;
};
