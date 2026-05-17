# Surface `continuedToJobId` on jobs; hide `chainIndex` as SQL-internal

## Problem

Two coupled model issues, both load-bearing once we start adding read-path transformations:

**1. `output: null` is overloaded as a continuation marker.** A job that calls `continueWith(...)` is marked `status: "completed"` with `output: null` — the null isn't a real value, it's a sentinel meaning "this job continued instead of terminating." A user whose terminal output type is `T | null` already can't tell the two cases apart. Any future read-path transformation (validators, codecs, output mappers, encryption layers) has to special-case the null sentinel — and most validator schemas (`z.object({...})`, `v.object({...})`, ArkType) reject `null` outright, so a naive validate-on-read pass crashes on continued jobs. The data model has no field that says "this job is a continuation, not a terminal."

**2. `chain_index` leaks through the public API.** A SQL ordering integer is exposed on `StateJob`, `Job`, and threaded through `createStateJobs` arguments — see [job.types.ts:21](../packages/core/src/entities/job.types.ts#L21) (`Job.chainIndex`), [state-adapter.ts:13](../packages/core/src/state-adapter/state-adapter.ts#L13) (`StateJob.chainIndex`), and the worker call site at [job-process.ts:500-514](../packages/core/src/worker/job-process.ts#L500) that computes `chainIndex: parent.chainIndex + 1` to thread through. None of those leaks reflect a user concern — `chain_index` exists to make the SQL fast and safe, not to be part of the data model.

Reproducible scaffolding today: the existing test [client-queries.test-suite.ts:917](../packages/core/src/suites/client-queries.test-suite.ts#L917) loops `step → step → step` via `continueWith`, then `listChainJobs(chainId)` — the first two jobs come back with `output: null` (the sentinel), the third with the real terminal output. Today the test passes because the test asserts on `chainIndex: 0/1/2`; that's exactly the assertion the design needs to remove, and replace with a chain-of-`continuedToJobId` walk.

We fix both at once because surfacing `continuedToJobId` is the right way to disambiguate "continued vs terminal", and once that exists, `chain_index` has no remaining job in the public model.

## Approach

Two coupled changes:

1. **Add a stored `continued_to_job_id` FK column** on the job table. Nullable; non-null exactly when this job has a successor in its chain. This is the real, persisted "continuation" signal — `mapStateJobToJob` produces a continued vs terminal variant based on it, and the dashboard / observability / user code can navigate forward without inferring it from chain position.

2. **Demote `chain_index` to a SQL-internal ordering primitive.** It stays in the schema and continues to drive ordering, range scans, race prevention, and tail lookup — but it is removed from `StateJob`, `Job`, and every adapter argument that currently passes it through. Cursor pagination tokens become opaque ids, decoded via `continued_to_job_id` (with the range scan still happening on `chain_index` server-side).

Why both: surfacing `continuedToJobId` was already the right way to fix the codec/null-marker bug; doing it without removing `chainIndex` from the public surface would leave two relationships expressing the same fact, with one of them being an internal ordering integer that has no business in the public model.

## What this means concretely

### Public surface

- `StateJob.continuedToJobId: string | null` — new field on the flat state-adapter shape. Always equals the id of the next job in the chain, or null if this is the latest.
- `StateJob.chainIndex` — **removed**.
- `Job.chainIndex` — **removed**.
- `Job`'s `completed` status splits into two variants — the type-level expression of "terminated vs continued":

  ```ts
  type Job<TJobId, TJobTypeName, TChainTypeName, TInput, TOutput> = {
    id: TJobId;
    chainId: TJobId;
    typeName: TJobTypeName;
    chainTypeName: TChainTypeName;
    input: TInput;
    createdAt: Date;
    scheduledAt: Date;
    attempt: number;
    lastAttemptAt: Date | null;
    lastAttemptError: string | null;
  } & (
    | { status: "blocked" }
    | { status: "pending" }
    | { status: "running"; leasedBy?: string; leasedUntil?: Date }
    | {
        status: "completed";
        completedAt: Date;
        completedBy: string | null;
        output: TOutput;
        continuedToJobId: null;
      }
    | {
        status: "completed";
        completedAt: Date;
        completedBy: string | null;
        output?: never;
        continuedToJobId: TJobId;
      }
  );
  ```

  The two completed variants share `status: "completed"` and discriminate on `continuedToJobId` being null vs `TJobId`. `output?: never` on the continued variant makes "no real output here" a type-level fact, not a runtime null.

  Navigation pattern users will write:

  ```ts
  if (job.status === "completed") {
    if (job.continuedToJobId !== null) {
      const next = await client.getJob({ id: job.continuedToJobId });
      // job.output is `never` here — TS won't let you read it
    } else {
      const out = job.output; // TOutput
    }
  }
  ```

- `mapStateJobToJob` ([packages/core/src/entities/job.ts](../packages/core/src/entities/job.ts)) — completed branch splits: returns the terminal variant (with `output: stateJob.output`, `continuedToJobId: null`) when `stateJob.continuedToJobId === null`, or the continued variant (with `continuedToJobId: stateJob.continuedToJobId`, no `output` field) otherwise. Stops projecting `chainIndex`.
- `createStateJobs` continueWith argument: drop `chainIndex`, take `continueFromJobId: TJobId` instead. The SQL resolves the index server-side.
- Cursor pagination token (`listChainJobs`) is an opaque id. Decode resolves to a starting position via the FK pointer; the page query itself is still a `chain_index` range scan internally.

### SQL internals (kept, hidden)

- `chain_index` column stays exactly as today.
- `(chain_id, chain_index)` UNIQUE stays — provides race prevention on `continueWith` (two concurrent attempts both compute index N+1; one INSERT wins, the other fails).
- `getChain`'s `ORDER BY chain_index DESC LIMIT 1` for tail lookup stays.
- All `ORDER BY chain_index` clauses in `listChainJobs` stay.
- `continueWith` INSERT derives `chain_index` server-side from `continueFromJobId` — see [Chain index assignment](#chain-index-assignment) below.

### Storage cost

`continued_to_job_id` is `NULL` for ~every chain's latest job and for every non-completed job, and ~16–36 bytes (uuid/text) per row otherwise. With nullable storage (PG `text` or `uuid`, SQLite `TEXT`), null rows pay a bit per row, populated rows pay the id width. Linear in row count, well below the cost of the `input`/`output` jsonb fields that already dominate.

## Why stored, not derived

Earlier draft of this doc proposed deriving `continuedToJobId` via a `LEFT JOIN jobs n ON n.chain_id = j.chain_id AND n.chain_index = j.chain_index + 1` on every read SELECT. Rejected:

- **SQLite mutating-CTE problem.** Postgres lets you wrap an `UPDATE … RETURNING *` in a CTE and `SELECT … LEFT JOIN` from it. SQLite does not — modifying CTEs aren't supported, and `RETURNING` can't reference other tables. Every mutating query that produces a `StateJob` would need a separate follow-up SELECT.
- **Audit-every-SELECT cost.** Postgres + SQLite together have ~13 SELECT-shaped sites that return job rows. Adding the join to all of them, then `EXPLAIN`-verifying each uses the composite index, then re-auditing on every future query change, is real ongoing maintenance.
- **No way to surface to clients.** The whole point is that the field is publicly meaningful — for the dashboard's "next job" link, for FK-based cursor pagination, for telling continued vs terminal apart on the public `Job` type. Deriving it on every SELECT just to throw it on the wire is doing the work twice.
- **Drift risk overstated.** With a single write site (`continueWith` → `createStateJobs`), a partial UNIQUE index `(continued_to_job_id) WHERE continued_to_job_id IS NOT NULL`, and a CHECK `continued_to_job_id IS NULL OR status = 'completed'`, the consistency surface is small and DB-enforced.

## Why hide `chainIndex`

`chain_index` is a contiguous integer assigned by `continueWith`. It exists to:

1. Serialize concurrent `continueWith` attempts via a UNIQUE constraint.
2. Provide cheap range-scan ordering for `listChainJobs`.
3. Give `getChain` a cheap tail lookup.

None of those are user concerns. Today the field leaks because the worker JS-side computes `chainIndex: parent.chainIndex + 1` and threads it through `continueWith` → `createStateJobs`, and because `mapStateJobToJob` projects it onto every `Job`. Both are accidents of how the SQL was originally written, not part of the data model.

The data-model relationship is **"this job continues to that job."** Once that's expressed as `continuedToJobId`, the only thing `chain_index` is for is making the SQL fast and safe — exactly the kind of thing that should live below the public surface, free to be replaced (timestamps, lexicographic strings, whatever) without breaking users.

## Alternatives rejected

### Stored `continued: boolean`

Smaller (~1 byte) but solves only the decode-gate problem, not the dashboard-navigation or cursor-pagination needs that justified the `chainIndex` cleanup. Same migration cost, strictly less utility.

### Add `'continued'` to the `status` enum

Requires cascade audit of every `status = 'completed'` predicate (chain `currentJob` resolution, completion counts, observability emits, conformance assertions). Conflates worker-state (`blocked → pending → running → completed`) with chain-position (continued vs terminal). Breaks user SQL that treats `'completed'` as terminal.

### Replace `chain_index` with a linked-list-only model (drop the column)

Tempting given we're hiding it anyway, but the column carries real weight: range-scan pagination, UNIQUE-based race prevention, tail lookup. Replacing range scans with recursive CTE FK-walks is order-of-magnitude slower on cold cache; replacing the UNIQUE with compare-and-swap on `parent.continued_to_job_id` works but adds error-handling at the application layer. Keep `chain_index`, just stop exposing it.

### Manually-supplied `created_at` for ordering instead of `chain_index`

Considered. Rejected — workerless completion can produce many jobs at sub-millisecond resolution, clock skew is real, and ordering by a human-supplied timestamp is brittle. `chain_index` is a clean monotonic counter; keep it.

## Cursor pagination via `continuedToJobId`

Token: opaque string, an id of the previous page's last row. (First page: empty token.)

```sql
WITH start_row AS (
  SELECT n.chain_index
  FROM jobs c
  JOIN jobs n ON n.id = c.continued_to_job_id
  WHERE c.id = $cursorId
)
SELECT j.* FROM jobs j, start_row s
WHERE j.chain_id = $1
  AND j.chain_index >= s.chain_index
ORDER BY j.chain_index ASC
LIMIT $N + 1;
```

Two PK probes for the boundary, then a range scan — same cost as decoding `(chainIndex, id)` directly (~µs). Side benefits:

- **End-of-chain is explicit.** If the cursor row's `continued_to_job_id IS NULL`, `start_row` is empty and the page is empty — no extra check.
- **Gap-tolerant.** If single-job deletion is ever added (e.g. GDPR), FK-walk still works.

For descending order (`orderDirection: "desc"`), the same trick uses `chain_index <= s.chain_index ORDER BY chain_index DESC`. We don't add a `continued_from_job_id` reverse pointer — the asymmetry stays inside the SQL, not the API. (If a real use-case for reverse FK walk surfaces, a derived/computed field is enough; the column stays out.)

First page (no cursor): `WHERE chain_id = $1 ORDER BY chain_index $dir LIMIT $N+1`. No FK lookup.

`nextCursor` production: if the page query returned `N+1` rows, drop the extra row and encode the last kept row's `id` as the cursor. Otherwise (fewer than `N+1` rows) `nextCursor: null`. Cursor format is opaque to clients but in practice an id-only string — simpler than today's `(chainIndex, id)` tuple.

Stale or end-of-chain cursors: if the cursor row has been deleted, or its `continued_to_job_id IS NULL`, the `start_row` CTE returns zero rows → page is empty → `nextCursor: null`. Graceful, not an error.

## Chain index assignment

`chain_index` never crosses the public boundary — `createStateJobs` no longer accepts it as input. For continueWith jobs, the SQL derives it from `continueFromJobId`; for chain starts, it's hard-coded to 0. Both `chain_id` and `chain_type_name` are also inherited from the parent, eliminating three accidentally-redundant arguments at the call site.

### Input shape change

`createStateJobs` per-job input drops `chainId`, `chainTypeName`, `chainIndex`. It gains a discriminator:

```ts
type CreateJobInput =
  | { kind: "chainStart"; typeName: string; chainTypeName: string; input: unknown; ... }
  | { kind: "continueWith"; typeName: string; continueFromJobId: string; input: unknown; ... }
```

(`...` = the existing dedup / scheduling / trace-context fields, unchanged.) The worker call site in [packages/core/src/worker/job-process.ts:500-514](../packages/core/src/worker/job-process.ts#L500) collapses from "thread `chainId`/`chainTypeName`/`chainIndex+1` from `parent`" to a single `continueFromJobId: parent.id`.

### Postgres SQL

The `input_data` CTE joins each continueWith row against its parent to inherit `chain_id`, `chain_type_name`, and the next `chain_index`. Chain-start rows skip the join and use defaults:

```sql
input_data AS (
  SELECT
    gi.id, gi.ord,
    raw.kind, raw.type_name, raw.continue_from_job_id,
    -- inherited from parent for continueWith; defaulted for chainStart
    COALESCE(parent.chain_id, gi.id)            AS chain_id,
    COALESCE(parent.chain_type_name, raw.chain_type_name) AS chain_type_name,
    COALESCE(parent.chain_index + 1, 0)         AS chain_index,
    raw.input, raw.dedup_key, ...
  FROM unnest($2::text[], $3::text[], $4::{{id_type}}[], $5::text[], ...)
       WITH ORDINALITY AS raw(kind, type_name, continue_from_job_id, chain_type_name, ..., ord)
  JOIN generated_ids gi USING (ord)
  LEFT JOIN {{schema}}.{{table_prefix}}job parent
    ON raw.kind = 'continueWith' AND parent.id = raw.continue_from_job_id
)
```

Chain starts hit `parent IS NULL`, so the `COALESCE`s pick `gi.id` (self-reference for `chain_id`), the supplied `chain_type_name`, and `0`.

### `existing_continuations` rewrite (idempotency)

Today's CTE detects "this `(chain_id, chain_index)` already exists" via JS-supplied integers ([sql.ts:435-444](../packages/postgres/src/state-adapter/sql.ts#L435)). Same logical check, just expressed via the parent-derived index:

```sql
existing_continuations AS (
  SELECT DISTINCT ON (id2.ord) id2.ord, j.*
  FROM input_data id2
  JOIN {{schema}}.{{table_prefix}}job j
    ON id2.kind = 'continueWith'
    AND j.chain_id = id2.chain_id
    AND j.chain_index = id2.chain_index    -- already parent.chain_index + 1
    AND j.id != j.chain_id                 -- exclude chain start
  ORDER BY id2.ord
)
```

The `j.id != j.chain_id` guard is unchanged from today — distinguishes "an actual continuation already at this slot" from "the chain start happens to be at index 0."

### Parent `continued_to_job_id` update (post-INSERT)

After `inserted_jobs` returns, update each parent — compare-and-swap to keep races clean:

```sql
WITH parent_updates AS (
  UPDATE {{schema}}.{{table_prefix}}job p
  SET continued_to_job_id = ij.id
  FROM inserted_jobs ij
  JOIN input_data id ON id.id = ij.id
  WHERE p.id = id.continue_from_job_id
    AND p.continued_to_job_id IS NULL
  RETURNING p.id
)
SELECT ...  -- existing union of existing_continuations + existing_deduplicated + inserted
```

Postgres folds this into the same statement via mutating CTEs. SQLite runs the equivalent as a follow-up `UPDATE … WHERE continued_to_job_id IS NULL` against the inserted ids in the same savepoint.

A zero-row update on this CAS is _not_ an error here — it just means we hit the `existing_continuations` path on a re-run of the same continueWith, where the parent was already pointed at the existing successor. The INSERT path uses `ON CONFLICT (chain_id, chain_index) DO UPDATE SET id = ...job.id` (existing pattern) to return the existing row; the parent's `continued_to_job_id` is already correct from the first run.

### What about `start-chains.ts`?

Chain starts don't go through this path — they always pass `kind: "chainStart"` with no parent. `chain_index = 0`, `chain_id = self`. No `continued_to_job_id` to set on anyone (no parent exists).

## Race prevention

Two concurrent `continueWith` from the same parent both read `parent.chain_index = N` and try to INSERT with `chain_index = N+1`. The `(chain_id, chain_index)` UNIQUE — and equivalently `ON CONFLICT (chain_id, chain_index) DO UPDATE SET id = job.id` on the existing INSERT path — is the actual race-decider: the loser's INSERT short-circuits to return the winner's row.

The `UPDATE parent SET continued_to_job_id = $newId WHERE id = $parentId AND continued_to_job_id IS NULL` is **not** a second guard — it's the CAS that makes the idempotent re-run path benign. Once the winner has set `continued_to_job_id`, every subsequent re-run (whether from a true race loser or from a worker retry of the same `continueWith`) finds the field already set, the WHERE clause matches zero rows, and the no-op is correct: the field already points at the right successor. Treating the zero-row outcome as an error would break idempotency.

Both writes (the INSERT and the parent UPDATE) live in the same savepoint as `completeJob`, so they commit atomically. Readers see "both or neither."

## Migration

One migration per adapter (named to follow the existing convention: `2026MMDDhhmmss_continued_to_job_id`).

### Postgres

```sql
ALTER TABLE {{schema}}.{{table_prefix}}job
  ADD COLUMN continued_to_job_id {{id_type}}
    REFERENCES {{schema}}.{{table_prefix}}job(id);

CREATE UNIQUE INDEX {{table_prefix}}job_continued_to_job_id_idx
  ON {{schema}}.{{table_prefix}}job (continued_to_job_id)
  WHERE continued_to_job_id IS NOT NULL;

UPDATE {{schema}}.{{table_prefix}}job j
SET continued_to_job_id = n.id
FROM {{schema}}.{{table_prefix}}job n
WHERE n.chain_id = j.chain_id AND n.chain_index = j.chain_index + 1;

ALTER TABLE {{schema}}.{{table_prefix}}job
  ADD CONSTRAINT {{table_prefix}}continued_to_job_id_only_when_completed
  CHECK (continued_to_job_id IS NULL OR status = 'completed');
```

The backfill UPDATE rides the existing `(chain_id, chain_index)` UNIQUE — single index scan, fast. The CHECK is added _after_ backfill so existing data passes.

### SQLite

`ALTER TABLE … ADD COLUMN` is supported. Partial UNIQUE indexes are supported. CHECK on `ALTER TABLE` is **not** — SQLite requires CHECK constraints to be declared at table creation time. Two options:

1. **Skip the CHECK on SQLite.** Conformance suite already enforces the invariant; the partial UNIQUE handles uniqueness. Application-side discipline carries the rest. Pragmatic.
2. **Table rebuild** (`CREATE TABLE …_new`, copy, swap). Heavier migration, runs on every existing user database. Not worth it for a soft constraint.

Going with option 1.

```sql
ALTER TABLE {{table_prefix}}job
  ADD COLUMN continued_to_job_id {{id_type}} REFERENCES {{table_prefix}}job(id);

CREATE UNIQUE INDEX {{table_prefix}}job_continued_to_job_id_idx
  ON {{table_prefix}}job (continued_to_job_id)
  WHERE continued_to_job_id IS NOT NULL;

UPDATE {{table_prefix}}job AS j
SET continued_to_job_id = (
  SELECT n.id FROM {{table_prefix}}job n
  WHERE n.chain_id = j.chain_id AND n.chain_index = j.chain_index + 1
);
```

`{{id_type}}` matches the existing schema templating ([sql.ts:78,80](../packages/sqlite/src/state-adapter/sql.ts#L78)) — typically `TEXT` for SQLite, but routed through the same template variable as PG for consistency.

### In-process adapter

No migration. Maintain `continuedToJobId` on write — when `createJobs` runs the continueWith branch, set `parent.continuedToJobId = newJob.id` on the in-memory record in the same call. Reads project the field directly. Symmetric with PG/SQLite, no read-path lookup.

## Touchpoints

1. `packages/core/src/state-adapter/state-adapter.ts` — add `continuedToJobId: string | null` to `StateJob`; remove `chainIndex`.
2. `packages/core/src/entities/job.types.ts` — remove `chainIndex` from base; split `completed` into terminal (`output: TOutput`, `continuedToJobId: null`) and continued (`output?: never`, `continuedToJobId: TJobId`) variants.
3. `packages/core/src/entities/job.ts` (`mapStateJobToJob`) — produce the terminal-completed or continued-completed variant based on `stateJob.continuedToJobId`; stop projecting `chainIndex`.
4. `packages/core/src/implementation/continue-with.ts`, `create-state-jobs.ts`, `start-chains.ts` — drop `chainIndex` arg threading; pass `continueFromJobId` for the continueWith path.
5. `packages/core/src/worker/job-process.ts` — stop reading `parent.chainIndex`; pass `parent.id` as `continueFromJobId`.
6. `packages/core/src/state-adapter/cursor.ts` — cursor encoding becomes id-only; decode resolves via FK in SQL.
7. `packages/postgres/src/state-adapter/sql.ts` + `state-adapter.pg.ts`:
   - Migration above.
   - `createJobs` continueWith path: SQL computes `chain_index` from `continueFromJobId`, sets `continued_to_job_id` on parent in same txn.
   - `listChainJobs` cursor decode: FK-resolved start_row (CTE), range scan unchanged.
   - All other reads: include the new column in `dbJobColumns` / `mapDbJobToStateJob`. No JOINs needed.
8. `packages/sqlite/src/state-adapter/sql.ts` + `state-adapter.sqlite.ts` — same as PG.
9. `packages/core/src/state-adapter/state-adapter.in-process.ts` — maintain `continuedToJobId` on the in-memory record; same logic.
10. `packages/core/src/conformance/state-adapter-cases/` — every case currently asserting `chainIndex` switches to `continuedToJobId` chain assertions; new cases for the partial-UNIQUE invariant and the CHECK (on PG).
11. `packages/dashboard/src/api/routes/jobs.ts` — current "fetch next chain job via 1-row paginated `listChainJobs`" call ([jobs.ts:50-58](../packages/dashboard/src/api/routes/jobs.ts#L50)) collapses to `client.getJob({ id: job.continuedToJobId })` when non-null.
12. `packages/dashboard/src/specs/api.spec.ts` — the `chainIndex` assertion at [api.spec.ts:347](../packages/dashboard/src/specs/api.spec.ts#L347) becomes a `continuedToJobId` check on the parent. Test helpers `createJob` / `createContinuation` ([api.spec.ts:28,39,45](../packages/dashboard/src/specs/api.spec.ts#L28)) currently take `chainIndex` and pass it through to `createStateJobs`; their signatures change to match the new `kind: "chainStart" | "continueWith"` discriminator.
13. `packages/otel/src/specs/otel.spec.ts` — same chainIndex → continuedToJobId swap.
14. `packages/core/src/suites/client-queries.test-suite.ts:917` — assert `continuedToJobId` chain instead of `chainIndex: 0/1/2`.
15. `examples/showcase-queries/src/index.ts:189,239` — drop the `Chain index: ${job.chainIndex}` and `[${j.chainIndex}]` console lines, or replace with `id`-based output. `bun run examples` currently exercises this file end-to-end.

## What this doesn't do

- Doesn't add `continuedFromJobId`. No current code path needs it; if dashboard reverse-nav or symmetry pressure surfaces, derive at read time from `chain_index - 1`, no schema change required.
- Doesn't expose chain _position_ (`positionInChain: 3 of 5`). If a use case demands it, add it as a derived view-only field populated from `chain_index` server-side — labelled as a snapshot, not a stable model field.
- Doesn't change `chain_id`. Chains are user-facing; `chain_id` stays.
- Doesn't change `mapStatePairsToChains`. The chain's effective job is always the latest, which by definition has `continuedToJobId === null` — so output decode proceeds normally.

## Pre-merge validation

- `EXPLAIN (ANALYZE, BUFFERS)` on `listChainJobs` with a seeded chain (~10k jobs) confirming the cursor CTE uses the PK + composite index, not a sequential scan.
- Existing test [client-queries.test-suite.ts:917](../packages/core/src/suites/client-queries.test-suite.ts#L917) becomes a regression test for the new variant split — assert that the first two jobs are the continued-completed shape (`continuedToJobId` non-null, `output` field absent), the third is the terminal-completed shape (`continuedToJobId: null`, `output: { done: true }`), and that walking the FK chain from the first job reaches the third.
- Race test: two concurrent `continueWith` from the same parent — exactly one inserts a new row; the other's INSERT short-circuits via `ON CONFLICT` to return the same row, and the parent's `continued_to_job_id` ends up pointing at the unique successor with no spurious overwrite.
- Idempotent re-run test: invoke `continueWith` twice with identical arguments — second call returns the existing successor; parent's `continued_to_job_id` unchanged; no rows duplicated.
- Migration test: backfill on a seeded pre-migration DB produces correct `continued_to_job_id` values for every existing chain (every non-tail completed job points at its successor; tails and non-completed jobs stay null).
