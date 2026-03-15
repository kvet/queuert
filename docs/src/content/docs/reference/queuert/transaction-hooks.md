---
title: Transaction Hooks
description: Transaction hooks API for buffering side effects during database transactions.
sidebar:
  order: 2
---

## withTransactionHooks

```typescript
await withTransactionHooks(async (transactionHooks) => {
  await db.transaction(async (tx) => {
    await client.startJobChain({ tx, transactionHooks, ... });
  });
});
```

The recommended approach. Automatically flushes buffered side effects on success and discards them on error.

## createTransactionHooks

```typescript
const { transactionHooks, flush, discard } = createTransactionHooks();
try {
  await db.transaction(async (tx) => {
    await client.startJobChain({ tx, transactionHooks, ... });
  });
  await flush();
} catch {
  await discard();
}
```

Manual lifecycle for advanced use cases. Call `flush()` after the transaction commits to emit buffered side effects. Call `discard()` on error to drop them.

## TransactionHooks

```typescript
type TransactionHooks = {
  set<T>(key: symbol, hook: HookDef<T>): void;
  getOrInsert<T>(key: symbol, factory: () => HookDef<T>): T;
  get<T>(key: symbol): T;
  has(key: symbol): boolean;
  delete(key: symbol): void;
  withSavepoint<T>(fn: (transactionHooks: TransactionHooks) => T | Promise<T>): Promise<T>;
  createSavepoint(): TransactionHooksSavepoint;
};
```

The hooks container passed to all mutating client methods. Manages keyed hook definitions that buffer side effects during a transaction.

- **withSavepoint** -- runs `fn` inside a savepoint. Automatically rolls back buffered hook state on error and releases on success.
- **createSavepoint** -- creates a manual savepoint for fine-grained control. Returns a `TransactionHooksSavepoint` handle.

## TransactionHooksSavepoint

```typescript
type TransactionHooksSavepoint = {
  transactionHooks: TransactionHooks;
  rollback(): void;
  release(): void;
};
```

A savepoint handle returned by `createSavepoint()`. Call `rollback()` to restore hook state to the point when the savepoint was created, or `release()` to keep the current state.

## HookDef

```typescript
type HookDef<T> = {
  state: T;
  flush: (state: T) => void | Promise<void>;
  discard?: (state: T) => void | Promise<void>;
  checkpoint?: (state: T) => () => void;
};
```

Defines a single hook's state and lifecycle callbacks.

- **state** -- mutable state accumulated during the transaction
- **flush** -- called with the accumulated state after the transaction commits
- **discard** -- called on rollback to clean up without executing side effects
- **checkpoint** -- called when a savepoint is created. Returns a rollback function that restores the state to the checkpoint. Used by `withSavepoint` and `createSavepoint` to support partial rollback of hook state.

## TransactionHooksHandle

```typescript
type TransactionHooksHandle = {
  transactionHooks: TransactionHooks;
  flush: () => Promise<void>;
  discard: () => Promise<void>;
};
```

Returned by `createTransactionHooks()`. Provides the `transactionHooks` instance along with explicit `flush` and `discard` controls.

## See Also

- [Client](/queuert/reference/queuert/client/) — Client API reference
- [Transaction Hooks Guide](/queuert/guides/transaction-hooks/) — Usage guide
