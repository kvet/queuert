# Pipelining

Let the PostgreSQL and MySQL state adapters send several statements in one round trip, by replacing the provider's `executeSql` with a batched `executeStatements`. The provider decides whether a batch goes over the wire pipelined or one statement at a time. SQLite keeps a single-statement method, renamed from `executeSql` to `executeStatement`: it runs in process, so a batch has no round trip to save.

## Problem

Several adapter methods run statements back to back whose parameters do not depend on earlier results, and each one costs a full round trip. PostgreSQL has one such method (`deleteChains`). MySQL has no `RETURNING` or data-modifying CTEs, so most of its write methods take 2–5 round trips, including the ones every job goes through (`startJobAttempts`, `completeJobs`, `getStartAttemptDelayMs`, `continueJobs`, `rescheduleJobs`). On a network database a round trip costs far more than these statements take on the server.

## Provider contract

`executeSql` is removed from `PgStateProvider` and `MySqlStateProvider`. They have one method:

```ts
executeStatements: (options: {
  txCtx?: TTxContext;
  statements: {
    id?: string;
    sql: string;
    params: unknown[];
    paramTypes: Record<number, RuntimeType>;
    columnTypes: Record<string, RuntimeType>;
    readOnly: boolean;
  }[];
}) => Promise<unknown[][]>;
```

- Statements run in order, each one seeing the effects of the ones before it, on the transaction's connection when `txCtx` is given. Without `txCtx` each statement autocommits on its own, so a provider that runs them one at a time may use any connection for each, and a non-pipelining provider is the old `executeSql` body in a `for` loop. A provider that pipelines sends the batch on one connection it acquires, since its statements are in flight together.
- The result holds one row array per statement, in statement order.
- When a statement fails, the call rejects with that statement's error, the first failure in statement order. Whether later statements ran is unspecified. Inside a transaction the caller rolls it back.
- The provider may pipeline the batch or run it statement by statement. Both are correct.
- A provider that pipelines issues every statement on the connection without awaiting between them, waits for all of them (`Promise.allSettled`, so no rejection goes unhandled), and throws the first rejection in statement order. Each rejection is the driver's own error, so `classifyError` sees what it sees today. On PostgreSQL inside a transaction, the statements after a failure reject with `25P02` (transaction aborted); taking the first in statement order reports the real cause.
- A MySQL provider that pipelines opens its transactions with `SET autocommit = 0` and restores it after COMMIT or ROLLBACK, instead of `START TRANSACTION`. A deadlock (1213) makes InnoDB roll back and end the transaction while the rest of the batch is still in flight. With `START TRANSACTION` those statements would then autocommit; with `autocommit = 0` they open a new implicit transaction that the provider's ROLLBACK discards.
- A provider may route a batch to a replica only when every statement in it is `readOnly`.
- `SqliteStateProvider` renames `executeSql` to `executeStatement` and keeps its single-statement options (`txCtx` beside the statement's fields), returning `ModeResult<TMode, unknown[]>`. `createTypedSqlExecutor` takes that shape, and the PostgreSQL and MySQL packages adapt their batch method to it with `batchStatementExecutor`.

## Adapter rules

- Statements go in one batch only when their parameters are known before the batch is sent.
- A batch with more than one write runs inside a transaction (the caller's or the method's own), so a failure mid-batch never leaves part of it committed.
- Where a JS check sits between a lock and a write today (`isWritable` in the MySQL `completeJobs`), the check moves into the write's `WHERE`. The locking `SELECT` still runs first in the batch, and its result decides the method's return value.
- The MySQL `rescheduleJobs` keeps its lock in its own round trip, with the writability check in the lock's `WHERE`: a multi-table UPDATE over `JSON_TABLE` holds X locks on the rows it reads without changing them, so an unconditional UPDATE would hide a job it does not reschedule from `SKIP LOCKED` pickers until commit.
- A conditional follow-up statement whose no-op case is cheap is sent unconditionally.
- A write whose parameters are computed from a locked read goes in the next batch: the MySQL `addJobsBlockers` and `unblockJobs` count `blockers_remaining` changes per job from the locked blocker heads or blocker rows, then send the counter update together with the read of the result.
- Schema-fence errors are classified per error as today, and the batch's position of the error does not matter.

## Drivers

Every provider below stays correct, since a client that serializes queries runs the batch statement by statement. Only the ones marked pipelined save round trips.

| Provider                                 | Pipelined                         | Why                                                                                                   |
| ---------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pg` (≥ 8.23)                            | with `pipeline: true`             | the client sends queued queries without waiting for results; without the option it queues them        |
| postgres.js                              | yes                               | pipelines queries issued on one connection, including inside `sql.begin`                              |
| Drizzle on node-postgres                 | with `pipeline: true` on the pool | the provider queries the transaction's pg client directly                                             |
| Knex on pg                               | with `pipeline: true`             | its transaction calls the pg connection directly, with no queue of its own                            |
| Kysely                                   | no                                | `SingleConnectionProvider` runs one query at a time per transaction and does not expose the pg client |
| MikroORM                                 | no                                | its transactions run on Kysely                                                                        |
| Prisma (`adapter-pg`, `adapter-mariadb`) | no                                | interactive transactions chain operations through an `operationQueue`                                 |
| Bun SQL on PostgreSQL                    | yes                               | pipelines queries issued together, including inside `sql.begin` (measured on Bun 1.4.3)               |
| Bun SQL on MySQL                         | no                                | runs queries issued together one at a time, inside and outside a transaction (measured on Bun 1.4.3)  |
| `mariadb`                                | yes                               | `pipelining` is on by default; works against MySQL servers too                                        |
| `mysql2` (directly or through an ORM)    | no                                | the driver cannot pipeline                                                                            |

`pipeline: true` is set per pg client or pool, so it applies to the application's own queries on that pool too. pg rejects queries that keep a portal open across round trips (`pg-cursor`, `pg-query-stream`) in pipeline mode, so an application using them gives Queuert its own pool.

The `mariadb` connector pipelines a statement's PREPARE together with its EXECUTE only against MariaDB servers (10.2.4+). Against MySQL servers an EXECUTE waits for its own PREPARE, but one whose statement is already in the prepare cache goes out at once and overtakes it, so a provider prepares the batch's statements first (one round trip) and then pipelines the EXECUTEs in order.

## Out of scope

- Batching statements in the SQLite adapter or its provider: it runs in process, so there is no round trip to save.
- Batching across adapter methods in core (for example `completeJobs` followed by `unblockJobs`).

## Tests

- Provider conformance (PostgreSQL and MySQL): results in order, an empty batch, a single statement, a failure mid-batch inside a transaction rolls everything back, a batch without `txCtx` runs in order.
- The state-adapter conformance suite passes with pipelining providers (`pg` with `pipeline: true`, `mariadb`) and with sequential ones (`pg` without it, `mysql2`).
- A spec per batched method asserts the number of `executeStatements` calls it makes.
- A spec per pipelining driver puts a fixed-latency TCP proxy in front of the database and asserts a three-statement batch takes about one delay.

## Changeset

Major for `@queuert/postgres` and `@queuert/mysql`: providers implement `executeStatements` in place of `executeSql`. Major for `@queuert/sqlite`: providers rename `executeSql` to `executeStatement`. The examples, the provider docs on the integrations pages and the benchmarks' wrapping providers move to the new method.
