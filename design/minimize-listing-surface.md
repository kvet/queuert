# Minimize the listing-query surface

`listChains` and `listJobs` expose a cross-product of filter, status, and ordering axes that an
operational B-tree store (PostgreSQL, SQLite) cannot index. Most combinations degrade to a
residual filter or a forced sort — a full ordered scan of the table to fill one page, worst
exactly when the filter is most selective. The fix is to make **`typeName` a required partition
key** on every list, lead every listing index with it, and expose cheap type discovery so both the
dashboard and internal callers scope by type. Nothing on the surface is then an unbounded scan.

## Problem

For a B-tree to serve a keyset-paginated list in `O(page)`, a single index must **both** order by
the sort key **and** carry every equality filter as a leading column. Each optional axis added to
a list method therefore either:

- gets baked into a dedicated composite index — combinatorial index bloat plus write
  amplification on the hot path, or
- becomes a **residual filter**: scan the whole ordered stream and discard non-matches. This is
  `O(table / selectivity)` — the more selective the filter (a rare `typeName`), the more of the
  table is scanned to fill one page.

[index-coverage-cases.ts](../packages/core/src/suites/index-coverage-cases.ts) enumerates ~60
listing cases across three independent knobs that multiply rather than add: free `orderBy`
(per-status alternatives), secondary predicates (`blocked`, `continued`, `independent`,
`chainTypeName`), and identity filters (`chainId[]`, `jobId[]` on `listJobs`).

The `20260622..._job_model_v2` migration already made this bite: it dropped
`job_listing_type_name_idx` / `chain_listing_type_name_idx` and left the status/created_at partial
indexes as the only listing paths. So today every `typeName` filter is an uncovered residual scan,
`independent` is a correlated `EXISTS` over `job_blocker`, `chainTypeName` is carried by no index
at all, and the non-native `orderBy` choices force a sort.

## Solution: type-scoped listing

The insight that keeps the dashboard usable: the dashboard is human-driven and views bounded
windows (one type, recent N, or one chain drilled into). It does not need arbitrary-filter keyset
pagination over the whole table. So we make the type a mandatory partition and index around it.

### Single required `typeName`

`listChains` / `listJobs` take a **single required `typeName: string`** (not `string[]`). With a
mandatory equality on the leading index column, every list becomes _seek to the type's slice →
ordered range-scan within it_ — textbook keyset pagination, no `IN`, no partition-union, no
merge-sort. Selectivity flips from enemy to friend: a rare type is a tiny slice.

There is deliberately **no cross-type list path**. "Everything across all types, newest first" is
not expressible in one query — it does not scale at 1B rows regardless of indexing, and both the
dashboard and internal callers reach it by fanning out over type discovery (below).

### One sort per status

Drop the free `orderBy` union — the cheapest axis to cut and the largest multiplier. Each status
gets the single sort matched to its partial index:

- `listJobs` pending → `scheduledAt` (`job_pending_idx`)
- `listJobs` running → `attemptUntil` (`job_running_idx`)
- `listJobs` completed → `completedAt` (`job_completed_idx`)
- `listJobs` / `listChains` no-status → `createdAt` (`job_idx` / `chain_head_idx`)
- `listChains` completed → `completedAt` (tail `job_completed_idx`)

Every listing index leads with `type_name`: `(type_name, scheduled_at) WHERE …`,
`(type_name, completed_at) WHERE …`, etc. (`job_ready_idx` / `job_running_idx` already do; the
pending/completed/chain-head listing indexes gain it.)

### Secondary predicates: open questions

`blocked` / `continued` / `independent` are the three secondary predicates on today's listing
surface. They are **not** the same kind of thing, and none has an observed consumer (only the client
type definitions reference them), so their place on the minimized surface is unresolved. The three
fall into two indexability classes:

- **`blocked` (pending) and `continued` are plain column predicates** — `blocked boolean` and
  `continued_to_id IS NOT NULL` live on the job row itself. Each is a cheap residual over the
  already-`type_name`-scoped, already-ordered, backlog-bounded open slice (a column check, no forced
  sort, no cross-table probe) — and could even be promoted to a covered partial index if a hot
  consumer appeared. Coverable; the question is whether anything needs them.
