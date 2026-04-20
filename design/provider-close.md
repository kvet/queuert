# Provider & Adapter `close()`

Lift `close()` from an opt-in intersection on `PgPoolNotifyProvider` to a base method on every provider interface, and expose `close()` on the `StateAdapter` and `NotifyAdapter` contracts so teardown is uniform regardless of which provider variant the caller holds. Addresses the "provider close" item in [TODO.md](../TODO.md).

## Problem

Teardown in Queuert is asymmetric and order-sensitive, and most of the asymmetry is invisible at the type level.

- Only `PgPoolNotifyProvider` exposes `close()`, and only as an intersection type on top of the base `PgNotifyProvider`. Callers who construct the provider inline and keep only the adapter lose the one handle that would release the dedicated LISTEN client.
- `PgNotifyProvider` (postgres.js), `RedisNotifyProvider`, `PgStateProvider`, and `SqliteStateProvider` are pass-throughs that hold nothing — their type shows no `close()`, which is correct but creates a shape mismatch with the pool variant.
- Neither `StateAdapter` nor `NotifyAdapter` has a `close()`. The adapter is what users hold and what gets passed into `createClient`; the fact that it has no teardown point means every call site reinvents the sequence (stop worker, unsubscribe listeners, maybe call `provider.close()`, then tear down caller-owned clients).
- The required order (workers → adapters → user clients) is undocumented. Callers who release the pg `Pool` before the LISTEN client finishes draining get sporadic errors.

The problem is not that pass-through providers need a new method. It is that the adapter — the handle users actually hold — has no uniform way to say "release everything you own."

## Proposed

**Three layers, each adding one method.**

### 1. Provider interfaces — `close()` as a base contract, no-op for pass-throughs

```ts
export type PgNotifyProvider = {
  publish: (channel: string, message: string) => Promise<void>;
  subscribe: (channel: string, onMessage: (m: string) => void) => Promise<() => Promise<void>>;
  /** Release internally-held resources. No-op for pass-through providers. */
  close: () => Promise<void>;
};
```

