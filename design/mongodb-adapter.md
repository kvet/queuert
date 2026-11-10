# MongoDB adapter

Add `@queuert/mongodb`: a state adapter and a notify adapter for MongoDB replica sets, with providers that join the user's `ClientSession` so chains are created and completed in the same transaction as their domain writes. MongoDB transactions run at snapshot isolation, with no lock waits, no `SKIP LOCKED` and no savepoints. The adapter therefore applies the write-based bookkeeping of `design/pg-isolation-levels.md` and the chain/job split of `design/chain-table.md` from its first release, and adds a retry helper for user transactions.

## Goals

- Pass `runStateAdapterConformance` and the shared processing suites, with the divergences listed under [Contract divergences](#contract-divergences) and no others.
- Join the user's transaction from the official `mongodb` driver, Mongoose and MikroORM.
- No change to the client, worker or processor API, and no state adapter contract change required to ship.

Non-goals for the first release: tuning for sharded collections, MongoDB-compatible services (DocumentDB, Cosmos DB, FerretDB), and unbounded blockers.

## Packaging: one adapter, thin providers

One package, `@queuert/mongodb`, exports `createMongoStateAdapter`, `createMongoNotifyAdapter`, the `MongoStateProvider` and `MongoNotifyProvider` types, and `withMongoTransaction` (see [User transactions](#user-transactions-withmongotransaction)). It follows the shape of `@queuert/postgres`.

There are no per-client adapters. On PostgreSQL every client speaks SQL, so the provider's job is to execute SQL. On MongoDB every client that supports transactions (the official driver, Mongoose, Typegoose, MikroORM) ends up holding a native `ClientSession` and a native `Db`. The provider's only job is to hand those two objects over, and the adapter issues every command through the native driver. One adapter, one query layer, one set of indexes to explain.

| Client           | Joinable session                                                                               | Status                                      |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `mongodb` (6, 7) | `ClientSession`                                                                                | Supported; example `state-mongodb-native`   |
| Mongoose 8, 9    | `connection.startSession()` returns a native `ClientSession`; `connection.db` is a native `Db` | Supported; example `state-mongodb-mongoose` |
| Typegoose        | Mongoose's session                                                                             | Covered by the Mongoose provider            |
| MikroORM 7       | `MongoConnection.getClient()`, the transaction context is a `ClientSession`                    | Feasible; example later                     |
| Prisma           | Prisma 7 dropped MongoDB; Prisma 6 exposes no session to third parties                         | Unsupported                                 |
| TypeORM          | No transactions on MongoDB                                                                     | Unsupported                                 |

Providers live in examples, as on PostgreSQL. The provider is about fifteen lines, so the docs Setup tabs show it in full.

## Provider

```ts
export type MongoStateProvider<TTxContext extends BaseTxContext> = {
  /** Runs `fn` in a transaction on a new session. May run `fn` again after a transient error. */
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  /** `session.inTransaction()`. */
  isTransaction: (txCtx: TTxContext) => boolean;
  /** The native session carried by `txCtx`. */
  getSession: (txCtx: TTxContext) => MongoSession;
  /** The native database the adapter's collections live in. */
  db: MongoDb;
  close?: () => Promise<void>;
};
```

`MongoSession` and `MongoDb` are structural types (the subset of `ClientSession`, `Db` and `Collection` the adapter calls), not imports of the driver's classes. Mongoose ships `mongodb` as a regular dependency, so a Mongoose application often has two copies of the driver, and nominal types or `instanceof` checks would reject its session. The structural types are the compatibility boundary, and `mongodb` is an optional peer dependency (`^6.0.0 || ^7.0.0`) used only for the notify provider example and the tests. The adapter must not use driver APIs that v7 removed (`ClientSession.transaction`, per-operation `retryWrites`, cursor `stream()` transforms).

The native provider in full:

```ts
export const createMongoClientProvider = ({
  client,
  dbName,
}: {
  client: MongoClient;
  dbName: string;
}) => ({
  db: client.db(dbName),
  withTransaction: async (fn) =>
    client.withSession(async (session) =>
      session.withTransaction(async () => fn({ session }), TX_OPTIONS),
    ),
  isTransaction: ({ session }) => session.inTransaction(),
  getSession: ({ session }) => session,
});

const TX_OPTIONS = {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
  readPreference: "primary",
};
```

The transaction context is `{ session }`, the name the native driver and Mongoose already use in their options objects, so `complete({ session, txHooks, output })` reads like any other call.

## Transactions and isolation

### What MongoDB gives

MongoDB has no isolation-level setting. Every multi-document transaction reads from one snapshot and detects write-write conflicts at write time. Spike results (MongoDB 8.0.34, single-node replica set, driver 7.8):

| Situation                                                      | PostgreSQL READ COMMITTED                 | MongoDB transaction                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Transaction B writes a document that uncommitted A wrote       | B waits, then re-reads the latest version | B fails at once with 112 `WriteConflict` (`TransientTransactionError`), and the transaction is dead |
| Non-transactional write of a document that uncommitted A wrote | Waits                                     | Waits until A ends (3 s when A committed at 3 s), then the server retries it internally             |
| Read of a document that uncommitted A wrote                    | Old version, no wait                      | Old version, no wait                                                                                |
| `findOneAndUpdate` whose filter matches a document A holds     | `SKIP LOCKED` skips it                    | In a transaction: 112. Outside one: waits for A. Nothing skips                                      |
| Read-check in one transaction, write in another                | Fresh snapshot per statement              | Write skew: both commit                                                                             |
| Any error in a transaction, including 11000 duplicate key      | Transaction aborted                       | Transaction aborted; 11000 carries no transient label, so the driver does not retry it              |
| Deadlock                                                       | 40P01 after detection                     | Impossible: nobody waits inside a transaction                                                       |
| Savepoints                                                     | Yes                                       | No                                                                                                  |
| Transaction lifetime                                           | Unbounded                                 | `transactionLifetimeLimitSeconds`, 60 s by default; the server aborts older transactions            |

MongoDB transactions behave like PostgreSQL REPEATABLE READ, with first-writer-wins conflicts that abort immediately instead of after a lock wait. No setting gives SERIALIZABLE.

### Rule: every invariant is a write-write conflict on a shared document

The rule from `design/pg-isolation-levels.md`, with one MongoDB addition: **the write must change the document**. In the spike a `$set: { hasDependents: true }` on a document where it was already `true` reported `modifiedCount: 0` and produced no conflict. Every write that exists to produce a conflict is a `$inc` of a `lockSeq` field.

| Invariant                                           | Shared document            | Writer A                                                 | Writer B                                        |
| --------------------------------------------------- | -------------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| Attach to blocker K vs completion of K              | chain K                    | `addJobsBlockers`: `$inc lockSeq`, `hasDependents: true` | `completeJobs`: `status: completed`             |
| Two blockers of one dependent complete concurrently | the dependent job          | `unblockJobs` decrements `blockersRemaining`             | the same, for the other blocker                 |
| Attach to K vs deletion of K                        | chain K                    | `$inc lockSeq`                                           | `deleteChains` deletes it                       |
| Continuation vs deletion of the chain               | the continued job          | `continueJobs` completes it                              | `deleteChains` deletes it                       |
| `fence`, `getJobs({ lock })`, `getChains({ lock })` | the job and its chain      | `$inc lockSeq` on both                                   | any write to either (reclaim, complete, delete) |
| Claim vs reclaim of the claiming worker             | the worker                 | `startJobAttempts` extends the lease in its transaction  | reclaim deletes the worker                      |
| Two chains created with one deduplication key       | the deduplication document | upsert                                                   | upsert                                          |

`lock: "exclusive"` is this write. SQLite already emulates locks with a no-op write to its `write_lock` table; on MongoDB it has to be a real change. Lock order no longer matters, because a conflict aborts instead of waiting.

### Conflicts abort instead of waiting: retries

On PostgreSQL a second locking transaction waits. On MongoDB it fails with 112, and someone has to run it again. Three cases:

- **Transactions Queuert opens** (`stateAdapter.withTransaction`: worker registration, reclaim, stop, own-jobs and tokenless reclaim) go through the provider, whose `session.withTransaction` reruns the callback on `TransientTransactionError` until `transactionRetryTimeoutMs` (default 30 s, below the driver's 120 s). Every one of these callbacks in `packages/core/src/worker/run-worker.ts` touches only state, and announces reclaimed jobs after the transaction returns, so a rerun is safe. The state adapter documents this as a contract requirement for callbacks passed to `withTransaction`, and a test runs each worker transaction against an injected 112. A rerun that waits for the conflicting transaction to end is the MongoDB equivalent of PostgreSQL's lock wait.
- **Multi-document writes without a `txCtx`** (`startJobAttempts`, `rescheduleJobs` with several jobs, `deleteChains`) are one statement on PostgreSQL. On MongoDB an `updateMany` outside a transaction is atomic per document only, so the adapter wraps these in its own retried transaction. Single-document calls (`extendWorkerLease`, `startWorker`, `stopWorker`, a one-job `rescheduleJobs`) stay autocommit; the server retries their conflicts internally.
- **User transactions** (client methods, `complete`, `fence`) fail with 112 when they meet a concurrent worker or client write. The user retries them; the driver's own retry needs `txHooks.retryBoundary`, which is the next section.

### User transactions: `withMongoTransaction`

`session.withTransaction` and Mongoose's `connection.transaction` rerun the callback after a transient error. `withTxHooks` must wrap the transaction from outside so its hooks flush after commit. Combined, a rerun reuses the same `txHooks`:

- `complete` throws `complete already succeeded with these txHooks` on the second run (`packages/core/src/attempt/attempt-handler.ts:105`). The error is not transient, so the retry stops and the attempt fails.
- `createChain` buffers its observability events and `notifyJobsScheduled` for the rolled-back first run too, and the flush after the successful second run emits events for a chain id that was never committed.

`txHooks.retryBoundary` (see `docs/src/content/docs/guides/tx-hooks.mdx`) fixes both: it rolls back what the previous try buffered each time the driver calls the callback again. `withMongoTransaction` packages `withTxHooks`, `session.withTransaction` with `TX_OPTIONS`, and `retryBoundary`:

```ts
await withMongoTransaction({ client }, async ({ session, txHooks }) => {
  await orders.insertOne(order, { session });
  await queuert.createChain({
    session,
    txHooks,
    typeName: "send-receipt",
    input: { orderId },
  });
});
```

The driver reruns the callback on a `TransientTransactionError` and retries only the commit on `UnknownTransactionCommitResult`; `retryBoundary` rolls back the previous try's hooks on each rerun, and `withTxHooks` flushes the last try's hooks after the commit. It accepts `{ client }` or `{ session }` (an existing Mongoose or MikroORM session), and needs no state adapter. It is built only from `withTxHooks`, `retryBoundary` and the driver, so it can live in `@queuert/mongodb`.

The docs say: use `withMongoTransaction` around every transaction that calls Queuert, or wrap the callback of `session.withTransaction` or `connection.transaction` in `txHooks.retryBoundary`. A test runs `createChain` and `complete` inside `session.withTransaction` with an injected conflict after the Queuert call, and asserts the two failure modes above without `retryBoundary` and neither with it, so the docs stay true.

### Required settings

- **Write concern `majority`.** A claim or completion acknowledged with `w: 1` can be rolled back on failover, which double-runs an attempt or loses a completion. `majority` is the server default since 5.0, except on replica sets with an arbiter (PSA), where it falls back to `w: 1`. The adapter sets it on the transactions and writes it issues; for user transactions the docs require it.
- **Read concern `snapshot`** in transactions the adapter opens, and for its multi-collection reads outside transactions (`getChains` joining head and tail; supported for `find` and `aggregate` since 5.0). Correctness does not depend on the read concern of user transactions, because conflicts are detected by the storage engine. `snapshot` only guarantees a majority-committed snapshot when the transaction also commits with `w: majority`.
- **Read preference `primary`** for every adapter read. List and count queries could later go to secondaries, like the PostgreSQL provider's `readOnly` flag; not in the first release.
- **Replica set or sharded cluster.** A standalone server has no transactions or change streams. `migrateToLatest` checks `hello` and fails with a clear error on a standalone.
- **Short user transactions.** `transactionLifetimeLimitSeconds` (60 s) aborts longer ones. While a user transaction holds a pending job (for example `client.rescheduleJobs` on it), autocommit claims whose candidates include that job wait for it (see [Claiming](#claiming-startjobattempts)).

### Savepoints

MongoDB has none. Core never issues database savepoints (`txHooks.withSavepoint` only snapshots hook state), so nothing in the adapter needs them. The test fixture leaves `withSavepoint` undefined, and the savepoint cases in `process.test-suite.ts` skip, as on SQLite.

## Data model

Five collections, each named `{collectionPrefix}{name}` (`collectionPrefix` defaults to `queuert_`, mirroring `tablePrefix`).

**`chains`**: one document per chain, `_id` = the head job's id (the contract's `chain.id === head.id` holds; the separate chain id of `design/chain-table.md` can follow when the contract adopts it).

```ts
{ _id, typeName, status: "running" | "completed", deduplicationKey, createdAt, completedAt,
  traceContext, hasDependents, hasBlockers, lockSeq }
```

**`jobs`**: one document per job. Blocker rows are embedded in the dependent, which `maxBlockersPerJob` (default 100) bounds.

```ts
{ _id, chainId, chainIndex, typeName, status, input, output, createdAt, scheduledAt, completedAt,
  completedBy, continuedToId, attempt, attemptAt, attemptBy, attemptToken, lastAttemptAt,
  lastAttemptError, traceContext, lockSeq,
  blockers: [{ chainId, index, traceContext }], blockersRemaining }
```

**`workers`**: `{ _id, typeNames, concurrency, startedAt, leaseUntil, token }`.

**`deduplication`**: `{ _id: [typeName, key], chainId, createdAt, chainStatus }` (see [Deduplication](#deduplication)).

**`migrations`** and **`migration_lock`**: as on PostgreSQL.

`input`, `output` and `lastAttemptError` are stored as BSON values. Queuert hands the state adapter JSON-serializable values: `defineJobTypes` rejects non-JSON `input` and `output` types at compile time, and a `createJobTypes` registry checks every encoded value at runtime. So the adapter stores them as BSON without a JSON round-trip, and BSON's `Date` handling never comes into play. Ids are strings (`_id: string`); BSON UUIDs are a later option. Timestamps are BSON dates with millisecond precision (PostgreSQL: microseconds), so keyset cursors rely on the `_id` tiebreak more often; the cursor format in `packages/core/src/state-adapter/cursor.ts` is unchanged.

Splitting chains from jobs is cheaper here than on PostgreSQL: there is no migration, and it removes head-row aliasing from the start. A claim, reschedule or reclaim writes only the job document, so it never conflicts with a user transaction that attaches the chain as a blocker or locks it.

### Indexes

| Collection      | Index                                                                                                                                        | Serves                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `jobs`          | `{ chainId: 1, chainIndex: 1 }` unique                                                                                                       | head/tail lookup, `listChainJobs`, chain-position conflicts      |
| `jobs`          | `{ typeName: 1, scheduledAt: 1, _id: 1 }`, partial `status: "pending"`                                                                       | claims, `getStartAttemptDelayMs`, lists                          |
| `jobs`          | `{ typeName: 1, scheduledAt: 1, _id: 1 }`, partial `status: "blocked"`                                                                       | lists, counts                                                    |
| `jobs`          | `{ typeName: 1, attemptAt: 1, _id: 1 }`, partial `status: "running"`                                                                         | lists, counts                                                    |
| `jobs`          | `{ typeName: 1, completedAt: 1, _id: 1 }`, partial `status: "completed"`                                                                     | lists, counts                                                    |
| `jobs`          | `{ typeName: 1, createdAt: 1, _id: 1 }`                                                                                                      | lists without status, `getJobTypeNames` (`DISTINCT_SCAN`)        |
| `jobs`          | `{ attemptBy: 1, attemptAt: 1, _id: 1 }`, partial `status: "running"`                                                                        | `listWorkerJobs`, `countRunningJobsByWorkerId`, reclaim          |
| `jobs`          | `{ "blockers.chainId": 1 }`, sparse multikey                                                                                                 | `unblockJobs`, `listBlockedJobs`, `deleteChains` reference check |
| `chains`        | `{ typeName: 1, createdAt: 1, _id: 1 }`, plus partial `status: "running"` and `{ typeName, completedAt, _id }` partial `status: "completed"` | `listChains`, counts                                             |
| `workers`       | `{ startedAt: 1, _id: 1 }`                                                                                                                   | `listWorkers`, reclaim candidates                                |
| `deduplication` | `_id`                                                                                                                                        | deduplication                                                    |

Filters use plain values or `$expr` comparisons against `$$NOW`. In the spike `$expr: { $lte: ["$scheduledAt", "$$NOW"] }` used the partial index with bounds `[MinKey, now]`. `$expr` never uses multikey, partial or sparse indexes for anything other than these simple comparisons, so each query's plan is captured in the query-performance benchmark (see [Tests](#tests)).

## Operations

Each method keeps a constant number of round trips regardless of batch size. "tx" means the method runs in the caller's transaction or, without a `txCtx`, in one the adapter opens.

| Method                                           | Implementation                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getChains`                                      | One `aggregate` on `chains` with `$lookup` of head (`chainIndex: 0`) and tail (`chainIndex` desc, limit 1). `lock`: first `updateMany({ _id: { $in } }, { $inc: { lockSeq: 1 } })`.                                                                                                                                                      |
| `getJobs`                                        | `find` + `$lookup` of the chain. `lock`: `$inc lockSeq` on the jobs and on their chains.                                                                                                                                                                                                                                                 |
| `getWorkers`                                     | `find`; `expired` computed with `$$NOW` in an `aggregate` projection. `lock`: `$inc lockSeq`.                                                                                                                                                                                                                                            |
| `createJobs` (tx)                                | Deduplication upserts first (below), then `insertMany` of chains and of head jobs. A duplicate id raises 11000, which kills the transaction, which is acceptable because the contract makes it a throw. No other statement may raise 11000.                                                                                              |
| `continueJobs` (tx)                              | `updateMany` of the parents with the attempt-token guard and `status: completed`, then `find` of the matched parents (`continuedToId` set by this call), then `insertMany` of successors at `chainIndex + 1`. The unique index catches duplicate positions.                                                                              |
| `completeJobs` (tx)                              | Guarded `updateMany` on jobs, then `updateMany` on chains (`status: completed`, `completedAt: $$NOW`), then a read returning `hasDependents`.                                                                                                                                                                                            |
| `rescheduleJobs`                                 | Guarded pipeline `updateMany` (`scheduledAt: { $max: [at, "$$NOW"] }`); tx when more than one job.                                                                                                                                                                                                                                       |
| `deleteChains` (tx)                              | `find` of jobs whose `blockers.chainId` is in the set and whose `chainId` is not; if any, return them and delete nothing. Otherwise `deleteMany` of jobs and chains and their deduplication documents.                                                                                                                                   |
| `addJobsBlockers` (tx)                           | `updateMany` on blocker chains `{ $inc: { lockSeq: 1 }, $set: { hasDependents: true } }`, `find` of their status, then a `bulkWrite` setting each dependent's `blockers`, `blockersRemaining` (running blockers) and `status: blocked` when above zero, and `hasBlockers` on its chain.                                                  |
| `unblockJobs` (tx)                               | `find` of dependents with `status: blocked` and `blockers.chainId: X`, a pipeline `updateMany` that subtracts the count of matching blocker entries and moves the result to `pending` with `scheduledAt: { $max: ["$scheduledAt", "$$NOW"] }` at zero, then a `find` for the results. Skipped when the chain's `hasDependents` is false. |
| `startJobAttempts`                               | See [Claiming](#claiming-startjobattempts).                                                                                                                                                                                                                                                                                              |
| `getStartAttemptDelayMs`                         | `find` of the earliest pending `scheduledAt` per type, `limit 1` each, in one `aggregate` with `$unionWith`.                                                                                                                                                                                                                             |
| `startWorker`, `extendWorkerLease`, `stopWorker` | Single-document `insertOne` / pipeline `updateOne` (`leaseUntil: { $add: ["$$NOW", leaseMs] }`, filter `token` and `$expr: { $gt: ["$leaseUntil", "$$NOW"] }`) / `deleteOne`. Tokens are generated with `crypto.randomUUID()` in the adapter; MongoDB has no server-side UUID function in updates.                                       |
| Counts                                           | One `aggregate` per call: a `$unionWith` branch per (type, status), each `$match` + `$limit: countCap + 1` + `$count`. Not `$facet`: its sub-pipelines cannot use indexes.                                                                                                                                                               |
| Lists                                            | `find` with the keyset predicate `{ $or: [{ col: { $gt: v } }, { col: v, _id: { $gt: id } }] }`, `limit + 1`, then `$lookup` of chains.                                                                                                                                                                                                  |
| Type names                                       | `distinct("typeName")` on the `{ typeName, createdAt }` indexes.                                                                                                                                                                                                                                                                         |

`$$NOW` is constant within a statement but, unlike PostgreSQL's `now()`, advances between statements of one transaction (+1503 ms after a 1.5 s sleep in the spike). That matches the PostgreSQL adapter, which uses `statement_timestamp()` everywhere. Client time is never used except for the caller's `schedule.at`, which is clamped to `$$NOW` as on PostgreSQL.

### Claiming (`startJobAttempts`)

PostgreSQL claims with `FOR UPDATE SKIP LOCKED` in one statement gated on the worker's live lease. MongoDB has neither skip-locked nor a cross-document statement. Spike, 20,000 pending jobs, 8 worker processes, `limit` 10, no duplicate claims in any strategy:

| Strategy                                                                                                                         | jobs/s      | Round trips per batch | Transaction aborts |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------- | ------------------ |
| `findOneAndUpdate` × `limit`, autocommit                                                                                         | 1,055–1,162 | 10                    | —                  |
| `find` 30 candidates, shuffle, `updateMany({ _id: { $in }, status: "pending" })` with a batch token, `find` by token; autocommit | 3,489–3,790 | ~10.6                 | —                  |
| Same, in a transaction that first extends the worker's lease                                                                     | 1,825–1,868 | ~6.7 + commit         | ~48% of attempts   |
| `bulkWrite` of `updateOne` with `sort` (MongoDB 8.0 only), then `find`; autocommit                                               | 1,553–2,302 | 2                     | —                  |

Shuffling the candidates matters: without it, concurrent claimers fight over the same oldest jobs and return short batches while jobs remain (91–117 times per run), which the contract forbids.

**Design: the transactional, shuffled variant.** The claim transaction starts with a pipeline `updateOne` on the worker document (`token` matches, `leaseUntil > $$NOW`, `$inc lockSeq`) and claims nothing if it matched nothing. Reclaim deletes the worker document, so a claim and a reclaim of the same worker conflict and one of them reruns. This keeps the contract's "claims only under a live lease" exactly, at about half the autocommit throughput. Aborts come from claimers meeting each other's candidates, and the adapter's retry absorbs them. Candidates are `3 × limit`, taken per type name in random order (as PostgreSQL does), shuffled, and the transaction reruns while the batch is short and the candidate scan found more.

The autocommit variant is faster but cannot gate atomically: a claim that passed its lease check just before a reclaim deleted the worker would leave jobs running under a worker with no document, which no reclaim reaches. Making it safe needs a sweep for running jobs whose `attemptBy` has no worker document, a generalization of the tokenless-jobs sweep. That is a later optimization with its own design, once benchmarks show the claim path is the bottleneck.

`hasBlockers` comes from the claimed documents' `blockers` field, with no extra query.

**Held candidates.** A claim cannot skip a candidate held by an uncommitted user transaction: its `updateMany` gets 112 and the claim transaction reruns. Each rerun draws a new shuffled candidate set, so the held job is usually left out, but a held job among few pending ones can keep a claim rerunning until that transaction ends or the retry timeout passes. Pending jobs are held only by user transactions that reschedule or delete a pending job. Jobs that a transaction inserts or unblocks are not yet visible to the claim's snapshot and do not conflict. The claim tests include a long user transaction holding the only due job.

### Deduplication

PostgreSQL deduplicates best-effort (a non-unique index; two concurrent transactions can both insert). MongoDB can do it exactly, at the cost of one more collection. `createJobs` upserts `deduplication` documents keyed by `[typeName, key]` with a pipeline that replaces `chainId` with the new chain's id only when the document is new, or when scope is `running` and `chainStatus` is `completed`. The call deduplicated when the returned `chainId` is not its own. `completeJobs` mirrors `chainStatus` onto the deduplication document of a chain that has a key.

In the spike, 16 concurrent transactions with one key produced one chain and 15 deduplicated results after retries (31 attempts), with 112 for every loser and never 11000: upserts never raise a duplicate key error inside a transaction, which keeps the transaction alive. The same document carries a future time-window scope (`createdAt < $$NOW − window`) without another index.

The deduplication documents are the write-write conflict that makes it exact, so concurrent `createChain` calls with one key now conflict and one reruns. The docs state that deduplication on MongoDB is exact and contended; on PostgreSQL it stays best-effort.

## Notify adapter

`createMongoNotifyAdapter({ notifyProvider, collectionName = "queuert_notifications" })`, with the same three channels as the PostgreSQL adapter and `MongoNotifyProvider` the same shape as `PgNotifyProvider` (`publish(channel, messages)`, `subscribe(channel, onMessage)`, `close?`).

- `publish` inserts `{ c: channel, m: message, at: new Date() }` documents with `insertMany`, outside any transaction (core publishes after commit). The collection is a regular one with a TTL index on `at` (60 s). Capped collections cannot be written in a transaction (error 263) and are unavailable on most compatible services, and a tailable cursor needs a capped collection, so change streams are the only option.
- `subscribe` uses one change stream per provider (`$match: { operationType: "insert" }`, `fullDocument` projected to `c` and `m`) and fans out in process through `createSharedListener`, as the PostgreSQL adapter does with one `LISTEN` connection. Delivery latency in the spike: 0.2 ms p50, 0.9 ms p99. Aborted transactions emit nothing.
- **Connection pool.** Each open change stream holds a pooled connection for up to `maxAwaitTimeMS`. In the spike 200 idle streams on a 100-connection pool made an ordinary `findOne` take 1.5–1.9 s, and 20 streams on a pool of 10 took 19.9 s. One stream per provider avoids that, and the docs recommend a dedicated `MongoClient` for the notify provider, like PostgreSQL's dedicated listen client.
- **Resume.** Notifications are hints and polling is the source of truth, so the stream reopens from "now" after an error or an election instead of persisting resume tokens. Messages published while it reconnects are lost, as with Redis pub/sub.

Watching the `jobs` collection directly, instead of publishing, would need no writes, but it ties the notify adapter to the MongoDB state adapter and bypasses `txHooks`; rejected.

## Migrations

There is no DDL to version, but there is still state to version: collections, indexes, validators and data backfills. `@queuert/mongodb` ships a small migrator with the same contract as `packages-internal/typed-sql/src/migrator.ts`: ordered `NNN_name` migrations recorded in `migrations`, a lease in `migration_lock` (upsert where `lockedUntil <= $$NOW`, 60 s TTL, 20 s heartbeat), and the same `{ skipped, applied, unrecognized }` result.

- `001_initial` creates the collections and indexes. Index builds cannot run in a transaction and wait behind open transactions, so they run outside one, with `w: majority`, before any worker starts. `createIndexes` is idempotent, so a migration killed partway reruns safely.
- Data migrations run in transactions when they fit (no 16 MB per-transaction limit since 4.2, but the transaction must fit the WiredTiger cache; in the spike a 50 MB single-transaction insert once OOM-killed a 4 GB container), and as batched migrations otherwise.
- No JSON-schema validator in `001`: it would cost every write and duplicate the adapter's own checks. Revisit if users write to the collections directly.

### Schema fencing

The fence tables of the PostgreSQL adapter's [write fence](../docs/src/content/docs/integrations/state-adapters/postgres.tsx#write-fence) do not port: a write to a dropped collection silently recreates it.

- **Leading candidate:** a `writerVersion` field stamped by every write, plus a `$jsonSchema` validator (`writerVersion >=` the oldest compatible schema version) that each breaking migration raises with `collMod`.
  - `collMod` does not scan existing documents.
  - DDL on a collection aborts or blocks open transactions that touch it, so a stale transaction cannot write past the fence.
  - Not spiked: its cost per write, and how it behaves against open transactions.
- **A self-check against a stored schema version is rejected.** It is a snapshot read with no write-write conflict, so it breaks the rule in [Transactions and isolation](#transactions-and-isolation).
- **A shared-document write on every transaction is rejected.** It would make all writes conflict with each other.

## Contract divergences

- **Lock waits are reruns.** A conformance case that holds a lock in transaction A and expects transaction B to wait sees B fail with 112 and rerun until A ends, so B still finishes after A. Cases that record side effects inside B's callback see them more than once. If such cases exist, the fixture gets `transactionConcurrency: "conflicting"`, and those cases count distinct effects. To verify in phase 1.
- **`getStartAttemptDelayMs` sees held jobs.** PostgreSQL skips locked due jobs and can return `null`; MongoDB cannot tell that a job is held, so it returns 0, and the worker's claim then finds nothing. The case at `start-job-attempt.ts:609` is skipped for MongoDB. Phase 1 checks that the worker loop does not spin on a held due job (a 0 delay followed by an empty claim); if it does, the adapter reports the job's delay as `pollIntervalMs`-bounded instead.
- **User transactions fail with 112 where PostgreSQL waits.** For example, a fenced handler transaction and a reclaim of its job: on PostgreSQL one waits, on MongoDB the second writer reruns (Queuert's side) or throws (user's side, retried by `withMongoTransaction`). The outcome is the same; only who retries changes.
- **Exact deduplication.** Above.

## Compatibility

| Deployment                               | Status                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| MongoDB 7.0, 8.0 replica set (and Atlas) | Supported; CI on 8.0, plus 7.0 in the nightly matrix. No 8.0-only feature (such as `updateOne` with `sort`) is used. |
| MongoDB sharded cluster                  | Works with unsharded Queuert collections. Sharding them (claims would scatter across shards) is a later design.      |
| Percona Server for MongoDB               | Same engine; expected to work, not tested.                                                                           |
| Standalone `mongod`                      | Unsupported: no transactions or change streams. `migrateToLatest` fails fast.                                        |
| AWS DocumentDB                           | Unsupported: no cursors in transactions, no causal consistency, `$$NOW` in update pipelines not documented.          |
| Azure Cosmos DB for MongoDB (RU)         | Unsupported: 5 s transaction limit, change streams without deletes.                                                  |
| Azure DocumentDB (vCore), FerretDB       | Unsupported: transactions incomplete or limited.                                                                     |

## Performance

From the spike (single node, laptop; compare rows, not absolutes):

- **Claims**: about 1,850 jobs/s with 8 workers on the transactional design, against 3,600 for the ungated autocommit variant.
- **Hot blocker**: 16 concurrent transactions attaching dependents to one blocker chain fall from 2,867 to about 450 transactions/s once the attach writes the chain (`$inc`), with a p99 of 475 ms and up to 15 attempts. This is the price of correctness at snapshot isolation; PostgreSQL REPEATABLE READ pays the same (`design/pg-isolation-levels.md`: 4.5% 40001 on hot blockers), only with fewer retries because it waits first. Fan-in to one popular blocker chain is the workload to warn about in the docs.
- **Batches**: `insertMany` of 10,000 jobs in a transaction 279 ms; a pipeline `updateMany` of 2,000 dependents 54 ms, of 50,000 2.1 s.

Replication latency (`w: majority` across three nodes), failover and multi-node clock skew were not measured; the benchmark package's MongoDB setup should use a three-node replica set.

## Tests

- `packages-internal/testcontainers/src/mongodb.ts`: a reusable `mongo:8.0` container started as a single-node replica set, a database per test file, leak detection, like `postgres.ts`.
- Conformance and the shared suites through `extendWithStateMongodb`, the `{noop,in-process,mongodb}` × `{data,processing}` matrix, the variance specs (`collectionPrefix`, limits, custom ids), options validation, `fastSeedAllStates` and its equivalence spec.
- Migration specs: concurrent `migrateToLatest`, a migration killed mid-way, lease takeover, standalone detection.
- Isolation: each invariant in the [table](#rule-every-invariant-is-a-write-write-conflict-on-a-shared-document) raced from two sessions in both commit orders ends correct; `blockersRemaining` equals its recomputed count after the blocker cases; a no-op lock write is rejected by a unit test on the `$inc`.
- Retries: each worker transaction rerun after an injected 112 produces the same state and announces once; `withMongoTransaction` rolls back the hooks of a failed try and flushes once; the `session.withTransaction` test above, with and without `retryBoundary`.
- Claims: 8 concurrent claimers never claim one job twice and never return a short batch while jobs remain; a claim racing a reclaim of its worker either commits first and is reclaimed, or claims nothing.
- Notify: `notify-adapter-cases.ts` conformance with the shared stream; a test that the adapter opens one change stream regardless of subscriber count.
- Benchmarks: `benchmarks/query-performance/src/mongodb.ts` running `index-coverage-cases.ts` with `explain("executionStats")` written to `explanations/`, so every query's plan and its index are reviewed like the PostgreSQL ones.
- Examples: `state-mongodb-native`, `state-mongodb-mongoose`, `notify-mongodb`, each with `provider.spec.ts` running `runStateAdapterConformance`.

## API and docs

- New package `@queuert/mongodb`; no change to the core contract, client, worker or processor API. A minor changeset for the new package.
- Docs: `integrations/state-adapters/mongodb.tsx` (Clients, Install, Setup tabs per client, Configuration, State provider, Conformance, **Transactions** in place of PostgreSQL's Isolation level: snapshot isolation, conflicts and `withMongoTransaction`, required write concern, lifetime limit; Schema as collections and indexes; Compatibility), `integrations/notify-adapters/mongodb.tsx` (Setup, Notify provider, Change streams and the connection pool). Job Processing's `complete` and `fence` sections link the MongoDB transaction notes next to PostgreSQL's and SQLite's.

## Plan

1. Testcontainers, package skeleton, provider, migrator and `001_initial`; the state adapter's read methods and `createJobs`; resolve the lock-wait conformance question.
2. Writes, blockers, claims, workers; full conformance and suites.
3. `withMongoTransaction`, the notify adapter, examples, docs.
4. Query-performance benchmark and the three-node throughput run; decide whether the autocommit claim and its orphan sweep are worth a follow-up.

The adapter does not wait on `design/chain-table.md` or `design/pg-isolation-levels.md`: it implements today's contract, with chain documents and counters internal to it. When core adopts `hasDependents` on `completeJobs` results and separate chain ids, the MongoDB adapter maps them directly.

## Related designs

- **PostgreSQL isolation levels** (`design/pg-isolation-levels.md`): the rule and counters this adapter uses from the start.
- **Chain table** (`design/chain-table.md`): the chain/job split, here as two collections.
- **Unbounded blockers** (`design/unbounded-blockers.md`): would move the embedded `blockers` array into its own collection, since the array is bounded by `maxBlockersPerJob` and a 16 MB document.
