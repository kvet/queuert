import { createAsyncRwLock } from "./async-rw-lock.js";

/**
 * Opens an underlying subscription that pushes payloads to `dispatch`, and
 * resolves with a function that tears that subscription down. The adapter
 * extracts a routing `key` from the wire payload and passes both, so per-key
 * subscribers can be matched in O(1) at dispatch time.
 */
export type SharedListenerOpen = (
  dispatch: (key: string, payload: string) => void,
) => Promise<() => Promise<void>>;

export type SharedListener = {
  /**
   * Attaches a callback for a given routing key, opening the underlying
   * subscription lazily if not already open. Returns a function that detaches
   * this callback and tears down the underlying subscription if it was the
   * last one.
   */
  subscribe: (key: string, callback: (payload: string) => void) => Promise<() => Promise<void>>;
  /** Force-tears the underlying subscription regardless of remaining callbacks. */
  dispose: () => Promise<void>;
};

type Callbacks = Map<string, Set<(payload: string) => void>>;

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

  const dispatch = (key: string, payload: string): void => {
    if (!state.running) return;
    const set = state.callbacks.get(key);
    if (!set) return;
    for (const callback of set) {
      try {
        callback(payload);
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
    subscribe: async (key, callback) => {
      using _h = await lock.acquireWrite();
      if (!state.running) {
        const unsubscribe = await open(dispatch);
        state = { running: true, callbacks: new Map(), unsubscribe };
      }
      let set = state.callbacks.get(key);
      if (!set) {
        set = new Set();
        state.callbacks.set(key, set);
      }
      set.add(callback);

      return async () => {
        using _h2 = await lock.acquireWrite();
        if (!state.running) return;
        const s = state.callbacks.get(key);
        if (s) {
          s.delete(callback);
          if (s.size === 0) state.callbacks.delete(key);
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
