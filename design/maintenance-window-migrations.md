# Maintenance-window migrations

Replace the current "every migration must be rolling-deploy safe" stance with an opt-in maintenance-window model for breaking schema changes. Addresses the migration item in [TODO.md](../TODO.md).

## Problem

Today every schema change is designed to coexist with old workers still running against the table during a rolling deploy. That constraint is paid for in two places:

1. **Adapter code carries dual-write reasoning.** Columns are added `NULLABLE` or with defaults, status enums grow before they shrink, partial indexes get swapped via concurrent build → drop old → rename. The `has_blockers` change in the current branch is a worked example: the enum had to be rebuilt in a separate migration from the column add, and the acquisition index had to be swapped concurrently with a `_v2` alias so an old worker mid-rollout could still find pending rows.
2. **Changesets carry rolling-deploy caveats.** The `continuedToJobId` changeset already tells operators to "re-run the backfill `UPDATE` from the migration" if old workers created new rows during rollout — but the migration is recorded as applied, so nothing in the public API re-runs it. The `has_blockers` changeset has the same shape: "old worker is forward-safe but can't set jobs blocked — hold off blocker-mutating traffic until rollout completes." Both are paperwork that operators are unlikely to action correctly, and both exist only because the migration tried to be online.

The alternative the wider ecosystem actually uses for non-trivial schema changes is a brief planned maintenance window. That trades a few minutes of downtime for substantially simpler migrations and adapter code, and removes a class of "did we actually catch all the dual-write windows" footguns. For a library at queuert's stage and target use case (background-job queues, not online OLTP for end-user traffic), the trade is favorable.

## Proposed

A migration run is a single-runner, exclusive operation. The shape is:

1. **Operator stops all workloads.** Documented as a precondition in the release notes for any migration that uses this mode. No worker processes, no client processes calling state-mutating APIs.
2. **Operator starts exactly one instance of the new version.** That instance calls `migrateToLatest` (or the runtime equivalent) before serving traffic.
3. **The migration runner acquires a single-runner guard.**
   - **Postgres:** `pg_advisory_lock` (session-scoped) on a fixed key derived from `{schema}.{table_prefix}` so two queuert instances against the same DB serialize. Released on session end or explicit `pg_advisory_unlock`.
   - **SQLite:** the file lock + WAL writer is implicitly single-writer, but enforce the same guarantee explicitly via a `migration_lock` row that the runner inserts and the next instance fails on. SQLite users running maintenance migrations also typically have file-level coordination.
4. **Schema-change DDL runs in a transaction with column defaults.** New columns are added `NOT NULL DEFAULT <safe value>` so the table is immediately consistent and no nullable-window appears in adapter code. New enum values are added; old enum values are removed in the same release (the enum rebuild becomes "drop and recreate" rather than "add-then-deprecate-then-remove").
5. **Data backfill runs in batched UPDATEs.** Chunked by id range or `UPDATE ... WHERE ... LIMIT N RETURNING id` until empty. Each batch is its own transaction so we don't hold a single statement-level lock for the duration or balloon WAL/undo. The runner reports progress.
6. **Temporary defaults are dropped.** `ALTER COLUMN ... DROP DEFAULT` on any column whose default was only there to make the schema change atomic. The application-level code now becomes the source of truth for the column value.
7. **Indexes are built outside the main transaction.**
   - **Postgres:** `CREATE INDEX CONCURRENTLY` runs after the transactional block. This is the existing pattern; nothing changes here.
   - **SQLite:** synchronous `CREATE INDEX` inside the same transactional block is fine because the table is offline anyway.

The runner refuses to proceed if it cannot acquire the single-runner guard, with a clear error pointing at the maintenance-window expectation.

## What changes for `has_blockers` (worked example)

The current branch ships six migrations to add `has_blockers` and remove the `'blocked'` enum value, plus a paragraph of rollout caveats. Under maintenance-window mode the same change collapses to:

1. (Tx) `ALTER TABLE job ADD COLUMN has_blockers boolean NOT NULL DEFAULT false`.
2. (Batched, per-batch tx) `UPDATE job SET has_blockers = true, status = 'pending' WHERE status = 'blocked' AND id IN (... LIMIT N ...)` until empty.
3. (Tx) Recreate `job_status` enum without `'blocked'`. Indexes that reference the enum are dropped and recreated inside the same tx — safe because the table is offline.
4. (Tx) `ALTER COLUMN has_blockers DROP DEFAULT` (optional; the column is set explicitly by `addJobsBlockers` from here on).
5. (Outside tx) Rebuild the acquisition partial index as `... WHERE status = 'pending' AND has_blockers = false`. No `_v2` swap needed.

Changeset prose drops the rolling-deploy caveat entirely.

## What changes for `continuedToJobId` retroactively

The migration that shipped is already online-safe and applied, so we don't rewrite it. But the "ship a built-in backfill chain so users can heal drift post-rollout" idea this design replaces becomes unnecessary — once the maintenance-window model is the documented expectation, the drift can't happen on a fresh install, and existing installs that already applied the online migration are already healed by virtue of having drained workers at some point.

## Open questions

- **Granularity.** Is maintenance-window mode a per-migration flag (some migrations stay online-safe, breaking ones opt in) or a global posture (all migrations from version X+ assume a window)? Per-migration keeps additive changes online; global is simpler to reason about. Lean per-migration: tag each migration with `mode: "online" | "maintenance"` and let the runner refuse to mix the two within a single run unless the operator passes an explicit flag.
- **What does "exclusive" mean for users running queuert clients (not workers) alongside their app servers?** The maintenance precondition is "no state-mutating traffic," which is stronger than "no worker processes." Worth documenting concretely (e.g. "stop the worker pool *and* any process calling `client.*` methods that write").
- **Advisory-lock key collisions.** If a user runs multiple queuert deployments against the same Postgres database with the same `table_prefix`, they share a single-runner key — that's actually what we want. If they share a database but use different `table_prefix`es (unusual but supported), the keys must differ. Hash `{schema}.{table_prefix}` into the advisory-lock key space; document the collision behavior.
- **SQLite single-runner enforcement.** The file lock prevents concurrent *writes*, not concurrent *runners trying to apply migrations*. Two processes both calling `migrateToLatest` will serialize per-statement but still both think they're "the migration runner." Either rely on the migrations table's idempotency (current behavior — each migration name applied at most once) and skip explicit guarding, or add an explicit `migration_lock` row. Lean on idempotency unless we hit a concrete bug.
- **Backwards compatibility.** Migrations already shipped (the `continuedToJobId` and `has_blockers` ones in the current branch) were written for online mode. They stay as-is; this design applies to migrations introduced from the next release onward.

## Non-goals

- Zero-downtime migrations as a supported mode. Operators who need that can pin to a version and roll forward themselves, or wait until queuert offers a separate online-migration mode (not planned).
- A general-purpose maintenance-mode toggle for the running queuert deployment. The runner enforces single-runner for itself; coordinating "no state-mutating traffic" stays the operator's responsibility (same as today).