- **`independent` (running chains) is a cross-table anti-join** — "chains not referenced as a
  blocker" is a `NOT EXISTS` against `job_blocker.blocked_by_chain_id`. That fact lives in a
  different table, so **no listing index on the chain row can ever cover it**; every candidate needs
  a correlated subquery probe. Making it covered would require a maintained `referenced_as_blocker`
  flag denormalized onto the chain tail (write amplification on the blocker path). It is the lone
  cross-table residual on the surface — the exception to the "every path is one covering index"
  invariant.

**Open questions:**

- **Drop `independent` entirely?** It is uncoverable, has no observed consumer, and cleanup (its
  original justification) already relies on `deleteChains`' blocker-ref safety instead. Removing it
  restores a clean one-covering-index-per-path invariant. Is there any consumer that still needs
  "list chains not referenced as a blocker" on the guaranteed surface, or does it belong on an
  explicit best-effort path if ever?
- **Keep `blocked` as a cheap residual, or drop it?** It costs nothing to keep (column check over a
  bounded slice) and answers "what pending jobs are stuck waiting on blockers for this type." Is
  there a concrete dashboard/operational consumer, or do we cut it for a maximally minimal surface
  and re-add later?
- **`continued` — confirm dropped?** Column-coverable but continuation is normally followed by chain
  traversal, not listing. Any listing consumer, or drop?
- **Completed-slice predicates.** Even a coverable column predicate, run over the _completed_ slice,
  degrades: a predicate matching 1-in-1M makes each keyset page walk millions of
  `(type_name, completed_at)` entries to fill 20 rows, and a cursor does not rescue it. A `from`/`to`
  window does not bound this unless the window _span_ is also capped (nothing stops
  `from: epoch, to: now`). Do any secondary predicates need to work over completed at all, or are
  they open-slice-only — and if a completed-slice analysis is genuinely needed, does it belong on an
  explicit best-effort / export path rather than the guaranteed listing surface?

### Dropped from the list surface

- **`chainTypeName` on `listJobs`** — it is a _different_ type dimension than the required job
  `typeName`, so it cannot also lead the index; it would be the lone residual filter breaking the
  "everything scopes by the one required type" invariant. No observed usage. Removed; re-addable
  later if a concrete need appears.
- **`chainId[]` / `jobId[]` on `listJobs`** — batch point-lookups wearing a list costume;
  `getJobs({ ids })` serves them by primary key.
- **Redundant `orderBy` choices** — subsumed by one-sort-per-status.

The fate of the secondary predicates (`blocked`, `continued`, `independent`) is not settled here —
see the open questions above.

### `listBlockedJobs` cursor

`listBlockedJobs` is single-chain-scoped but its keyset path is uncovered: it orders by the blocked
job's `created_at` with only `job_blocker_chain_idx (blocked_by_chain_id)`, so each page joins to
`job` and re-sorts (501 ms PG / 388 ms SQLite). The obvious "order by `job_id`, which is already in
the index" fix is unsound: `job_id` can be **caller-supplied** (`createChain`/`continueWith` accept
an `id`), so it is not a library-controlled, time-meaningful order — sorting by it would silently
turn a chronological list into "whatever the ids sort to." (It is still a valid _unique_ keyset, so
pagination stays correct for a pure drain, but the ordering contract breaks.)

The fix is a library-controlled order key that lives in `job_blocker` so the keyset is covered: add
**`job_blocker.created_at`** (`DEFAULT now()`, stamped when the blocker relationship is created) and
key on `(blocked_by_chain_id, created_at, job_id)` — `job_id` as the unique tiebreaker (uniqueness,
not monotonicity). This orders by **when the block was established**, which stays correct under
incremental/unsealed blockers (where a job's own `created_at` is unrelated to when it attached this
blocker) — the right axis for "what got blocked by this chain, in order." The cost is a wider index
on the blocker write path (which the unbounded-blockers work scales to millions of rows); accepted
because the order is part of the contract. Folded in here because it is the same "sort column not in
the available index" defect.

## Type discovery: `listJobTypeNames` / `listChainTypeNames`

Because every list requires a type, the dashboard needs a cheap "which types exist?" entry point,
and internal callers need it to fan out. It must be **data-driven**, not registry-driven: the app
registry is opt-in (`defineJobTypes`) and app-defined type names churn over time, so old data
carries types no longer registered. The registry is at most optional enrichment (labels,
defined-but-zero-row types); the data is authoritative.

