import { createAsyncRwLock } from "./async-rw-lock.ts";

/**
 * Opens an underlying subscription that pushes routing keys to `dispatch`, and
 * resolves with a function that tears that subscription down. The adapter
 * extracts the `key` from the wire payload, so per-key subscribers can be
 * matched in O(1) at dispatch time.
 */
export type SharedListenerOpen = (dispatch: (key: string) => void) => Promise<() => Promise<void>>;

export type SharedListener = {
  /**
   * Attaches a callback for the given routing keys, opening the underlying
   * subscription lazily if not already open. The callback receives the key
   * that was dispatched. Returns a function that detaches this callback from
   * every key and tears down the underlying subscription if it was the last one.
   */
  subscribe: (keys: string[], callback: (key: string) => void) => Promise<() => Promise<void>>;
  /** Force-tears the underlying subscription regardless of remaining callbacks. */
  dispose: () => Promise<void>;
};

type Callbacks = Map<string, Set<(key: string) => void>>;

type State =
  | { running: false }
  | { running: true; callbacks: Callbacks; unsubscribe: () => Promise<void> };

const totalCallbacks = (callbacks: Callbacks): number => {
  let n = 0;
  for (const set of callbacks.values()) n += set.size;
  return n;
};

/**
 * Multiplexes many application-level listeners onto a single underlying
 * subscription, routed by key. Opens lazily on first listener and tears down
 * when the last one unsubscribes. All mutations serialize on a write lock,
 * so concurrent subscribe/unsubscribe/dispose calls execute one at a time.
 */
export const createSharedListener = (open: SharedListenerOpen): SharedListener => {
  let state: State = { running: false };
  const lock = createAsyncRwLock();

  const dispatch = (key: string): void => {
    if (!state.running) return;
    const set = state.callbacks.get(key);
    if (!set) return;
    for (const callback of set) {
      try {
        callback(key);
      } catch {}
    }
  };

  const tearDown = async (): Promise<void> => {
    if (!state.running) return;
    const { unsubscribe } = state;
    state = { running: false };
    await unsubscribe();
  };

  return {
    subscribe: async (keys, callback) => {
      using _h = await lock.acquireWrite();
      if (!state.running) {
        const unsubscribe = await open(dispatch);
        state = { running: true, callbacks: new Map(), unsubscribe };
      }
      for (const key of keys) {
        let set = state.callbacks.get(key);
        if (!set) {
          set = new Set();
          state.callbacks.set(key, set);
        }
        set.add(callback);
      }

      return async () => {
        using _h2 = await lock.acquireWrite();
        if (!state.running) return;
        for (const key of keys) {
          const s = state.callbacks.get(key);
          if (s) {
            s.delete(callback);
            if (s.size === 0) state.callbacks.delete(key);
          }
        }
        if (totalCallbacks(state.callbacks) === 0) await tearDown();
      };
    },
    dispose: async () => {
      using _h = await lock.acquireWrite();
      await tearDown();
    },
  };
};
