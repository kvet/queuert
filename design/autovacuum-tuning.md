# Autovacuum tuning (Postgres)

> **Builds on**: [job-model.md](job-model.md) — the structural columns and partial indexes defined there determine which writes produce dead tuples.

## Problem

Most state transitions on `job` are non-HOT: every transition touches a column (`leased_until`, `completed_at`, `scheduled_at`, `blocked`) that appears in at least one partial-index predicate, and PG treats predicate columns as "indexed" for HOT eligibility. A typical job lifecycle generates ~2–3 dead tuples on `job` (acquire + complete, plus one per retry / unblock / continueWith). At sustained throughput this is real index churn — but on PG ≥14 it is carried by engine features, not by schema design.

What carries it:

- **VM-aware vacuum (PG 9.6+)** skips all-visible pages on the heap scan. Cold completed history doesn't get re-scanned just because it's there — only pages that saw recent writes are touched. The autovacuum heap scan cost is bounded by the active set, not the table size.
- **Bottom-up index deletion (PG 14+)** removes dead/duplicate index entries opportunistically when leaf pages fill, so index bloat from update churn largely self-heals on writes rather than waiting for `vacuum_index_cleanup`.
- **`INDEX_CLEANUP = AUTO` (PG 14+, default)** skips the index-vacuum pass entirely when the heap pass found few dead tuples.

PG ≥14 is the supported floor for this workload model. PG 13 reaches end-of-life in November 2025; we don't carry the pre-14 vacuum profile.

## Target shape: threshold-based pinning

V1 commitment: **set autovacuum to threshold-based pinning and trust the engine.**

```sql
ALTER TABLE {{schema}}.{{table_prefix}}job SET (
  fillfactor = 75,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_analyze_threshold = 5000,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_vacuum_cost_delay = 0
);
```

Threshold-based pinning (`threshold = 5000, scale_factor = 0`) gives a predictable vacuum cadence regardless of table size — a fixed dead-tuple budget per pass. The historical `scale_factor` knob anchored the trigger to table growth, but on modern PG (VM-aware vacuum) the scan cost no longer scales with the table, so anchoring the trigger to it just delays vacuum on big tables. A future cleanup-style job can dynamically `ALTER TABLE … SET (autovacuum_vacuum_threshold = …)` per deployment if a single static value isn't right.

## Migration

The current migration `20240102000000_vacuum_tuning` uses `scale_factor = 0.02`. The work here is a follow-up migration step that switches it to threshold-based pinning (`scale_factor = 0`, `threshold = 5000`) per the target shape above, on both the `job` and `job_blocker` tables as appropriate.

## Observability follow-up

Add a dead-tuple-rate gauge in [state-snapshot-metrics.md](state-snapshot-metrics.md)'s follow-up so operators can see if vacuum ever does become the bottleneck and can retune `autovacuum_vacuum_threshold` per deployment.
