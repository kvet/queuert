---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/redis": major
"@queuert/nats": major
---

Add `close()` to `NotifyAdapter` and `StateAdapter`, and split wake-hint budget management out of `notifyJobScheduled` into dedicated `provideWakeHint` / `consumeWakeHint` methods.

### `notifyJobScheduled` signature change

`NotifyAdapter.notifyJobScheduled` no longer takes a count — wake-hint budgets are managed independently.

| Before                                                                   | After                                                     |
| ------------------------------------------------------------------------ | --------------------------------------------------------- |
| `notifyJobScheduled: (typeName: string, count: number) => Promise<void>` | `notifyJobScheduled: (typeName: string) => Promise<void>` |

### New wake-hint methods

Two new methods are required on `NotifyAdapter`:

```ts
/**
 * Add `count` wakeups to the budget for `typeName`. Budgets compose
 * additively across concurrent publishers — calling `provideWakeHint(t, 3)`
 * twice yields a budget of 6. Adapters without hint support implement this
 * as a no-op. Call before `notifyJobScheduled` so the budget exists by the
 * time listeners receive the notification.
 */
provideWakeHint: (typeName: string, count: number) => Promise<void>;

/**
 * Atomically claim one slot of the budget for `typeName`. Returns true if a
 * slot was claimed (caller should wake) or no budget is currently tracked
 * (graceful degradation: caller wakes). Returns false only when an explicit
 * budget was set and is now exhausted by other consumers. Adapters without
 * hint support always return true.
 */
consumeWakeHint: (typeName: string) => Promise<boolean>;
```

The hint budget is now keyed by `typeName` rather than per-notification UUIDs, so concurrent publishers compose additively. Adapters without atomic counter support (PostgreSQL LISTEN/NOTIFY) implement the methods as no-ops and rely on `FOR UPDATE SKIP LOCKED` for contention; adapters with native counters (Redis Lua, NATS JetStream KV) gate fan-out via the budget.

### New required `close()` method

Both `NotifyAdapter` and `StateAdapter` must now define `close(): Promise<void>`. Implementations must be **idempotent** (the second call is a no-op) and cascade into the underlying provider when one is owned. After `close()`:

- `NotifyAdapter` `notify*` / `listen*` calls reject.
- `StateAdapter` other methods may reject.

### Provider-level `close()` is optional

`PgNotifyProvider`, `PgStateProvider`, `RedisNotifyProvider`, and `SqliteStateProvider` now expose an **optional** `close?: () => Promise<void>`. Pass-through providers over caller-owned pools/clients (postgres.js, user-owned `pg.Pool`, user-owned redis client, user-owned sqlite driver) should omit it; only resource-owning providers (e.g. `createPgPoolNotifyProvider`, which manages a dedicated LISTEN client) define it. When defined, it must be idempotent. Note: `PgPoolNotifyProvider` no longer has its own type — `createPgPoolNotifyProvider` now returns plain `PgNotifyProvider`.

### Migration

**Custom `NotifyAdapter` authors:**

1. Drop the `count` parameter from `notifyJobScheduled` — it now takes only `typeName`.
2. Implement `provideWakeHint(typeName, count)` and `consumeWakeHint(typeName)`. If your transport has no atomic counter, make `provideWakeHint` a no-op and have `consumeWakeHint` always return `true`.
3. Implement an idempotent `close()` that releases internal resources (shared subscriptions, listener registries) and cascades into your provider's optional `close?.()`.
4. Workers now call `provideWakeHint(typeName, count)` before `notifyJobScheduled(typeName)`, and listeners gate `onNotification` on `await consumeWakeHint(typeName)`. Built-in adapters do this internally; if you wrap or reimplement the worker notification path, update the call sequence.

**Custom `StateAdapter` authors:**

1. Implement an idempotent `close()` that releases internal resources and cascades into your provider's optional `close?.()`.

**Custom provider authors (`PgNotifyProvider`, `PgStateProvider`, `RedisNotifyProvider`, `SqliteStateProvider`):**

- If your provider owns resources (dedicated connections, internal pools), expose an idempotent `close?.()`. If it's a pass-through over a caller-owned client, omit `close` entirely — the caller is responsible for tearing down their client.

**Application authors using built-in adapters:**

Close adapters explicitly before tearing down caller-owned pools/clients:

```ts
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await pool.end();
```

Calling `notifyJobScheduled(typeName, count)` on a built-in adapter no longer compiles — drop the second argument. Wake hints are issued by the worker pipeline internally; direct callers can ignore them.
