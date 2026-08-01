# SQLite write promotion

Replace the per-query no-op `UPDATE` statements that promote a deferred SQLite transaction to a write transaction with a single dedicated sentinel table, and decide where promotion happens. Part of the SQLite production-readiness epic — see the concurrency-model workstream in [sqlite-ready.md](./sqlite-ready.md), which this gates: dropping `createAsyncRwLock` for pooled WAL connections is what makes the failure below reachable.

## Problem

SQLite has no row-level locking. `lock: "exclusive"` on `getChains` / `getJobs` is implemented by issuing a no-op `UPDATE ... SET id = id` against the rows the caller is about to read, which promotes the transaction from a read snapshot to a write transaction (RESERVED). Three things are wrong with that shape.

**1. The row targeting is ceremony.** SQLite's write lock is database-wide, so _which_ rows the promoting statement touches is irrelevant — an `UPDATE` matching zero rows promotes exactly as well as one matching the target rows. Measured on better-sqlite3 in WAL mode, connection B attempting `BEGIN IMMEDIATE` while connection A holds the transaction:

```
after BEGIN (deferred):   B could still write   (NOT promoted)
after zero-row UPDATE:    B blocked, SQLITE_BUSY (PROMOTED)
```

Yet `getChainsByDeduplication` pays for the targeting anyway: [state-adapter.sqlite.ts:890-921](../packages/sqlite/src/state-adapter/state-adapter.sqlite.ts#L890-L921) duplicates the entire deduplication-resolve subquery inside the locked `UPDATE`, with a reversed parameter order (and a comment explaining the reversal) purely to keep the two copies in sync. Every future change to dedup resolution has to be made twice, and a drift between the copies is silent — the promotion still succeeds, so nothing fails.

**2. Late promotion is unsound under WAL.** Once a transaction has taken a read snapshot, promoting fails if any other connection committed in the meantime — including a commit to an unrelated table:

```
read → external commit to another table → promote:  SQLITE_BUSY_SNAPSHOT
```

`SQLITE_BUSY_SNAPSHOT` is not retryable in place; `busy_timeout` does not apply and the whole transaction must be rolled back and replayed. Any "promote lazily, on the first `lock: "exclusive"` read" design therefore carries a latent multi-process failure mode that no amount of retry tuning at the statement level fixes. This is invisible today because the bundled providers run a single connection behind `createAsyncRwLock`, so there is never a competing writer — it becomes live exactly when [sqlite-ready.md](./sqlite-ready.md) drops the rwlock for pooled WAL connections.

**3. `BEGIN IMMEDIATE` cannot be mandated.** Promoting up front in `withTransaction` would sidestep (2) entirely, and costs nothing under the current design (`withTransaction` already unconditionally acquires the rwlock's _write_ lock, so every transaction is already a writer by construction). But `SqliteStateProvider` is a public extension point, and users bring their own transaction handling — ORM-native `db.transaction()` (kysely, drizzle, prisma) generally issues plain `BEGIN` with no way to ask for `IMMEDIATE`. Users also open their own transactions and hand queuert a `txCtx`. So "providers must begin transactions in IMMEDIATE mode" is a contract we can document but cannot enforce or rely on. The adapter needs a promotion mechanism that works regardless of how the surrounding transaction was started.

## Proposed

A dedicated single-row sentinel table, created by the migration alongside `job` / `job_blocker`, whose only purpose is to be written to:

```sql
CREATE TABLE {{table_prefix}}serializator (id INTEGER PRIMARY KEY, ...);
INSERT INTO {{table_prefix}}serializator (id, ...) VALUES (1, ...);
```

Promotion becomes one cached, parameterless statement shared by every call site:

```sql
UPDATE {{table_prefix}}serializator SET ... WHERE id = 1
```

Verified to promote (same harness as above, sentinel written before any read):

```
sentinel-first:  B blocked, SQLITE_BUSY (PROMOTED)
```

This mirrors the role `queuert_migration_lock` plays on Postgres ([state-adapter.pg.ts:472](../packages/postgres/src/state-adapter/state-adapter.pg.ts#L472)): a table that exists to carry a lock, not data.

What it buys:

- **Deletes the duplicated dedup-resolve SQL** and the four `*Locked` statement variants (`getChainsLocked`, `getChainsByDeduplicationLocked`, `getJobsLocked`, and the chain-tail sibling), along with the `lock === "exclusive" && txCtx` branches that select between them.
- **Works under any transaction mode**, including user-managed transactions and ORM-native `BEGIN` — no provider contract change required.
- **Self-documenting** at the call site, and immune to a future query planner eliding a `WHERE 0` no-op.

The costs: one extra table in the schema, a migration, and a table that will confuse anyone reading the schema without the docs.

## Open questions

- **Where does the promotion statement run?** Two options, with different soundness:
  - **Eagerly, first statement in `withTransaction`** — sound (no snapshot exists yet, so `BUSY_SNAPSHOT` is impossible), but makes _every_ queuert transaction a writer, serializing read-only transactions against each other cross-process. Under today's design that is already true, so it costs nothing now; it forecloses a future read-only transaction path.
  - **Lazily, on the first statement that needs write intent** — preserves concurrent read-only transactions, but reintroduces exactly the `BUSY_SNAPSHOT` window described above whenever a `lock: "exclusive"` read follows an unlocked read in the same transaction. Would need a documented rollback-and-replay story for callers.
  - A middle option: promote eagerly, but let the provider opt out via a `readOnly` hint on `withTransaction` for transactions the adapter knows never write.
- **Cannot cover user-managed transactions that read first.** If a user opens their own transaction, reads, then calls a queuert mutating method with that `txCtx`, promotion happens after their snapshot was taken and can fail with `BUSY_SNAPSHOT` regardless of which mechanism we use. Options: document it, expose a `promoteTransaction(txCtx)` helper users call first, or accept the failure and surface it as a typed retryable error.
- **What does the sentinel row hold?** A bumped counter is the obvious choice but writes a new page every transaction (WAL growth, checkpoint pressure). `SET id = id` on the sentinel row promotes without dirtying content — confirm it still forces the write transaction rather than being optimized to a no-op, and measure WAL impact either way.
- **Naming.** `serializator` reads oddly in English; `write_lock`, `tx_lock`, or `serialization_lock` are candidates. Whatever is chosen becomes a permanent user-visible table name.
- **Does `lock: "exclusive"` remain a no-op semantically?** With eager promotion, every transaction already holds the write lock, so the parameter has no effect on SQLite at all — which is what [sqlite-internals.md:108](../docs/src/content/docs/advanced/sqlite-internals.md#L108) already claims. Decide whether the adapter keeps accepting it for cross-adapter uniformity (and documents it as a no-op) or whether that claim moves into the conformance suite.
- **Interaction with the batched-write work** in [sqlite-ready.md](./sqlite-ready.md) — if `createJobs` / `addJobsBlockers` collapse to fewer statements, the promotion statement becomes a proportionally larger share of a write transaction's round-trips. Worth measuring before committing to eager promotion on every transaction.

## Testing

- Conformance case: with two connections against a file-backed WAL database, a transaction that has promoted blocks a second writer (`SQLITE_BUSY`), and one that has not does not. Requires the multi-connection fixture that `transactionConcurrency: "serialized"` currently causes the suite to skip.
- Regression case for the failure this design exists to prevent: read → external commit → promote must not raise `SQLITE_BUSY_SNAPSHOT` under the chosen promotion point.
