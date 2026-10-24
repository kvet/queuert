/**
 * A handle returned by {@link AsyncRwLock.acquireRead} or {@link AsyncRwLock.acquireWrite}.
 *
 * Call {@link LockHandle.release | release} manually, or use `using` to release at scope exit:
 *
 * ```ts
 * using h = await lock.acquireRead();
 * // lock released automatically when h goes out of scope
 * ```
 *
 * Release is idempotent — calling it after the handle is already disposed is a no-op.
 */
export type LockHandle = Disposable & {
  /** Release the lock. Idempotent. */
  release: () => void;
};

/**
 * A read-write lock for serializing async operations.
 *
 * Multiple readers may hold the lock concurrently; writers are exclusive — a writer blocks
 * until all existing readers release, and no new readers may acquire while a writer is queued
 * or active. Waiters are served in FIFO order to prevent writer starvation.
 *
 * Used by SQLite state providers to serialize write transactions (SQLite allows only one
 * writer) while still permitting concurrent reads.
 */
export type AsyncRwLock = {
  /** Acquire the lock in read mode. Multiple readers can hold it concurrently. */
  acquireRead: () => Promise<LockHandle>;
  /** Acquire the lock in write mode. Exclusive — blocks readers and other writers. */
  acquireWrite: () => Promise<LockHandle>;
};

type Waiter =
  | { kind: "read"; resolve: (h: LockHandle) => void }
  | { kind: "write"; resolve: (h: LockHandle) => void };

/** Creates an {@link AsyncRwLock}. Writer-preference, FIFO, starvation-free. */
export const createAsyncRwLock = (): AsyncRwLock => {
  const queue: Waiter[] = [];
  let readers = 0;
  let writerActive = false;

  const makeHandle = (onRelease: () => void): LockHandle => {
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      onRelease();
    };
    return {
      release,
      [Symbol.dispose]: release,
    };
  };

  const drain = (): void => {
    while (queue.length > 0) {
      const next = queue[0];
      if (next.kind === "write") {
        if (readers === 0 && !writerActive) {
          queue.shift();
          writerActive = true;
          next.resolve(makeHandle(onWriteRelease));
        }
        return;
      }
      if (writerActive) return;
      queue.shift();
      readers++;
      next.resolve(makeHandle(onReadRelease));
    }
  };

  const onReadRelease = (): void => {
    readers--;
    if (readers === 0) drain();
  };

  const onWriteRelease = (): void => {
    writerActive = false;
    drain();
  };

  return {
    acquireRead: async () => {
      if (!writerActive && queue.length === 0) {
        readers++;
        return makeHandle(onReadRelease);
      }
      return new Promise<LockHandle>((resolve) => {
        queue.push({ kind: "read", resolve });
      });
    },
    acquireWrite: async () => {
      if (!writerActive && readers === 0 && queue.length === 0) {
        writerActive = true;
        return makeHandle(onWriteRelease);
      }
      return new Promise<LockHandle>((resolve) => {
        queue.push({ kind: "write", resolve });
      });
    },
  };
};
