import { createResettableLatch } from "@queuert/helpers/latch";
import { isThenable, silence } from "@queuert/helpers/promise";

import { HookRegistry } from "./hook-registry.ts";
import type { TxHooks } from "./tx-hooks.ts";

export type TxHooksSync = Pick<TxHooks, "onRollback"> & {
  onCommit(callback: () => void): void;
  withSavepoint<T>(fn: (txHooks: TxHooksSync) => T): T;
  createSavepoint(): { txHooks: TxHooksSync; rollback(): void; release(): void };
  retryBoundary<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult;
};

class SyncTxHooks extends HookRegistry<() => unknown> implements TxHooksSync {
  createSavepoint(): { txHooks: TxHooksSync; rollback(): void; release(): void } {
    return { txHooks: this, rollback: this.snapshot(), release: () => {} };
  }

  withSavepoint<T>(fn: (txHooks: TxHooksSync) => T): T {
    const rollback = this.snapshot();
    let result: unknown;
    try {
      result = fn(this);
    } catch (error) {
      rollback();
      throw error;
    }
    if (isThenable(result)) {
      silence(result);
      rollback();
      throw new Error(
        "TxHooksSync.withSavepoint requires a synchronous callback: it returned a promise",
      );
    }
    return result as T;
  }

  retryBoundary<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    let rollbackPreviousTry: (() => void) | undefined;
    const running = createResettableLatch(
      "txHooks.retryBoundary: the previous try is still running",
    );
    return (...args: TArgs): TResult => {
      running.throwIfTripped();
      rollbackPreviousTry?.();
      rollbackPreviousTry = this.snapshot();
      running.trip();
      try {
        return fn(...args);
      } finally {
        running.reset();
      }
    };
  }

  flush(): void {
    let failure: { error: unknown } | undefined;
    let returnedPromise = false;
    for (const callback of this.takeCommitCallbacks()) {
      try {
        const result: unknown = callback();
        if (isThenable(result)) {
          returnedPromise = true;
          silence(result);
        }
      } catch (error) {
        failure ??= { error };
      }
    }
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
    if (failure) throw failure.error;
    if (returnedPromise) {
      throw new Error(
        "TxHooksSync requires synchronous commit callbacks: a commit callback returned a promise",
      );
    }
  }
}

export const createTxHooksSync = (): {
  txHooks: TxHooksSync;
  flush: () => void;
  discard: () => void;
} => {
  const txHooks = new SyncTxHooks();
  return {
    txHooks,
    flush: () => {
      txHooks.flush();
    },
    discard: () => {
      txHooks.discard();
    },
  };
};

export const withTxHooksSync = <T>(cb: (txHooks: TxHooksSync) => T): T => {
  const txHooks = new SyncTxHooks();
  let result: unknown;
  try {
    result = cb(txHooks);
  } catch (error) {
    try {
      txHooks.discard();
    } catch {}
    throw error;
  }
  if (isThenable(result)) {
    silence(result);
    try {
      txHooks.discard();
    } catch {}
    throw new Error(
      "withTxHooksSync requires a synchronous callback: it returned a promise; use withTxHooks for an async transaction",
    );
  }
  txHooks.flush();
  return result as T;
};
