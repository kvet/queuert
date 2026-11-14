import type { Mode } from "@queuert/sync-async";

export type ModeOf<TAdapter> = TAdapter extends { readonly sync: true }
  ? "sync"
  : TAdapter extends { readonly sync?: false }
    ? "async"
    : Mode;

export type AdapterLifecycle<TMode extends Mode> = TMode extends "sync"
  ? {
      /** Marks the adapter as synchronous. */
      readonly sync: true;
      /** Releases internal resources. Idempotent. */
      close: () => void;
      /** Calls `close`, so the adapter can be held with `using`. */
      [Symbol.dispose]: () => void;
    }
  : {
      /** Absent or `false` on an asynchronous adapter. */
      readonly sync?: false;
      /** Releases internal resources. Idempotent. */
      close: () => Promise<void>;
      /** Calls `close`, so the adapter can be held with `await using`. */
      [Symbol.asyncDispose]: () => Promise<void>;
    };
