# Partitioned PG adapter

> **Builds on**: [job-model.md](job-model.md) — uses the structural columns and partial indexes defined there. The core schema is deliberately partition-friendly; this design layers partition management on top without schema rework.

A separate adapter (`@queuert/postgres-partitioned`) that range-partitions the `job` table on `chain_id`. Defers until a user hits limits with the standard PG adapter — partitioning is deployment shape, not a core schema concern.

## Problem

At sustained high throughput (10M+ jobs/day, multi-week retention), two operational costs grow beyond what the standard PG adapter handles cleanly:

1. **Retention churn.** Cleanup runs `DELETE … WHERE chain_id IN (…)` over millions of completed rows. Every deleted row leaves a dead tuple on the heap and dead entries across every index. Even with PG 14+ bottom-up index deletion + VM-aware vacuum, bulk deletes generate sustained vacuum + index-cleanup work proportional to retention volume.
2. **Cold-history overhead.** Completed history accumulates in the same table as active work. Indexes carry entries for both. Cache pressure on hot indexes grows as the completed side grows, even when partial indexes restrict the active subset structurally.

Both of these are operational concerns, not correctness concerns — the standard adapter remains correct at any scale. The partitioned adapter trades acquisition-hot-path latency for an order-of-magnitude better retention story.

## Why partition on `chain_id` (not `completed_at`)

The core schema in [job-model.md](job-model.md) is structured to make `chain_id` the natural partition key:

- **No row moves.** `chain_id` is immutable from insert onward, so jobs never migrate between partitions. Partitioning on `completed_at` would force a cross-partition row move on every completion (`UPDATE … SET completed_at = …` triggers PG to DELETE from the active partition + INSERT into the completed partition) — every job completion becomes a full tuple move with all index entries rewritten. The dead-tuple math gets _worse_, not better.
- **Chain-local self-FKs.** `chain_id REFERENCES job(id)` and `continued_to_job_id REFERENCES job(id)` always point at rows within the same chain. With chain_id partitioning, every FK lookup is partition-local — no cross-partition FK overhead.
- **Chain-local uniqueness.** `UNIQUE (chain_id, chain_index)` and the open-scope dedup partial (`WHERE deduplication_key IS NOT NULL AND chain_id = id AND completed_at IS NULL`) both operate within a chain. PG only enforces uniqueness within a partition without including the partition key — fine here, because the partition key (chain_id) is the natural scope of both invariants.
- **UUIDv7 time-ordering.** Range-partitioning by `chain_id` with UUIDv7 IDs effectively partitions by chain birthday (the leading bits encode timestamp). Old chains live in old partitions; new chains in new partitions. Retention becomes "drop the oldest day."
- **`job_blocker` follows.** The companion `job_blocker` table partitions on the gated job's chain_id, sharing partition boundaries with `job` so the two tables drop together atomically. See [`job_blocker` partitioning](#job_blocker-partitioning) for the design tradeoff.

## Operational win: retention via `DROP PARTITION`

The standard PG adapter's cleanup job runs `DELETE … WHERE chain_id IN (…)` over completed chains older than the retention window. At 20M jobs/day with a 7-day window, that's ~20M deletes/day producing 20M dead tuples on the heap + ~12 × 20M dead index entries to clean up. Even with PG 14+ engine help, this is sustained vacuum + index-cleanup work.

`DROP PARTITION oldest` on a chain_id-partitioned table:

- Zero dead tuples generated.
- Zero index churn.
- Instant (constant-time metadata operation, not data-dependent).
- No vacuum follow-up needed.

The cleanup job's responsibility shifts from "delete by chain_id" to "drop the partition whose chain_id range is entirely past the retention cutoff." Partition creation also moves into cleanup: pre-create the next partition before its key range becomes live.

## Tradeoff: acquisition probes every partition

`acquireJob`'s WHERE clause has no `chain_id` predicate (workers acquire by type, not by chain), so PG cannot partition-prune. Acquisition becomes a partition-wise scan across every partition's `job_ready_idx`.

Each probe is cheap — an empty `job_ready_idx` partial on a fully-completed partition is essentially a root-page-only btree, sub-microsecond. But the probes don't free-merge: PG executes them sequentially or via a merge-append plan, then applies the LIMIT 1 with FOR UPDATE SKIP LOCKED at the executor level.

Order-of-magnitude expectation (cache-warm, PG 16+):

| Partitions          | Expected acquire latency |
| ------------------- | ------------------------ |
| 1 (no partitioning) | 0.01 ms                  |
| 8                   | ~0.1 ms                  |
| 32                  | ~0.5 ms                  |
| 128                 | ~2 ms                    |

For most workloads where partitioning matters, acquire latency at the millisecond scale is acceptable — the win on retention dwarfs it. But if acquire latency is the budget that matters most, the standard adapter remains preferable.

