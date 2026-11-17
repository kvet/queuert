# Isolation levels: follow-up

State of the REPEATABLE READ / SERIALIZABLE work on PostgreSQL and MySQL/MariaDB (the design doc was retired). Nothing is committed.

## Done

- **Per-level test matrix.** Conformance runs once per level: `packages/{postgres,mysql}/src/specs-*/state-adapter-conformance{,.repeatable-read,.serializable}.spec.ts`. The noop-notify end-to-end spec also runs once per level. The MySQL files cover MySQL 8.4 and MariaDB 11.4.
- **Mixed levels** are tested only in adapter hazards specs, over all ordered level pairs. `packages/postgres/src/specs-pg/state-adapter-hazards.spec.ts` (new) has three blocker races plus claim vs reclaim, over 9 pairs. `packages/mysql/src/specs-mysql2/state-adapter-hazards.spec.ts` has the blocker races. The shared conformance suite has no pair harness and no `isolationVariants`.
- **Conformance API.** Each `create…ConformanceContext` (state provider, migrator, notify provider) returns `{ context, cases }` synchronously and does its setup lazily. The public bundles export no case or group lists, and `redisStateAdapterLockWaitCaseNames` is gone too; group lists live only in `conformance-internal`.
  - PostgreSQL and MySQL state factories take a required `isolationLevel`, and the level case asserts that transactions run at it.
  - MySQL at `"SERIALIZABLE"` leaves out `stateAdapterNonLockingReadGroups`.
  - SQLite state and migrator factories take a required `mode`, enforced by type and checked at runtime.
  - Migrator factories take `createStateProvider` and call it once.
  - Changeset: `.changeset/conformance-context-cases.md`.
- **Retries.** Conformance cases are retried only by the adapters' own `withTransaction`, which uses the provider's `classifyError`; core knows no classifier. A case with many contending transactions reruns the ones that fail during the concurrent phase alone afterwards. A conflict then succeeds and a real error fails again. This avoids the ~3.5% of hot attaches that exhaust 5 retries at REPEATABLE READ.
- **MySQL claim.**
  - One claim transaction: lock the live worker, then one pick across all type names (a `UNION ALL` of per-type `FOR UPDATE SKIP LOCKED` branches on `job_status_idx`, ordered by `status_ts`), update, read back. No shuffle, no rounds. `getStartAttemptDelayMs` is one statement too (locking due branches plus upcoming branches).
  - Accepted trade-off, measured on MySQL 8.4 and MariaDB 11.4: at REPEATABLE READ and SERIALIZABLE, a claim on a queue with fewer due jobs than the limit gap-locks the end of the range, so inserts of new due jobs wait for the claim to commit, and two such claims can deadlock on their `running` index inserts (1213, retried). A non-locking candidate read in the same statement avoids it at RR, but at SERIALIZABLE it turns into share locks that make claimers block each other. Only a separate autocommit candidate read avoids it at every level. The docs say this.
  - Every read by an id list is driven from `JSON_TABLE` with `STRAIGHT_JOIN … FORCE INDEX (PRIMARY)`. Otherwise MariaDB full-scanned small tables, locked the supremum gap and stalled inserts.
- **MySQL migrations are not pinned to READ COMMITTED.** The prototype's in-transaction `COMMIT` / `SET TRANSACTION` / `START TRANSACTION` broke Prisma with error 1295. A migration's first statement is a locking read, and InnoDB takes the snapshot later, so no migration reads data from before the lock wait. PostgreSQL migrations stay pinned. The docs, changeset and hazards test say so.
- **PostgreSQL fixes:**
  - `blockers_remaining` added to the declared job columns;
  - fence guard on the `live_worker` write;
  - the conformance harness compares `[...rows]`, since postgres-js returns a `Result` subclass.
- **Fan-in conformance case** in `unblockJobs`: 16 blockers, 8 lanes, 200 dependents, checked after each half. It runs on every adapter that runs the concurrent groups.

## Verified

Lint, typecheck (all packages and examples) and format all pass. Every PostgreSQL, MySQL, SQLite and Redis spec passes when run two files at a time. Every example passes, run one at a time; the Bun examples and the `node:sqlite` example exit 0 under their own runners.

## Open

- **Full `pnpm check` in one go.** The last full run lost the MySQL 8.4 container to the Docker VM's OOM killer, and testcontainers `proper-lockfile` locks timed out. The per-level matrix roughly doubles the PostgreSQL and MySQL spec files. The check needs more Docker VM memory or less file parallelism.
- **Flakes seen once, passing on rerun:**
  - MariaDB SERIALIZABLE "listJobs returns continuation jobs with correct status" (a `completedAt` tie);
  - MySQL "deleted job during complete is handled gracefully";
  - MySQL SERIALIZABLE "maintains transaction isolation" (a timeout under parallel load);
  - PostgreSQL "parallel withTransaction and non-transactional reads do not deadlock" (load).
- **MariaDB 11.8 with `innodb_snapshot_isolation` ON and OFF.** No image or spec yet.
- **`classifyError` conformance cases** for 40001 and 1213 / 1020.
- **Prisma providers.** Unverified whether Prisma surfaces 40001 / 1213 in `meta.driverAdapterError.cause.originalCode` or only as `P2034`.
- **MySQL deletes by id list** (`DELETE … WHERE id IN (JSON_TABLE …)`) are not driven by primary key yet. They pass at every level today, but could full-scan a small table the same way the reads did.
- **Core `queuert/conformance`** still exports raw case lists for custom-adapter authors (`stateAdapterConformanceCases` and the others). Decide whether they follow the `{ context, cases }` shape.
- **Migration hazards** (parallel boot, a waiter after the holder, a backfill seeing a concurrent writer) are not in the shared migration-store conformance suite yet. That suite is what a MongoDB store would have to pass.
