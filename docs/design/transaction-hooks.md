# Transaction Hooks

## Overview

A generic mechanism for buffering side effects during a transaction and flushing them only after the transaction commits. On error, buffered side effects are discarded.

`TransactionHooks` itself knows nothing about queuert — it is a container of named hooks with mutable state. Consumers (client, worker) register their own hooks.

## TransactionHooks

### Hook Registration

A hook is a named pair of state + flush + discard functions. Hooks are registered with symbol keys:

```typescript
transactionHooks.set(key, { state, flush, discard }); // set hook
transactionHooks.getOrInsert(key, () => ({ state, flush, discard })); // get state, or set and return state
transactionHooks.get(key); // get state (throws if not registered)
transactionHooks.has(key); // check if hook exists
transactionHooks.delete(key); // delete hook
```

`getOrInsert` follows the [TC39 `Map.getOrInsert` proposal](https://github.com/tc39/proposal-upsert) — lazily registers the hook on first access. This is the preferred way to use hooks, as it avoids a separate registration step.

After the callback completes successfully, `flush` is called for each registered hook with its accumulated state. On error, `discard` is called instead.

### `withTransactionHooks()`

A standalone utility exported from the core package. Creates a `TransactionHooks`, passes it to the callback, and manages the lifecycle:

```typescript
await withTransactionHooks(async (transactionHooks) => {
  // Register hooks, do work, mutate hook state...
  // On success: all hooks are flushed
  // On error: all hooks are discarded
});
```

## How It Works

A hook is a triple of mutable state, a flush function, and a discard function. Multiple hooks can be registered on the same `TransactionHooks` instance using symbol keys. During the transaction, code mutates hook state. After the transaction commits, each hook's flush function is called with its accumulated state. If the transaction fails, each hook's discard function is called instead.

```typescript
const myHookKey = Symbol("myHook");

const bufferMessage = (transactionHooks: TransactionHooks, message: string) => {
  transactionHooks
    .getOrInsert(myHookKey, () => ({
      state: [] as string[],
      flush: async (messages) => {
        for (const msg of messages) await sendNotification(msg);
      },
      discard: () => {},
    }))
    .push(message);
};

await withTransactionHooks(async (transactionHooks) => {
  await db.transaction(async (tx) => {
    await tx.insert(orders).values({ ... });
    bufferMessage(transactionHooks, "Order created");

    await tx.insert(payments).values({ ... });
    bufferMessage(transactionHooks, "Payment recorded");
  });

  // When withTransactionHooks returns, flush is called:
  // sendNotification("Order created"), sendNotification("Payment recorded")
});
```

If the callback throws, all hooks are discarded — `discard` is called for each hook, no flush.

### `createTransactionHooks()`

For cases where manual control over the flush/discard lifecycle is needed, `createTransactionHooks()` is exported directly:

```typescript
const { transactionHooks, flush, discard } = createTransactionHooks();
try {
  const order = await startTransaction(async (db) => {
    const inserted = await db.insert(orders).values({ ... });
    bufferMessage(transactionHooks, "Order created");
    return inserted;
  });
  await flush();
  return order;
} catch (error) {
  await discard();
  throw error;
}
```

The caller is responsible for calling `flush()` after commit and `discard()` on error. This is the same lifecycle that `withTransactionHooks` manages automatically — `createTransactionHooks` just exposes it.
