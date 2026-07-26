# Unbounded blockers

Scale blocker resolution to an unbounded number of blocked jobs (fan-out) and an unbounded
number of blocker chains per job (fan-in) — without changing the bounded, sealed blocker path
that already works.

Two coupled features share a schema primitive (`job_blocker.blocked`) and a runtime primitive
(library-owned system chains). This document treats them as a single unit.

## Problem

### Fan-out: one chain unblocks many

When a chain completes, `finishJob` calls `stateAdapter.unblockJobs({ blockedByChainId })`
inside the completing job's transaction. That single call clears `blocked = false` on **every**
dependent of the chain in one `UPDATE` and buffers one notify + one observability event per
unblocked job. One shared setup chain that a million jobs wait on means a million-row update
plus a million events in a single transaction — a latency spike and a long-held lock on the
completing job's path.

### Fan-in: one job waits for many

Blockers are a creation-time property today. Every path (`createChain`, `createChains`,
`continueWith`) funnels into `createStateJobs`, which inserts all `job_blocker` rows atomically
and enforces `MAX_BLOCKERS_PER_JOB = 100`. There is no post-creation mutation path. This serves
bounded, heterogeneous fan-in well — `[validate-user, load-config]` tuples solve a real pain
and stay exactly as-is. It does not serve massive homogeneous fan-in: 1m producer chains that
must all complete before one collector runs.

`blockers` stays unchanged. This adds a **separate, opt-in concept** for the homogeneous,
unbounded case.

## Shared schema primitive: `job_blocker.blocked`

```sql
ALTER TABLE job_blocker ADD COLUMN blocked boolean NOT NULL DEFAULT true;
```

A denormalization of the blocker chain's completion status onto the `job_blocker` row. Today
`unblockJobs` determines whether a blocker is resolved by joining against the blocker chain's
tail job (a correlated subquery per blocker row: `SELECT completed_at FROM job WHERE chain_id =
? ORDER BY chain_index DESC LIMIT 1`). For a sealed job with 5 blockers this runs 5
subqueries. For an unsealed job with 1m blockers it runs 1m subqueries.

With this column the check becomes:

```sql
NOT EXISTS (SELECT 1 FROM job_blocker WHERE job_id = $1 AND blocked = true)
```

`job_blocker` rows are write-once-flip-once: inserted with `blocked = true` (or `false` if the
blocker chain is already completed at attachment time), then flipped to `false` when the blocker
completes. No contention.

Index: `(job_id) WHERE blocked = true` — the `NOT EXISTS` hits this partial index and returns
immediately when any blocker is still incomplete. When all are complete the index is empty for
that `job_id` and the scan is instant.

`fillfactor` tuning: `job_blocker` gains an in-place update path (the `blocked` flip), so
reserve free space per heap page so the flip runs as a HOT update without new index entries,
matching the `job` table's existing `fillfactor = 75` setting.

### Unblock predicate (unified)

The predicate applies identically to sealed and unsealed blockers:

```
job is unblockable  ⟺  job.unsealed_blockers = false
                        AND NOT EXISTS (job_blocker WHERE job_id AND blocked = true)
```

Three trigger points:

1. **`addJobBlockers`** (sealed path, creation time) — inserts rows with `blocked` set based on
   the blocker chain's current completion (`completed_at IS NOT NULL`). If any blocker is
   incomplete → `job.blocked = true`.
2. **`unblockJobs`** (a blocker chain completes) — flips `job_blocker.blocked = false` for that
   chain's rows across all dependents, then for each dependent: if `unsealed_blockers = false`
   and `NOT EXISTS (... AND blocked = true)` → `job.blocked = false` (job becomes pending).
3. **`sealJobBlockers`** (unsealed path only) — flips `unsealed_blockers = false`, then the same
   `NOT EXISTS` check. If all blockers already complete → `job.blocked = false` (job becomes
   pending). Otherwise the normal unblock path (trigger 2) catches it when the remaining
   blockers complete.