In practice, active work concentrates in the newest one or two partitions (UUIDv7 newest chains live in newest partitions). The merge-append plan walks oldest-empty partitions first as cheap no-ops and finds the work in the newest. Pre-merge benchmarking should confirm this shape; if PG's plan walks newest-first, acquire latency stays close to the single-partition case.

## Partition lifecycle

Three lifecycle events, all owned by the adapter:

1. **Partition creation.** Future partitions need to exist before their chain_id range becomes live. A recurring job (`queuert.partition-rotate` or similar) pre-creates the next N partitions ahead of the active boundary. Same shape as the existing cleanup job.
2. **Active boundary advance.** When the active boundary crosses into a new partition, no migration happens — INSERTs naturally land in the appropriate partition by their chain_id.
3. **Retention drop.** Same recurring job drops partitions whose entire chain_id range is past the retention cutoff. With UUIDv7's time prefix, this is a pure timestamp comparison against the partition boundaries. Two-table ordering: detach the `job_blocker` partition before the matching `job` partition in a single transaction so the pair goes atomically (the `job_blocker.job_id → job(id)` FK is partition-local; detaching in the wrong order would briefly leave the FK pointing at a detached parent). The actual `DROP TABLE` can happen outside the transaction for speed.

   ```sql
   BEGIN;
   ALTER TABLE job_blocker DETACH PARTITION job_blocker_p_2025_01;
   ALTER TABLE job          DETACH PARTITION job_p_2025_01;
   COMMIT;
   DROP TABLE job_blocker_p_2025_01;
   DROP TABLE job_p_2025_01;
   ```

Partition granularity is a tuning knob — daily is the natural default (matches typical retention windows), hourly for very-high-throughput deployments, weekly for low-throughput-long-retention. Adapter exposes it as configuration.

## `job_blocker` partitioning

`job_blocker` has two FKs into `job(id)`: `job_id` (the gated job) and `blocked_by_chain_id` (the root of the blocker chain). These point at potentially different chains — every `job_blocker` row is inherently a cross-chain link. Three shapes were considered:

| Shape                                                                                    | DROP-PARTITION atomicity                                                                                                             | Reverse lookup (`unblockJobs` finding dependents)                                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **(a) Partition by gated job's chain_id** (denormalized as `job_chain_id` partition key) | Atomic: dropping `job` partition + `job_blocker` partition for the same chain_id range happens together                              | Cross-partition scan via per-partition `job_blocker_chain_idx`; each index probe is cheap, but they don't free-merge |
| **(b) Partition by `blocked_by_chain_id`**                                               | Cross-partition: dropping a `job` partition leaves orphan `job_blocker` rows whose `blocked_by_chain_id` is in a different partition | Single-partition lookup — matches the reverse-index access pattern directly                                          |
| **(c) Leave `job_blocker` non-partitioned**                                              | None: retention needs `DELETE FROM job_blocker WHERE …` before DROP-PARTITION on `job`                                               | Single global index, fastest                                                                                         |

**Choice: (a).** Reasons:

