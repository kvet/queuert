---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

Replace `StateAdapter` FOR UPDATE getters with a `lock` option on the existing getters.

The two dedicated locking methods on `StateAdapter` collapse into the read getters via an optional `lock` parameter. Less surface, one row-fetch path per entity.

### `StateAdapter` contract changes

**Removed:**

- `StateAdapter.getJobForUpdate({ txCtx, jobId })`
- `StateAdapter.getLatestChainJobForUpdate({ txCtx, chainId })`

**Added** to the existing getters:

- `StateAdapter.getJobById({ txCtx, jobId, lock?: "exclusive" })`
- `StateAdapter.getJobChainById({ txCtx, chainId, lock?: "exclusive" })`

`lock: "exclusive"` is meaningful only inside a transaction. Backends that support row-level locking (Postgres, MySQL/MariaDB) acquire a write-intent lock and block concurrent locked reads on the same row until the transaction ends.

### Chain locking semantics

`getJobChainById` with `lock: "exclusive"` no longer locks the rootJob — it locks **only the latest job in the chain**: the rootJob when the chain has no continuation, otherwise the last continuation. This is the row callers actually extend; `chainTypeName` on the rootJob is immutable, so locking it earned nothing. The shape of the return value is unchanged (`[rootJob, lastJob]` or `undefined`); when there is no continuation, `lastJob` is `undefined`.

This affects `client.completeJobChain` (and equivalents), which previously called `getLatestChainJobForUpdate` and now calls `getJobChainById({ lock: "exclusive" })` and reads `lastJob ?? rootJob`.

### Implementation differences

- **Postgres** ships dedicated `getJobByIdLockedSql` and `getJobChainByIdLockedSql` variants. The job variant adds `FOR UPDATE` to the row select; the chain variant uses a `LEFT JOIN LATERAL` that applies `FOR UPDATE` to the latest-continuation subquery only.
- **SQLite** has no row-level `FOR UPDATE`. The locked job variant runs `UPDATE … SET id = id WHERE id = ? RETURNING *` — a no-op write that promotes the deferred transaction to RESERVED, blocking other writers until commit. The chain variant runs the same no-op `UPDATE … SET id = id` against the latest chain job before reading the chain pair via the existing read SQL.

### Migration

If you maintain a custom `StateAdapter`:

1. Delete your `getJobForUpdate` and `getLatestChainJobForUpdate` implementations.
2. Add an optional `lock?: "exclusive"` parameter to `getJobById` and `getJobChainById`.
3. When `lock === "exclusive"` is passed inside a transaction, acquire a write-intent lock on the row before (or as part of) the read. For `getJobChainById`, lock only the latest job in the chain, not the rootJob.
4. Outside a transaction, or when `lock` is omitted, behave exactly as before.

If you only consume `StateAdapter` (or use the bundled adapters), no changes are required beyond rebuilding against the new types — there are no remaining call sites of the removed methods in user code.