No race between triggers 2 and 3. If a blocker completes before sealing, `unblockJobs` sees
`unsealed_blockers = true` and skips the `job.blocked` flip; `sealJobBlockers` catches it in
its final check. If sealed first with an incomplete blocker, `unblockJobs` fires on the last
completion. Both orderings converge. The job row is locked before checking in both paths.

### Impact on existing (sealed) blockers

`job_blocker.blocked` is a general improvement — it applies to sealed blockers too. The current
`unblockJobs` join against the chain tail's `completed_at` is replaced by a `blocked` flip +
partial index check.
For sealed blockers the row count is bounded by `MAX_BLOCKERS_PER_JOB = 100`, so the
performance difference is negligible — but the code path is unified.

The job model deliberately omitted a `job_blocker.open` denormalization because
`unblockJobs` "already operates on a bounded set." Unsealed blockers break that assumption,
justifying the column. The denormalization lives on `job_blocker` (write-once-flip-once, no
contention) rather than `job` (hot acquisition path, MVCC cost), so the original concern about
counter-on-`job` doesn't apply.

### Adapter contract change

```ts
unblockJobs(params: {
  txCtx;
  blockedByChainId;
  limit: number;          // max dependents released this call
}) → {
  unblockedJobs;
  blockerTraceContexts;   // scoped to the released batch
  hasMore: boolean;       // more unblockable dependents remain
}
```

- PG / SQLite: add `LIMIT` to the unblock selection (including the lock query) and an
  `EXISTS`/count for `hasMore`.
- In-process: slice the candidate iteration to `limit`, set `hasMore` from the remainder.
- Conformance: extend `packages/core/src/conformance/state-adapter-cases/unblock-jobs.ts`.

## Shared runtime primitive: library-owned system chains

There is no system/internal job concept today — worker dispatch is purely
`processors[job.typeName]`. This feature introduces one:

- reserved type-name namespace (e.g. `__queuert/...`); guard user job types from the prefix;
- bypass user input codecs (the library owns the schema);
- deduplicate so concurrent triggers for the same chain don't spawn duplicates.

System chains are **regular chains** — they appear in `getChains`/`getJobs` queries, carry the
same observability, and follow the same lifecycle. No query-level filtering or special dispatch
path.

### User-mounted processors

The library exports a job types factory and a processor factory for system jobs. The user passes
both via array merge alongside their own registries:

```ts
import { createBatchedUnblockJobTypes, createBatchedUnblockProcessors } from "@queuert/core";

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes: [createBatchedUnblockJobTypes(), myJobTypes],
});

const worker = await createInProcessWorker({
  client,
  processors: [
    createBatchedUnblockProcessors({ requiredAttemptMiddleware: [loggingMiddleware] }),
    myProcessors,
  ],
});
```

`createBatchedUnblockJobTypes()` returns a validated job types object (via `createJobTypes`),
compatible with both `defineJobTypes` and runtime-validated registries.

`createBatchedUnblockProcessors({ requiredAttemptMiddleware? })` returns a processors object
with the user's middleware applied — logging, tracing, etc. wrap the system handler naturally.

The user controls which workers process system jobs, consistent with the horizontal-scaling
model where each worker explicitly declares which job types it handles.

If no worker registers the system processor, continuation chains pile up unprocessed. The
library should emit a loud runtime warning (or error) when `finishJob` schedules a continuation
for a type no active worker has registered.

The same pattern is reused by other library-provided processors (e.g. built-in cleanup).

---

## Feature 1: Batched unblock (fan-out)

`unblockJobs` releases at most a batch (e.g. 100) of dependents per call and reports whether
more remain. When more remain, `finishJob` schedules a system chain carrying
`blockedByChainId`; its handler re-invokes the batched unblock and re-continues until drained.

Self-terminating and idempotent: a batch releasing fewer than the limit means the currently
unblockable set is drained. Dependents still blocked by _other_ incomplete chains are left
alone — they unblock when their own last blocker completes. The system chain uses the completed
chain's id as its own `chain_id`-based dedup key so concurrent triggers don't fan out duplicate
continuations.