Same addition on `PgStateProvider`, `SqliteStateProvider`, `RedisNotifyProvider`. The intersection in [packages/postgres/src/notify-provider/notify-provider.pg-pool.ts:5-7](../packages/postgres/src/notify-provider/notify-provider.pg-pool.ts#L5-L7) goes away — `close` is inherited. Pass-through impls supply `async () => {}`.

Idempotency is part of the contract: calling `close()` more than once is a no-op on the second call, and subsequent `publish`/`subscribe`/`executeSql` may reject. The `PgPoolNotifyProvider` already implements this shape ([packages/postgres/src/notify-provider/notify-provider.pg-pool.ts:93-97](../packages/postgres/src/notify-provider/notify-provider.pg-pool.ts#L93-L97)).

### 2. Adapter contracts — `close()` on `StateAdapter` and `NotifyAdapter`

```ts
export type NotifyAdapter = {
  // …existing methods
  /** Disposes shared listeners and closes the underlying provider. */
  close: () => Promise<void>;
};
```

```ts
export type StateAdapter<TTxContext, TJobId> = {
  // …existing methods
  /** Closes the underlying provider. No-op for pass-through state providers today. */
  close: () => Promise<void>;
};
```

In [packages/postgres/src/notify-adapter/notify-adapter.pg.ts:126-163](../packages/postgres/src/notify-adapter/notify-adapter.pg.ts#L126-L163), extend the shared-listener closure with a `dispose()` that force-tears the subscription regardless of current callback count, then:

```ts
close: async () => {
  await Promise.all([
    jobScheduledListener.dispose(),
    chainCompletedListener.dispose(),
    ownershipLostListener.dispose(),
  ]);
  await notifyProvider.close();
},
```

### 3. Documented teardown order

```ts
await stopWorker(); // stop polling & drain in-flight jobs
await notifyAdapter.close(); // unsubscribe listeners, release LISTEN client
await stateAdapter.close(); // release state-provider resources (if any)
await pool.end(); // then caller-owned clients
```

Document this in `docs/src/content/docs/advanced/` alongside the lifecycle sections, and in the example files.

## Why adapter-level `close()` earns its keep even when most providers are pass-through

The core package gets no runtime benefit from `StateAdapter.close()` today — every current state provider is pass-through. But:

1. **Future providers will need it.** A managed connection pool state provider, a prepared-statement cache, a queryable LISTEN-backed state sync — all need teardown. Lifting `close()` onto the adapter later is a breaking change; adding it now is free.
2. **Symmetry with `NotifyAdapter.close()` is what makes the teardown story teachable.** "Close the two adapters in order, then close your clients" is a rule users can remember. "Close the notify adapter, and for the state adapter only if … " is not.
3. **The adapter is the handle users hold.** Adding `close()` there means the provider variant becomes an internal detail — callers do not need to know which pg provider they constructed.

## Collisions and edge cases

### 1. Provider `close()` when the same pool backs state and notify

A common setup passes one `pg.Pool` to both `createPgStateProvider` and `createPgPoolNotifyProvider`. The notify provider's `close()` releases its dedicated LISTEN client back to the pool; the pool itself stays open until the caller ends it. No collision.

If a user somehow shares a single `PoolClient` between state and notify (not a supported pattern), they already have worse problems.

### 2. `close()` on postgres.js provider

postgres.js's `sql` is caller-owned and not tied to a pool client the provider holds. `close()` is `async () => {}`. Documented in the type doc comment; not load-bearing. Users still call `sql.end()` themselves.

### 3. `close()` during in-flight work

Calling `notifyAdapter.close()` while listeners are still attached force-tears them. Documented expectation: callers stop their workers first. `subscribe`/`publish` after close throws `"Provider is closed"` — matches the existing `PgPoolNotifyProvider` behavior.

### 4. Conformance test additions

Add to the provider conformance suite:

- `close()` followed by a second `close()` does not throw.
- `close()` followed by `publish`/`subscribe`/`executeSql` rejects.
- After `close()`, any previously returned unsubscribe functions are safe to call (they are already torn down — calling them is a no-op).

## Migration

Breaking change for custom provider implementations (they must add `close`). Not breaking for adapter consumers — `close()` on adapters is additive.

Scope:

- `packages/core` — 2 interface additions (`StateAdapter`, `NotifyAdapter`), 2 method implementations on in-process adapters.
- `packages/postgres` — remove intersection, move `close` onto base, add pass-through impls for postgres.js state+notify, wire adapter `close()`.
- `packages/sqlite` — add `close()` (no-op) to `SqliteStateProvider`, wire adapter.
- `packages/redis` — add `close()` (no-op) to `RedisNotifyProvider`, wire adapter.
- `examples/` — update teardown blocks to call `adapter.close()` before `pool.end()`.
- `docs/` — update provider-reference pages and add a lifecycle section.

Deprecation plan: none needed on the consumer side. For custom provider authors, ship a runtime warning for one minor release if a provider is passed without `close` (detect via `typeof provider.close !== "function"`), then require it in the next major.

## Alternatives considered

1. **Status quo.** Works, but users must know which provider variant they constructed. Error-prone.
2. **Keep `close()` only on providers, not adapters.** Solves the pool-variant discovery problem at the type level, but every caller still writes the "call provider.close if the variant has it" dance. Adapter-level close is what removes the dance.
3. **`dispose()` via `Symbol.dispose` / `using` syntax.** Ergonomic in TS 5.2+, but the adapters are held for the lifetime of a service — `using` fits short-lived scopes, not long-lived singletons. Easy to add later as an opt-in wrapper.
4. **Combined `createQueuertClient({ state, notify, pool })` factory that owns teardown.** Bigger API change. Conflates the adapter layer with ownership; many users deliberately keep the pool lifecycle outside Queuert (e.g. shared with their web server). Out of scope.

## Open questions

- **Does `StateAdapter.close()` belong in `@queuert/core` if no current state provider holds resources?** Leaning yes — the type is public, locking it in early avoids a future breaking change.
- **Should `close()` block or cancel in-flight `subscribe` calls?** Current `PgPoolNotifyProvider` sets `closed = true` and lets in-flight connects fail with `"Provider is closed"`. Matches the idempotency contract; confirm same shape everywhere.
- **Adapter `close()` when the client is still running.** `createClient` holds references to both adapters. Should `client.close()` exist and cascade? Separate design concern — track alongside the worker-lifecycle work.
