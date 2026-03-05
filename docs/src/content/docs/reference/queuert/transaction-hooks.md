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
};
```

The hooks container passed to all mutating client methods. Manages keyed hook definitions that buffer side effects during a transaction.

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