### Flow

```
chain completes
  → finishJob
    → unblockJobs({ blockedByChainId, limit: 100 })
    → notify + observability for each released job (≤ 100)
    → if hasMore: schedule system chain { blockedByChainId }
        → system chain's job runs (own transaction)
          → unblockJobs({ blockedByChainId, limit: 100 })
          → notify + observability per released job (≤ 100)
          → if hasMore: continueWith same system job type
          → else: done
```

Each batch runs as a separate system chain job in its own transaction, so lock scope, event
buffering, and trace context returns are all naturally bounded to ~100 per batch.

---

## Feature 2: Unsealed blockers (fan-in)

`unsealedBlockers: true` — a boolean flag on the job type definition, like `entry`. When set,
`blockers` must be a homogeneous array `T[]` (not a tuple), and the job is created _without_
blockers; they are attached incrementally via `client.addJobBlockers` and finalized with
`client.sealJobBlockers`.

### Type definition

```ts
defineJobTypes<{
  producer: {
    entry: true;
    input: { item: number };
    output: { value: number };
  };
  aggregate: {
    entry: true;
    input: { label: string };
    output: { sum: number };
    blockers: { typeName: "producer" }[]; // homogeneous array required
    unsealedBlockers: true; // flag, like `entry`
  };
}>();
```

Static constraint: `unsealedBlockers: true` requires `blockers` to be a homogeneous array
`T[]`. Tuples (`[A, B]`) stay exclusively sealed-at-creation and are rejected when
`unsealedBlockers` is set.

### Schema

```sql
ALTER TABLE job ADD COLUMN unsealed_blockers boolean NOT NULL DEFAULT false;
```

### Lifecycle (client-side)

```ts
// 1. Create the collector — born unsealed, therefore blocked.
//    Passing `blockers` here is a compile error for an unsealed type.
const collector = await client.createChain({
  sql: txSql,
  transactionHooks,
  typeName: "aggregate",
  input: { label: "report" },
});

// 2. Attach blockers incrementally — N calls, across transactions.
await client.addJobBlockers({
  sql: txSql,
  jobId: collector.id,
  blockers: [producerChain1, producerChain2],
});

// 3. Seal — finalize; the job may now be unblocked.
await client.sealJobBlockers({ sql: txSql, jobId: collector.id });
```

- `createChain` for an unsealed type: rejects `blockers` (compile error), creates the job with
  `unsealed_blockers = true`, `blocked = true`.
- `addJobBlockers`: validates `unsealed_blockers = true` on the target, inserts `job_blocker`
  rows with `blocked` set based on the blocker chain's `completed_at`. No `job.blocked` flip —
  the job is already blocked by being unsealed.
- `sealJobBlockers`: sets `unsealed_blockers = false`, locks the job, then checks
  `NOT EXISTS (SELECT 1 FROM job_blocker WHERE job_id = $1 AND blocked = true)`.
  If no blocked rows → `job.blocked = false`. If blocked rows remain → stays blocked; the
  normal unblock path clears it when the remaining blockers complete.

**Fan-in pattern — each producer registers itself at completion**, sharing the completion
transaction so the attached chain is guaranteed `completed` at the moment of attachment:

```ts
await sql.begin(async (txSql) => {
  // ...complete the producer...
  await client.addJobBlockers({
    sql: txSql,
    jobId: collectorJobId,
    blockers: [producerChain],
  });
});
```

Because the producer's `completed_at` is set in the same transaction, `addJobBlockers` inserts
the `job_blocker` row with `blocked = false` — the blocker is already resolved at attachment
time.

`addJobBlockers` and `sealJobBlockers` are client methods taking a `txCtx`/`sql` like the other
write methods — no handler-level plumbing.

### Handler — `getBlockers` vs `listBlockers`

The eagerly preloaded `job.blockers` is **removed** from the attempt handler and replaced by
explicit, mutually exclusive accessors:

