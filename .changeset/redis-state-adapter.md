---
"@queuert/redis": minor
"queuert": patch
---

Add an experimental Redis state adapter, `createRedisStateAdapter`, that keeps chains, jobs and workers in Redis, standalone or Cluster; its API may change in a minor release. Redis has no interactive transactions, so these transactions are optimistic: reads record what they saw, writes are buffered, and one Lua script commits them only if nothing read changed, running the transaction callback again otherwise. A common setup is a PostgreSQL or SQLite Queuert used as a transactional outbox whose handlers start chains in a Redis Queuert.

- `createRedisStateAdapter({ stateProvider, keyPrefix?, maxTransactionTries? })` and the `RedisStateProvider` type: a provider is one `eval(script, keys, args)` over any Redis client.
- `migrateToLatest()` on the adapter, required before it writes; processes may run it at once and take turns through a lease.
- A schema write fence in `{keyPrefix}schema-fences`: writes of code whose schema version a later migration retired fail with `SchemaFencedError` and change nothing.
- `keyPrefix` must contain a hash tag such as `{queuert}`, so a Cluster keeps every key in one slot.
- Job ids, worker ids and type names that contain a lone UTF-16 surrogate are rejected with an error, since Redis scripts cannot decode them.
- `RedisTransactionConflictError` when a transaction keeps conflicting after `maxTransactionTries` tries.
- A commit or claim that the client resends after a reconnect applies once.
- An exclusive read of a pending job, such as the one `completeChain` takes, keeps workers from claiming that job until the transaction settles or 60 seconds pass.
- No transaction waits on another, so cases that expect a lock wait do not apply; `redisStateAdapterLockWaitCaseNames` lists them.
- `createRedisStateProviderConformanceContext` and `redisStateProviderConformanceCases` from `@queuert/redis/conformance`.
- Client methods accept a transaction context whose only keys are symbols, as the Redis adapter's context is.
- The `queuert/conformance` state adapter cases gain a check of `listChains` with `independent: false` across pages and inside a transaction.
