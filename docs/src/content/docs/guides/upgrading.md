---
title: Upgrading from 0.15.1
description: How to move an existing PostgreSQL or SQLite database from Queuert 0.15.1 onto the head-row job model.
sidebar:
  order: 20
---

## Overview

The head-row job model replaces the job tables rather than altering them. `migrateToLatest()` performs the upgrade in place: it moves the existing tables aside, installs the new schema, and copies every chain across. The upgrade is not a rolling deploy — workers and clients from 0.15.1 cannot run against the new schema, and new workers cannot run against the old one.

## Before You Upgrade

- **Be on v0.15.1.** The upgrade only reads the v0.15.1 schema. A database whose migrations predate v0.15.1 is refused with an error telling you to upgrade to `@queuert/postgres` / `@queuert/sqlite` 0.15.1 and run `migrateToLatest()` first. A database that is not exactly v0.15.1 is refused too: one whose job table is not in the v0.15.1 shape (for example, altered by hand), or whose migration table records migrations v0.15.1 did not ship. Restore a v0.15.1 backup, or drop the Queuert tables to start fresh.
- **Back up the database.** The upgrade drops the old tables once the import is complete.
- **Stop all workers and clients.** Job processing is unavailable while the upgrade runs, and any process still using the old tables either blocks the upgrade or fails against the new schema.

## Running the Upgrade

Deploy the new version with workers disabled, then call `migrateToLatest()` once:

```ts
await stateAdapter.migrateToLatest();
```

Start workers and clients only after it returns. Concurrent `migrateToLatest()` calls are safe — on PostgreSQL they serialize through the `{tablePrefix}migration_lock` table, and SQLite relies on its single writer — so it does not matter if several processes call it at startup.

## What It Does

1. Renames the live tables aside to `{tablePrefix}job_old` and `{tablePrefix}job_blocker_old`.
2. Installs the new schema (the single `001_initial_schema` migration that fresh installs also run) and removes the 0.15.x records from `{tablePrefix}migration`.
3. Imports the old rows chain by chain, in batches, each batch together with its jobs' blocker rows. Each chain's state — type name, status, deduplication key, trace context and completion time — is written onto its head row, and a blocked job whose blockers have all completed is imported as pending.
4. Drops the `_old` tables (and, on PostgreSQL, the legacy `{tablePrefix}job_status` enum type) once every old job and blocker is present in the new tables. If any row is missing, the `_old` tables are left in place and the run fails.

An interrupted upgrade is resumable: run `migrateToLatest()` again and it continues the import where it stopped.

## Troubleshooting

On PostgreSQL, the rename step waits at most 5 seconds for the job tables. If a worker or client still holds them, `migrateToLatest()` fails with an error saying the tables stayed locked and asking you to stop all workers and clients. Nothing has changed at that point — stop the remaining processes and run it again.

If the old tables hold jobs that cannot be imported — typically continuation rows whose chain head was deleted by hand — the run fails with an error that reports how many rows are missing and includes a query listing them. Delete those jobs and their `{tablePrefix}job_blocker_old` rows (or restore their heads), then run `migrateToLatest()` again.