Discovery returns **names only** — `listJobTypeNames()` / `listChainTypeNames()` → `string[]`.
Counts are deliberately not part of it: a discovery scan is fast and row-count-independent, while a
count is a per-type, cost-capped operation with a different shape (below). Keeping them separate lets
discovery stay unconditional and lets each count honor an explicit bound.

### Names via a loose index scan

`SELECT DISTINCT type_name` is an `O(table)` scan and must not be used. Instead walk the type-led
index with a recursive **loose (skip) index scan** — one seek per distinct value:

```sql
WITH RECURSIVE types AS (
  (SELECT type_name FROM job ORDER BY type_name LIMIT 1)
  UNION ALL
  SELECT (SELECT type_name FROM job WHERE type_name > types.type_name ORDER BY type_name LIMIT 1)
  FROM types WHERE types.type_name IS NOT NULL
)
SELECT type_name FROM types WHERE type_name IS NOT NULL;
```

Cost is `O(distinct types)` seeks, **independent of row count** — microseconds at 1M or 1B rows.
It relies on type names being a bounded, low-cardinality dimension (document that; dynamically
generated per-entity type names are an anti-pattern that defeats it).

- **`listJobTypeNames`** — piggybacks on the `(type_name, …)` job index; no new index.
- **`listChainTypeNames`** — walks distinct chain types over roots on the type-led
  `chain_head_idx (chain_type_name, created_at) WHERE chain_index = 0` (which already leads with
  `chain_type_name`, so no separate `chain_type_name_idx` is needed).

## Counts: a separate, per-type, capped operation

Counts are their own methods, scoped to **one** type name the caller already chose (e.g. from a
discovered name, or a dashboard picker), and every count is **explicitly capped** — never a query
that can walk an unbounded pile.

- `countByJobTypeName(typeName)` → `{ pending, running, completed }`, each a number plus a
  `…HasMore` flag.
- `countByChainTypeName(typeName)` → `{ running, completed }` (chains have no pending status).

Each per-status count is a **`LIMIT 10000` probe**, not a true `count(*)`:

```sql
SELECT count(*) FROM (
  SELECT 1 FROM job
  WHERE type_name = $1 AND attempt_at IS NULL AND completed_at IS NULL
  LIMIT 10001
) t
```

The result is clamped to 10000 with `hasMore = rows > 10000`, so the dashboard renders "10,000+". A
human needs "big vs. small," not an exact total, and the cap is what keeps **completed** counts —
the otherwise `O(N)` case over the 990M-row pile — bounded instead of infeasible.

The cap fits each status:

- **Open-work counts** (pending / running) ride the _partial_ indexes (`completed_at IS NULL`
  excludes completed rows entirely), so they are already immune to the completed pile; the cap adds
  a backlog bound on top — a pathological 10M-open backlog stops at the 10000th row.
- **Completed counts** have no index trick — a true count is `O(N)`, tens of seconds at 1B rows — so
  the `LIMIT` probe is the only cheap answer.

A **maintained rollup** (`type_name, status → count`) would give exact cheap lifetime totals, but
every completing job of a type updates the same counter row — a hot-row contention point on the
completion path, needing sharded counters. Not worth it unless exact lifetime totals become a hard
requirement.

## No privileged cross-type path

There is no cross-type query in the `StateAdapter` — internal callers eat the same type-scoped
surface as the dashboard. Cleanup that wants "all completed chains older than X, every type"
enumerates and fans out:

```
listChainTypeNames()  →  for each type: listChains({ typeName, status: "completed", to: cutoff })
```

This is a positive, not a workaround: cross-type work becomes an explicit per-type fan-out with
bounded per-transaction lock footprint and natural parallelism — directly helping the open TODOs on
cleaning up 1k+-job chains in one transaction (SQLite WAL / PG lock footprint) and SQLite-readiness
batching. Enumerate-then-iterate is **eventually consistent**, not a snapshot (a type appearing
mid-sweep is caught next run); acceptable for cleanup/observability, and there is no consumer
needing an atomic cross-type view.

## Surface changes