- Retention atomicity is the whole point of partitioning. Reintroducing a `DELETE` pass on `job_blocker` (option (c)) brings back the dead-tuple churn we partitioned `job` to avoid. Option (b) leaves orphan rows, which forces a separate cleanup pass for blockers — same problem in a different shape.
- The reverse-lookup tax in (a) is bounded and parallels the acquisition tradeoff: per-partition `job_blocker_chain_idx` is small (only blockers for chains in that partition), each probe is sub-microsecond on partitions with no matching entries, and active blocker work concentrates in the newest partitions (recent chains have unresolved blockers; old chains' blockers are closed).
- The FK from `job_blocker.blocked_by_chain_id → job(id)` remains a cross-partition FK. PG supports this; cost is at blocker-creation time (not on the hot path). The FK from `job_blocker.job_id → job(id)` stays partition-local under (a).

Schema delta for the partitioned adapter:

- Add `job_chain_id` to `job_blocker` (denormalized partition key, equal to the gated job's `chain_id`; populated at insert from the gated job, immutable thereafter).
- Range-partition `job_blocker` on `job_chain_id` using the same partition boundaries as `job`.
- PRIMARY KEY becomes `(job_chain_id, job_id, blocked_by_chain_id)` to include the partition key. `(job_id, blocked_by_chain_id)` uniqueness is preserved within a partition; since a job's chain is immutable, this is equivalent to the global invariant.
- `job_blocker_chain_idx` stays on `(blocked_by_chain_id)` per partition.
- **Drop the FK on `blocked_by_chain_id`.** This is a departure from the standard adapter. The constraint is cross-partition (a gated job in partition P_N can block on a chain whose root lives in partition P_M), which makes DROP-PARTITION-based retention impossible: PG refuses to drop a `job` partition while any `job_blocker` row in any other partition still references rows in it. `ON DELETE CASCADE` would defeat the design (mass per-row cascade deletes generating exactly the dead-tuple churn we partitioned to avoid). Pre-DELETE before DROP has the same problem at smaller scale. Removing the FK and relying on app-level integrity (the write path already validates the blocker chain exists; resolved-blocker rows referencing dropped chains are harmless because nothing reads them after retention) is the cleanest answer. The `job_id → job(id)` FK stays — it's partition-local under (a) and drops atomically with its target.

A short partition-rotate job extension keeps `job_blocker` partition creation aligned with `job` partition creation — same boundaries, same lifecycle, dropped together.

### Adapter implementation requirement: thread `job_chain_id` for partition pruning

PG only partition-prunes when the partition key appears in the WHERE clause. Queries that filter by `job_id` alone (`getJobBlockers`, `listJobBlockers`, single-blocker existence checks) would scan every partition without the partition key in the predicate. The adapter must thread the gated job's `chain_id` alongside `job_id` on every read of `job_blocker`, and use it as the leading WHERE predicate. The new PRIMARY KEY (`(job_chain_id, job_id, blocked_by_chain_id)`) is shaped to serve this directly.

This is load-bearing — without it, the perf claim of "small per-partition indexes" collapses into "every query scans every partition." Conformance tests should include `EXPLAIN` assertions that prune kicks in for the standard read paths.

## Index strategy

Every index defined in [job-model.md](job-model.md) is created as a partitioned index — `CREATE INDEX ON job_parent (…)` automatically creates per-partition children attached to the parent. Predicates are unchanged.

What changes per index:

- **Active-partition partials** (`job_ready_idx`, `job_pending_listing_idx`, `job_blocked_listing_idx`, `job_running_idx`, `job_chain_tail_idx`, `job_dedup_open_idx`, `job_stuck_idx`): each partition has its own. Older partitions hold empty or near-empty versions (everything completed). Cache locality improves for hot partitions; cold partitions' indexes stay small and unmaintained.
- **Completed-partition partials** (`job_completed_listing_idx`, `job_continued_listing_idx`): same. Older partitions hold the bulk of these; the active partition's version is small.
- **Full-table indexes** (`job_listing_idx`, `chain_listing_idx`, `job_chain_position_idx`): partitioned indexes spanning all partitions. PG merges per-partition btrees at scan time for queries that don't partition-prune.

No global unique indexes. The invariants that need DB-level enforcement (`(chain_id, chain_index)` UNIQUE, `(chain_id) WHERE continued_to_job_id IS NULL AND completed_at IS NULL` UNIQUE) all operate within a single chain → within a single partition, so per-partition uniqueness is sufficient.

## What this doesn't change

- **Core schema** — same columns, same types, same FK relationships.
- **State adapter contract** — same `StateJob` shape, same method signatures. The adapter implements the same interface as `@queuert/postgres`; users swap one for the other in their `createClient` call.
- **Application code** — handlers, processors, client APIs are unchanged. Partitioning is invisible above the adapter.
- **Cleanup job's contract** — still a recurring job that runs retention. Its body changes from `DELETE` to `DROP PARTITION` (provided by the adapter as a method), but the chain definition and scheduling pattern are identical.

## When to use which adapter

- **`@queuert/postgres`** — default. Right answer for the overwhelming majority of deployments (≤10M jobs/day, standard retention). Modern PG carries the dead-tuple churn via VM-aware vacuum + bottom-up index deletion (PG ≥14). Threshold-based autovacuum tuning is the lever for scaling within this adapter.
- **`@queuert/postgres-partitioned`** — high-volume deployments where retention deletes are measurably the bottleneck (>10M jobs/day, or shorter retention with very high throughput). Trades a few hundred microseconds of acquire latency for instant retention and bounded operational cost as the completed history grows.

The standard adapter scales further than most people assume; reach for the partitioned variant only after measurement, not in anticipation.

## Open questions

1. **Partition granularity defaults.** Daily? Configurable? What's the failure mode when a deployment configures hourly and forgets to advance the pre-creation job?
2. **Pre-creation safety net.** What does the adapter do if it tries to INSERT into a non-existent partition? Auto-create with a warning, or fail loudly? Leaning fail-loudly — an unbounded partition table is a known PG footgun.
3. **Default partition for safety.** PG supports a DEFAULT partition that catches rows outside any defined range. Useful as a safety net for misconfigured pre-creation, but introduces a "this partition might grow" risk if not monitored. Lean: omit, force fail-loudly.
4. **Migration from standard PG adapter.** Is there a supported path to partition an existing `@queuert/postgres` deployment in place, or is it bulk-copy-and-swap? The latter is simpler and acceptable for a deferred adapter.
5. **Multi-tenant partitioning shape.** If a deployment wants to partition by `(tenant_id, chain_id)` for hard isolation, does the adapter support a composite partition key, or is that a separate adapter again? Probably out of scope until asked.
