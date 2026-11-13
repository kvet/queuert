import type { Mode, ModeResult } from "@queuert/helpers/maybe-promise";

/** Whether an adapter returns promises (`"async"`) or plain values (`"sync"`). */
export type AdapterMode = Mode;

export type { ModeResult };

/**
 * The mode of an adapter: `"sync"` when it sets `sync: true`, `"async"` otherwise. Queuert reads
 * it to run the client, the processors and the worker runner over the adapter synchronously:
 * their state-touching calls return plain values and throw, so they can join a driver's own
 * synchronous transaction.
 */
export type AdapterModeOf<TAdapter> = TAdapter extends { readonly sync: true } ? "sync" : "async";

export const isSyncAdapter = (adapter: object): boolean =>
  (adapter as { sync?: unknown }).sync === true;