| type def                             | handler gets                       | shape                                             |
| ------------------------------------ | ---------------------------------- | ------------------------------------------------- |
| no `blockers`                        | neither                            | —                                                 |
| `blockers`, no `unsealedBlockers`    | `getBlockers()`                    | typed tuple or `T[]`, bounded, one fetch          |
| `blockers: T[]` + `unsealedBlockers` | `listBlockers({ cursor?, limit })` | paginated `{ items: Completed<T>[], nextCursor }` |

```ts
// Sealed — bounded, single fetch.
"perform-action": {
  attemptHandler: async ({ job, getBlockers, complete }) => {
    const [user, config] = await getBlockers();
    return complete(async () => ({ result: user.output.role }));
  },
}

// Unsealed — streamed, unbounded.
"aggregate": {
  attemptHandler: async ({ job, execute, listBlockers, complete }) => {
    let total = 0;
    let count = 0;
    for await (const b of listBlockers()) {   // Completed<producer>, paged
      total += b.output.value;
      count++;

      // Checkpoint via execute — each call opens a fresh guarded transaction
      if (count % 1000 === 0) {
        await execute(async ({ sql }) => {
          await sql`UPDATE aggregation_state SET total = ${total}, count = ${count} WHERE job_id = ${job.id}`;
        });
      }
    }
    return complete(async () => ({ sum: total }));
  },
}
```

`getBlockers()` keeps the current behavior under the hood (single `getJobBlockers` query, all
rows, bounded by `MAX_BLOCKERS_PER_JOB`) — just moved from an implicit `job.blockers` preload
to an explicit call.

`listBlockers()` is a cursor paginator over `job_blocker WHERE job_id = $1 ORDER BY index`
(the PK supports it), usable as an async iterator with an explicit
`listBlockers({ cursor, limit }) → { items, nextCursor }` escape hatch. Every item is
guaranteed `completed` (the job only runs once sealed and all blockers resolved). Awaiting
`listBlockers()` is async processing-phase work, so the attempt auto-promotes to staged mode
and extends the attempt while paging. Page size is an internal tuning knob, not user-facing.

Long-running aggregations can use `execute` to checkpoint intermediate state — each call opens
a fresh guarded transaction with attempt verification, so the handler never holds a single
long-lived transaction across the entire blocker set.

---

## Tests

### Batched unblock (fan-out)

- N (> batch) jobs blocked by one chain → completing it releases all N across multiple
  system-chain continuations.
- A dependent with a second incomplete blocker stays blocked until that one also completes.
- Concurrent completion paths don't double-release (dedupe).

### Unsealed blockers (fan-in)

- N (> page size) producers attach + seal → collector fires once after the last completes,
  `listBlockers()` yields all N, reduction is correct.
- Seal-before-complete and complete-before-seal both converge to a single fire.
- Unsealed job with all attached blockers complete stays blocked until sealed.
- A retried producer contributes exactly one `job_blocker` row.
- `addJobBlockers` against a sealed (or non-unsealed) job is a typed error.
- `job_blocker.blocked` correctly set to `false` when blocker chain is already completed at
  attachment time.

### Shared

- Sealed blockers: `unblockJobs` flips `job_blocker.blocked` and uses the same `NOT EXISTS`
  predicate (unified path).
- Conformance for `addJobBlockers` / `sealJobBlockers` / the unblock predicate change /
  `job_blocker.blocked` column across all three adapters.
- Suites: `blocker-chains.test-suite.ts` + conformance unblock cases.

## Changeset

Minor across core + the three adapter packages (schema column on both `job` and `job_blocker`,
adapter ops, handler API addition; `job.blockers` preload removal is the breaking part — bump
accordingly). Docs in `docs/src/content/docs/guides/job-blockers.md` + an example.

## Relationship to existing TODO items

Supersedes the "uncap job blockers" sketches (Triage item on lifting the 100 cap; Long-term
"Uncap job blockers" idea). Those proposed `job_blocker` denormalization / row-deletion to lift
the _sealed_ cap; this instead keeps the sealed cap and adds a separate unsealed lifecycle for
the homogeneous unbounded case.
