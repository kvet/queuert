# Surface `continuedToJobId` on `StateJob`

## Problem

A job that calls `continueWith(...)` is marked `status: "completed"` with `output: null` — the null is a **continuation marker**, not a real output value. Pre-codec design didn't decode outputs on read paths, so the marker flowed through harmlessly. Under the codec design ([design/json-serializable-types.md](json-serializable-types.md)), every read path now calls `decode([{typeName, direction: "output", value}])` to convert stored values back to runtime form. For continued jobs that means calling `decode` with `value: null` — and most validator schemas (`z.object({...})`, `v.object({...})`, ArkType) reject `null`, throwing `JobTypeValidationError` mid-page.

Reproducible today via the existing test [client-queries.test-suite.ts:917](../packages/core/src/suites/client-queries.test-suite.ts#L917): a chain that loops `step → step → step` via `continueWith`, then `listChainJobs(chainId)` — the first two jobs have `output: null` (the marker), and a Zod-style adapter would crash trying to decode them.

The data model has no field today that distinguishes "continued (output is the marker)" from "terminated (output is the real value)". We need one.

## Approach: derive in SELECT, don't store

The chain-position model already encodes this: a job is "continued" iff a successor exists in the same chain (`chain_id` matches, `chain_index = self + 1`). We surface a derived field `continuedToJobId: string | null` on `StateJob` via a LEFT JOIN at SELECT time:

```sql
SELECT j.*, n.id AS continued_to_job_id
FROM jobs j
LEFT JOIN jobs n ON n.chain_id = j.chain_id AND n.chain_index = j.chain_index + 1
WHERE …;
```

The JOIN uses the existing UNIQUE composite index `(chain_id, chain_index)` (present in both PG and SQLite — confirmed in [packages/postgres/src/state-adapter/sql.ts:106-107](../packages/postgres/src/state-adapter/sql.ts#L106-L107) and [packages/sqlite/src/state-adapter/sql.ts:130-131](../packages/sqlite/src/state-adapter/sql.ts#L130-L131)). Cost: one B-tree probe per returned row, typically ~500ns or less on cache-hot indexes.

In `mapStateJobsToJobs`:

```ts
if (job.status === "completed" && job.continuedToJobId === null) {
  // terminal — decode output
} else {
  // continued (or not completed) — output stays null, no decode
}
```

## Why not a stored field

Considered three alternatives and rejected each:

### Stored `continued: boolean`

Smallest stored option (~1 byte/row). But:

- **Migration required** on every existing user database. Batched backfill (5–15 min for 10M rows) — operationally intrusive, easy for users to skip, leaves old continued jobs decoder-broken if they do.
- **Drift risk** — denormalised. A bug could set `continued=true` with no successor (or vice versa); no constraint catches it.
- **Source of truth duplication** — the actual answer is "successor exists in chain", and that's already encoded in `chain_index`. Storing a boolean is denormalising what we already have.

The boolean wins on read cost (~25µs/page faster than the JOIN), but that's invisible against everything else in a typical query.

### Stored `continuedToJobId: string` (foreign key pointer)

All the migration cost of the boolean, plus:

- **Storage**: 16–36 bytes/row (UUID/text FK) vs 1 byte for boolean. ~10–35× larger at scale.
- **FK semantics** to design (`ON DELETE` behavior on cascade).
- Same drift risk.

If we ever cared about an explicit "next job" pointer (dashboard nav, observability symmetry), it's still cheaper to derive from `(chain_id, chain_index + 1)` than to store and maintain a redundant pointer.

### Add `'continued'` to the `status` enum

A different shape entirely: instead of a new column, broaden the existing `status` enum to `'blocked' | 'pending' | 'running' | 'completed' | 'continued'`. Continued jobs become `status: 'continued'` rather than `status: 'completed'`, so the `output: null` overload disappears at its root — `mapStateJobsToJobs` skips decode whenever `status !== 'completed'`. Reads stay simple: no JOIN, no new column. But:

- **Cascade audit across every `status = 'completed'` filter.** Chain `currentJob` resolution in `mapStatePairsToChains`, completion counts in listing helpers, observability emit conditions, conformance assertions — every predicate touching the completed state needs review for whether continued jobs are in or out. Some sites flip to `IN ('completed', 'continued')`, some stay strict; none can be left unchecked. Larger, riskier surface than the boolean's localized write-side change.
- **Semantic mixing.** `status` today encodes the worker state machine (`blocked → pending → running → completed`). Continuation is a chain-position fact, not a worker-state fact — `'continued'` is reached via the same write path as `'completed'` (handler returned successfully), and the only distinguishing fact is "a successor exists in the chain". Folding chain-position into worker-state conflates two concerns the schema otherwise keeps separate.
- **User-facing schema breakage.** Users running their own SQL against `queuert_job` (dashboards, ETL, ad-hoc analytics) silently lose any query that treats `completed` as terminal. Adding a column they ignore is harmless; redefining an existing enum value's meaning is not.

Same migration cost as the boolean (PG `ALTER TYPE … ADD VALUE` + backfill of existing rows; SQLite a CHECK-constraint or column rebuild), but the cascade audit and the worker-state/chain-position conflation make it the worse "stored" option.

### Replace `chain_index` with linked-list pointer

Not actually proposed but worth refuting. `chain_index` is load-bearing for SQL-native ordering, range queries, cursor pagination, and `UNIQUE`-based race prevention. Replacing it with a linked list would mean rewriting every chain query as a recursive CTE, denormalising "tail of chain" lookups onto the chain entry, and trading SQL's strengths for a representation that doesn't fit relational semantics. `chain_index` and `continuedToJobId` solve the same problem; `chain_index` is the better-fit primitive for SQL backends.

### Conclusion

Derive in SELECT. Zero migration, no drift, no schema change. The per-read cost is invisible.

## Query audit (LEFT JOIN cost across every state-adapter SELECT)

Audited every query in postgres + sqlite adapters that returns `StateJob` rows. Concise outcome:

**OK without further work** (single-row lookups and paginated reads): `getJob`, `getJobLocked`, `completeJob`, `renewJobLease`, `rescheduleJob`, `unblockJobs`, `listChains`, `listJobs`, `listChainJobs`, `listBlockedJobs`, `getChain`, `createJobs`, `addJobsBlockers`. Each gets one extra B-tree probe per returned row using the existing index.

**Apparent locking concerns that resolve to OK**:

- **`getChainLocked`, `triggerJobs`** — both already use `FOR UPDATE` / `FOR UPDATE SKIP LOCKED`. PG's LEFT JOIN does **not** inherit the lock onto the right side unless we explicitly write `FOR UPDATE OF n`. We won't — we just need the field, not a lock. No extra row locks.
- **`deleteChains`** — returns `[initialJob, currentJob]` pairs (chains, not jobs). `mapStatePairsToChains` only decodes the chain's effective-job output, and the effective job is never a continued-completed job (continuation always creates a new latest). The JOIN value on those rows isn't read for decode purposes. Even if the JOIN sees stale or about-to-delete state, it doesn't affect correctness.

**Verify before merge** (not a worry, just hygiene): run `EXPLAIN (ANALYZE, BUFFERS)` on the paginated read queries with seeded data to confirm the planner uses the `(chain_id, chain_index)` index for the LEFT JOIN. Standard pre-merge step.

## Implementation guidance

### CTE placement

For queries with mutating CTEs (`completeJob`, `renewJobLease`, `rescheduleJob`, `triggerJobs`, `unblockJobs`, `createJobs`, `addJobsBlockers`), put the LEFT JOIN at the **outermost SELECT** that returns StateJob fields, not inside the CTE:

```sql
WITH updated AS (
  UPDATE jobs SET … WHERE … RETURNING *
)
SELECT u.*, n.id AS continued_to_job_id
FROM updated u
LEFT JOIN jobs n ON n.chain_id = u.chain_id AND n.chain_index = u.chain_index + 1;
```

Cleaner than embedding inside CTE, easier for the planner to optimize.

### Touchpoints

1. **`packages/core/src/state-adapter/state-adapter.ts`** — add `continuedToJobId: string | null` to `StateJob`.
2. **`packages/postgres/src/state-adapter/sql.ts`** + **`state-adapter.pg.ts`** — every SELECT that returns `StateJob` fields gets the LEFT JOIN. Mutating queries get the join via outer-SELECT-on-CTE pattern.
3. **`packages/sqlite/src/state-adapter/sql.ts`** + **`state-adapter.sqlite.ts`** — same pattern.
4. **`packages/core/src/entities/job.ts`** — `mapStateJobsToJobs` skips `decode` for the output direction when `continuedToJobId !== null`.
5. **Conformance suite** ([packages/core/src/conformance/state-adapter-cases.ts](../packages/core/src/conformance/state-adapter-cases.ts)) — add cases asserting:
   - Continued jobs have `continuedToJobId === <successor.id>`.
   - Terminal jobs have `continuedToJobId === null`.
   - Pending / blocked / running jobs (no successor yet) have `continuedToJobId === null`.

### Pre-merge validation

- `EXPLAIN (ANALYZE, BUFFERS)` on `listJobs`, `listChainJobs`, `listChains`, `listBlockedJobs` against a seeded dataset (≥10k rows) — confirm the LEFT JOIN uses the composite index, not a sequential scan.
- Existing test [client-queries.test-suite.ts:917](../packages/core/src/suites/client-queries.test-suite.ts#L917) (`listChainJobs returns jobs in chain ordered by chainIndex`) becomes a regression test for the bug — assert `output === null` for continued jobs and the real terminal output for the last job, all under a Zod-style codec.
- Add a focused test exercising `listChainJobs` under a Zod codec with non-trivial output schema (`z.object({ done: z.boolean() })`) to confirm the decode-skip path works.

## What this doesn't do

- Doesn't add a forward-pointer column for dashboard navigation. If we ever want explicit `nextJob` links for the dashboard, the derived `continuedToJobId` is already available in the read path.
- Doesn't change anything about chain-level mappings. `mapStatePairsToChains` is unaffected: chain `currentJob` is always the chain's latest, never a continued-completed intermediate.
- Doesn't introduce a `continuedFromJobId` reverse pointer. We don't need one for any current path; if we do later, derive via `chain_index - 1`.
