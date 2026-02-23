# Commit Hooks

## Overview

A generic mechanism for buffering side effects during a transaction and flushing them only after the transaction commits. On error, buffered side effects are discarded.

`CommitHooks` itself knows nothing about queuert — it is a container of named hooks with mutable state. Consumers (client, worker) register their own hooks.

## CommitHooks

### Hook Registration

A hook is a named pair of state + flush function. Hooks are registered with symbol keys:

```typescript
commitHooks.set(key, { state, flush }); // set hook
commitHooks.getOrInsert(key, () => ({ state, flush })); // get state, or set and return state
commitHooks.get(key); // get state (throws if not registered)
commitHooks.has(key); // check if hook exists
commitHooks.delete(key); // delete hook
```

`getOrInsert` follows the [TC39 `Map.getOrInsert` proposal](https://github.com/tc39/proposal-upsert) — lazily registers the hook on first access. This is the preferred way to use hooks, as it avoids a separate registration step.

After the callback completes successfully, `flush` is called for each registered hook with its accumulated state. On error, all hooks are discarded.

### `withCommitHooks()`

A standalone utility exported from the core package. Creates a `CommitHooks`, passes it to the callback, and flushes all registered hooks after the callback returns.

```typescript
await withCommitHooks(async (commitHooks) => {
  // Register hooks, do work, mutate hook state...
  // On success: all hooks are flushed
  // On error: all hooks are discarded
});
```

## How It Works

A hook is a pair of mutable state and a flush function. Multiple hooks can be registered on the same `CommitHooks` instance using symbol keys. During the transaction, code mutates hook state. After the transaction commits, each hook's flush function is called with its accumulated state.

```typescript
const myHookKey = Symbol("myHook");

const bufferMessage = (commitHooks: CommitHooks, message: string) => {
  commitHooks
    .getOrInsert(myHookKey, () => ({
      state: [] as string[],
      flush: async (messages) => {
        for (const msg of messages) await sendNotification(msg);
      },
    }))
    .push(message);
};

await withCommitHooks(async (commitHooks) => {
  await db.transaction(async (tx) => {
    await tx.insert(orders).values({ ... });
    bufferMessage(commitHooks, "Order created");

    await tx.insert(payments).values({ ... });
    bufferMessage(commitHooks, "Payment recorded");
  });

  // When withCommitHooks returns, flush is called:
  // sendNotification("Order created"), sendNotification("Payment recorded")
});
```

If the callback throws, all hooks are discarded — no flush, no side effects.
