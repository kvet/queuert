---
title: Transaction Hooks
description: Buffer side effects during database transactions.
sidebar:
  order: 1
---

`withTransactionHooks` buffers side effects (like notify events) during a transaction and flushes them only after the callback returns successfully. On error, all buffered side effects are discarded.

```ts
await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (sql) => {
    await client.startJobChain({ sql, transactionHooks, typeName: "send-email", input });
    // If the transaction rolls back, no notifications are sent
  }),
);
```

For manual control over the flush/discard lifecycle, use `createTransactionHooks` directly. This is useful when your database client uses explicit `BEGIN`/`COMMIT`/`ROLLBACK` rather than a callback-style transaction:

```ts
const { transactionHooks, flush, discard } = createTransactionHooks();
const connection = await db.connect();
try {
  await connection.query("BEGIN");
  const result = await client.startJobChain({
    connection,
    transactionHooks,
    typeName: "send-email",
    input,
  });
  await connection.query("COMMIT");
  await flush(); // Side effects fire only after commit
  return result;
} catch (error) {
  await connection.query("ROLLBACK").catch(() => {});
  await discard(); // Side effects discarded on error
  throw error;
} finally {
  connection.release();
}
```

## How It Works

`TransactionHooks` is a generic container for named hooks with mutable state. It knows nothing about Queuert itself -- consumers (client, worker) register their own hooks using symbol keys.

A hook is a triple of mutable state, a flush function, and a discard function. Multiple hooks can be registered on the same `TransactionHooks` instance. During the transaction, code mutates hook state freely. After the outer callback completes successfully, each hook's flush function is called with its accumulated state. If the callback throws, each hook's discard function is called instead -- no flush occurs.

Hooks are registered lazily via `getOrInsert`, which follows the [TC39 `Map.getOrInsert` proposal](https://github.com/tc39/proposal-upsert). This avoids a separate registration step -- the hook is created on first access and reused on subsequent accesses within the same transaction.

`withTransactionHooks` manages this lifecycle automatically: it creates the `TransactionHooks` instance, passes it to the callback, and calls flush on success or discard on error. `createTransactionHooks` exposes the same lifecycle for manual control -- the caller is responsible for calling `flush()` after commit and `discard()` on error.