- **Client** — `listChains` / `listJobs` take a single required `typeName: string`; lose the free
  `orderBy` union (one sort per status); lose `chainTypeName`, `chainId[]`, `jobId[]` on `listJobs`.
  New `listJobTypeNames` / `listChainTypeNames` (names only, `string[]`) plus separate
  `countByJobTypeName` / `countByChainTypeName` (per-type, capped per-status counts with `hasMore`).
  Breaking — `major` changeset across `core` and both SQL adapters.
- **`StateAdapter`** — mirror the narrowed parameters; the discriminated unions encode the valid
  `(status, orderBy)` pairs so an unsupported sort is a compile error. Add the type-name discovery
  methods and the per-type count methods. No cross-type list variant.
- **Adapters** — PostgreSQL and SQLite add `type_name` as the leading column to the
  pending/completed/chain-head listing partial indexes; add `job_blocker.created_at` and rebuild
  `job_blocker_chain_idx` as `(blocked_by_chain_id, created_at, job_id)` for the `listBlockedJobs`
  keyset; implement the loose-index-scan discovery and the capped per-type `LIMIT 10000` count probes.
  Schema change executing on user DBs (`DROP INDEX
CONCURRENTLY` + recreate on PG, `DROP/CREATE` on SQLite) — needs a changeset. Update
  [postgres-internals](../docs/src/content/docs/advanced/postgres-internals.md) and
  [sqlite-internals](../docs/src/content/docs/advanced/sqlite-internals.md) index tables (already
  stale — they omit several v2 indexes).
- **Coverage matrix** — prune `index-coverage-cases.ts` to the type-scoped set; add the discovery
  (loose-scan) and capped per-type count cases so the benchmark asserts the new fast paths.

## Sequencing

Settle this **before** the two deduplication reads/listing docs land — both add axes to the
surface we are shrinking:

- [chain-identity.md](chain-identity.md) — point lookup on `getChain` / `getChains`; it replaces
  `job_deduplication_idx` with two partial unique indexes, which should land in the same index
  migration.
- [list-chains-by-deduplication.md](list-chains-by-deduplication.md) — explicitly states its filter
  "does not compose cleanly" with `listChains`. Author it against the post-minimization surface: a
  dedup-key filter is a type-scoped path backed by `job_deduplication_idx`.

## Implementation spec

The scale=100 baseline (SQLite + PG) confirms the thesis on both engines: type-scoped listings are
88–205 ms (PG) / 40–177 ms (SQLite) and the worst uncovered paths reach ~1 s
(`listChains/completed/orderByCreatedAtCursor`), while `listJobs/running/typeName` — the one
already-type-led path — is 6–9 ms. The concrete surface, index set, and query shapes are below.

### API surface

- `listChains(typeName: string, …)` / `listJobs(typeName: string, …)` — single **required** type.
  Client `typeName` narrows the result element type to exactly one type (no union).
