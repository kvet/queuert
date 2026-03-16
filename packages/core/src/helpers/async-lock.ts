/**
 * A mutual-exclusion lock for serializing async operations.
 *
 * Used by SQLite state providers to serialize write transactions, since SQLite
 * only supports one writer at a time. Call {@link AsyncLock.acquire | acquire} before entering
 * a transaction and {@link AsyncLock.release | release} when it completes.
 */
export type AsyncLock = {
  /** Waits until the lock is available, then acquires it. */
  acquire: () => Promise<void>;
  /** Releases the lock, allowing the next queued caller to proceed. */
  release: () => void;
};

/** Creates an {@link AsyncLock} instance for serializing async operations. */
export const createAsyncLock = (): AsyncLock => {
  const queue: (() => void)[] = [];
  let isLocked = false;

  return {
    acquire: async () => {
      if (!isLocked) {
        isLocked = true;
        return;
      }
      await new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    },
    release: () => {
      const next = queue.shift();
      if (next) {
        next();
      } else {
        isLocked = false;
      }
    },
  };
};