- One sort per status, no `orderBy` param at all:
  - `listJobs` no-status → `createdAt`; pending → `scheduledAt`; running → `attemptUntil`;
    completed → `completedAt`.
  - `listChains` no-status → `createdAt`; running → `createdAt` (open **tail** row's `created_at`);
    completed → `completedAt`.
- `from`/`to` **binds to the status's native sort column** (not always `created_at`). So it is always
  a covered range that narrows the ordered scan — never a residual. Cleanup's `to: cutoff` on
  completed chains becomes `completed_at <= cutoff`, covered.
- Secondary predicates (`blocked`, `continued`, `independent`) — **unresolved**, tracked as open
  questions above. Cleanup no longer depends on `independent`: it relies on `deleteChains`' existing
  `blockerRefs` safety (a completed chain still referenced as a blocker fails the delete and is
  retried later), so dropping `independent` does not block cleanup.
- Dropped: `chainTypeName`, `chainId[]`, `jobId[]` on `listJobs`; `chainId[]` on `listChains`; the
  free `orderBy` union. `getJobs({ ids })` / `getChains({ ids })` serve the identity intents.
- New `listJobTypeNames()` / `listChainTypeNames()` → `string[]` (names only). Per-type counts live
  in separate capped methods: `countByJobTypeName(typeName)` →
  `{ pending, running, completed }` and `countByChainTypeName(typeName)` → `{ running, completed }`,
  each count a `LIMIT 10000` probe clamped with a `…HasMore` flag.

### Index set (both adapters; PG via `CREATE INDEX CONCURRENTLY`, SQLite inline)

Job listing (lead with `type_name`):

- `job_idx` → `(type_name, created_at)` — no-status listJobs; loose-scan source for `listJobTypeNames`.
- `job_pending_idx` → `(type_name, scheduled_at) WHERE attempt_at IS NULL AND completed_at IS NULL`.
- `job_running_idx` → `(type_name, attempt_until) WHERE attempt_at IS NOT NULL AND completed_at IS NULL` — already type-led, unchanged.
- `job_completed_idx` → `(type_name, completed_at) WHERE completed_at IS NOT NULL`.
- `job_ready_idx` — unchanged (acquisition, not listing).

Chain listing (lead with `chain_type_name`, which is denormalized onto every job row):

- `chain_head_idx` → `(chain_type_name, created_at) WHERE chain_index = 0` — no-status chains;
  loose-scan source for `listChainTypeNames`. **This removes the need for the separately proposed
  `chain_type_name_idx`** — the type-led head index already leads with `chain_type_name`.
- `chain_tail_open_idx` → `(chain_type_name, created_at) WHERE continued_to_id IS NULL AND completed_at IS NULL`
  — running chains; open-chain-count source. (Repurposed from `(chain_id)`.)
- `chain_tail_completed_idx` → `(chain_type_name, completed_at) WHERE continued_to_id IS NULL AND completed_at IS NOT NULL`
  — completed chains. (Repurposed from `(chain_id)`.)
- Per-chain tail resolution (the no-status `LEFT JOIN LATERAL … ORDER BY chain_index DESC LIMIT 1`)
  that used the old `(chain_id)` tail indexes falls back to `chain_index_idx (chain_id, chain_index)`.
  This is a single `LIMIT 1` backward seek to the tail — `O(log N)` in chain length, **not** a scan of
  the chain, so a 1M-job chain resolves in one seek like any other. The only regression vs. the old
  partial tail indexes is one heap fetch per listed chain (they made the tail check index-only). The
  running/completed branch resolves the head by primary key (`root.id = tail.chain_id`), also a single
  seek. Verified non-regressing via the operational benchmark cases; a dedicated tail index is re-added
  only if they regress.

`listBlockedJobs`: add `job_blocker.created_at` (`DEFAULT now()`, stamped at blocker insert) and key
on `(blocked_by_chain_id, created_at, job_id)`. Orders by when the block was established (library-
controlled, so immune to caller-supplied `job_id`); `job_id` is the unique tiebreaker. The keyset
walks the index; no join-and-sort per page.

Per-type counts (`countByJobTypeName` / `countByChainTypeName`): one capped `LIMIT 10000` probe per
status, each riding the matching partial index for the caller's single type — pending on
`job_pending_idx`, running on `job_running_idx`, completed on `job_completed_idx`; chain running on
`chain_tail_open_idx`, chain completed on `chain_tail_completed_idx`. No new count index, no grouped
aggregate, no join against discovery. Discovery (`listJobTypeNames` / `listChainTypeNames`) is a
pure loose scan returning names only.

## Tests

- Every type-scoped `(method, status)` path resolves via its intended type-led index — assert
  through the query-performance benchmark's EXPLAIN output, not just latency.
- The `type + status` paths that regressed after v2 (`listJobs/pending/typeName`,
  `listChains/completed/typeName`, …) return to sub-2 ms on PG / sub-1 ms on SQLite at scale = 100.
- `listJobTypeNames` / `listChainTypeNames` return names only (`string[]`) and cost is flat as row
  count grows (loose scan).
- `countByJobTypeName` / `countByChainTypeName` are per-type and capped: each per-status count is a
  `LIMIT 10000` probe clamped to 10000 with a `hasMore` flag, cost bounded by the cap and (for
  open statuses) flat as the completed pile grows via partial-index immunity.
- `listBlockedJobs` cursor pages walk `(blocked_by_chain_id, created_at, job_id)` (no join-and-sort),
  and the order is stable/chronological even when `job_id` is caller-supplied.
- Dropped params (`chainTypeName`, `chainId[]`, `jobId[]` on `listJobs`; multi-`typeName`;
  free `orderBy`) are gone at the type level; `getJobs({ ids })` covers the identity intent.
- Cleanup fans out over `listChainTypeNames` and processes per type.
