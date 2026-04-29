# Batched Processors

Opt-in batched processing for in-process workers: a new attempt handler shape that receives N jobs of one type and runs one prepare/complete per batch. Sits alongside the per-job processor — non-batched processors are unchanged.

## Motivation

| State adapter | Process atomic (jobs/s) | Process staged (jobs/s) |
| ------------- | ----------------------: | ----------------------: |
| In-process    |                  20,145 |                  13,997 |
| PostgreSQL    |                     843 |                     634 |

Per-job processing does ~4–6 round-trips. The 23× gap on PG between batched-start (~14k/s) and atomic processing (~600/s) is round-trip cost. A batched code path collapses N jobs of adapter ops into a constant number of statements, and unlocks user-side batching (bulk external API calls).

**Batching is opportunistic, not buffered.** When jobs are available we process up to `batchLimit` of them together; when only one is available we process it alone. We never wait to accumulate.

## API

```typescript
createProcessors({
  client,
  jobTypes,
  processors: {
    "send-email": {
      batchLimit: 50,
      attemptHandler: async ({ signal, jobs, prepare, complete }) => {
        const recipients = await prepare({ mode: "staged" }, async ({ db }) =>
          db.query("SELECT id, email FROM users WHERE id = ANY($1)", [
            jobs.map((j) => j.input.userId),
          ]),
        );
        const results = await emailService.sendBatch(
          jobs.map((j, i) => ({ to: recipients[i].email, body: j.input.body })),
        );
        return complete(/* see Open Questions: complete shape */);
      },
    },
  },
});
```

- `batchLimit` opt-in; absent or `1` = current per-job behavior. The handler signature changes when `batchLimit > 1`: `job: RunningJob` becomes `jobs: RunningJob[]` (length `1..batchLimit`, all of one `typeName`, blockers preloaded). Type-system-driven discriminator on the processor config.
- `prepare` decides atomic/staged for the entire batch; optional callback runs once in the prepare tx with full `txCtx`.
- `signal` is a single AbortSignal for the whole batch.
- `complete` callback shape is unresolved — see Open Questions.

## Execution model

```
acquireJobs({ "send-email": 50, "send-sms": 20 })  ── 1 statement, returns N of one type
getJobsBlockers(jobIds)                            ── 1 statement
prepareTx open
  user prepare callback (savepoint)
prepareTx commit (or kept open if atomic)

[staged] renewJobLeases + listenJobOwnershipLost × N + leaseManager.start()

user work (sendBatch, etc.)

completeTx open (or reuse prepareTx if atomic)
  getJobsForUpdate(jobIds)
  user complete callback
  for each job: SAVEPOINT
    ok    → finishJob (completeJobs, unblockJobs bulk, [createJobs for continueWith])
    error → handleJobHandlerError (rescheduleJobs)
  RELEASE / ROLLBACK TO
completeTx commit
```

Per-job savepoints inside `completeTx` give per-slot rollback. Bulk finishJob ops keep the per-job loop at constant statements regardless of N.

## Decisions

**Same-type with per-type limits.** `acquireJobs({ limitsByTypeName })` takes `{ "send-email": 50, "send-sms": 20 }` (built from each batched processor's `batchLimit`). Adapter picks a `typeName` (oldest pending wins) and returns up to that type's limit. All returned jobs share one `typeName`. PG single-round-trip:

```sql
WITH limits AS (SELECT * FROM unnest($1::text[], $2::int[]) AS t(type_name, lim)),
chosen AS (
  SELECT j.type_name FROM job j JOIN limits l USING (type_name)
  WHERE j.status = 'pending' AND j.scheduled_at <= now()
  ORDER BY j.scheduled_at ASC LIMIT 1
)
SELECT j.* FROM job j
WHERE j.type_name = (SELECT type_name FROM chosen)
  AND j.status = 'pending' AND j.scheduled_at <= now()
ORDER BY j.scheduled_at ASC
LIMIT (SELECT lim FROM limits WHERE type_name = (SELECT type_name FROM chosen))
FOR UPDATE SKIP LOCKED
```

**Atomic vs staged.** One mode for the whole batch via `prepare({ mode })`. Mixing is not supported — use a non-batched processor.

**Prepare writes.** `txCtx` is exposed. Reads are the common case. Writes are allowed but shared across the batch (committed/rolled back with `prepareTx`). PG has no per-savepoint read-only mode, so DB-level enforcement isn't possible — contract only.

**Group semantics — batch is the unit.** Lease, complete, and reap apply to the batch as a whole, not per job:

- One `leaseManager` per batch calling `renewJobLeases({ jobIds, … })`.
- One commit decision (`completeTx` succeeds or fails together).
- If `getJobsForUpdate` finds any job in a bad state mid-batch (already-completed / taken-by-another), abort the whole batch — the surviving jobs go back via lease expiry.
- Reaping must reclaim batched jobs as a group. **Open** — see Open Questions.

**Errors.**

- Per-job application error → savepoint runs `handleJobHandlerError` for that slot only; rest of batch commits.
- Handler throws → all N jobs go through `handleJobHandlerError` in a fresh tx, each in its own savepoint.
- Adapter throws (commit failure) → leases expire, reaper recovers.

## OTel

**Open** — needs review. Sketch below, but the design is not finalized.

Standard messaging-batch convention is span **links** for producer contexts, parent-child for batch internals.

```
batch attempt span                    parent: none
  links: [traceContext_1 .. _N]
  attrs: messaging.batch.message_count, queuert.job.type_name
  ├── per-job span_i                  parent: batch span
  │     link: chainTraceContext_i
  ├── prepare span / complete span    parent: batch span
```

- One span has one parent; producer contexts attach as N links.
- Per-job child spans give per-job durations and error attribution.
- `chainTraceContext` is a per-job link, not on the batch span.
- `continueWith` for job `i` reads trace context from `perJobSpanHandle[i]`.
- Per-job error → per-job span ERROR; batch span stays OK with `queuert.batch.failed_count`.

Adapter additions (sketch):

```typescript
startBatchAttemptSpan(data: {
  workerId; jobTypeName; jobIds; attemptCounts; jobTraceContexts;
}): BatchAttemptSpanHandle | undefined;
// startPerJobSpan / startPrepare / startComplete / end on the handle.
```

`@queuert/otel`: extract producer contexts via `propagation.extract`, pass as `links` to `tracer.startSpan`; per-job spans created under `trace.setSpan(ctx, batchSpan)`.

## Adapter contract

The bulk methods replace their singular counterparts — the contract is array-only, not "array alongside singular." Singular usage becomes an array of length 1.

```typescript
acquireJobs(params: { txCtx?; limitsByTypeName: Record<string, number> })
  → { jobs: StateJob[]; hasMore: boolean }
getJobsBlockers(params: { txCtx?; jobIds })
  → Map<TJobId, [StateJob, StateJob | undefined][]>
renewJobLeases(params: { txCtx?; jobIds; workerId; leaseDurationMs }) → StateJob[]
getJobsForUpdate(params: { txCtx?; jobIds }) → StateJob[]
completeJobs(params: { txCtx?; items: { jobId; output }[]; workerId }) → StateJob[]
rescheduleJobs(params: { txCtx?; items: { jobId; schedule; error }[] }) → StateJob[]
unblockJobsByChainIds(params: { txCtx?; blockedByChainIds })
  → { unblockedJobs; blockerTraceContexts }
reapExpiredJobLeases(params: …) → …  // see Open Questions: group reap
```

Removed: `acquireJob`, `getJobBlockers`, `renewJobLease`, `getJobById`, `completeJob`, `rescheduleJob`, `unblockJobs`, `reapExpiredJobLease`. `createJobs` and `addJobsBlockers` are already array-shaped.

PG: `... = ANY($1)` rewrites + `LIMIT N`. SQLite: `IN (?, ...)`. In-process: trivial loops.

## Worker

- At construction, partition processors into batched (`batchLimit > 1`) and non-batched.
- Build `limitsByTypeName` from batched processors' `batchLimit`. Non-batched processors contribute their typeNames with limit `1`.
- For each free slot: `acquireJobs({ limitsByTypeName })` → dispatch to `runJobBatch` if `batchLimit > 1`, else the single-job path.
- "Single-job" is just batched-of-1 internally — same code path with `jobs.length === 1`.

## Middleware

Unify on always-array `jobs`. The existing `wrapHandler` / `wrapPrepare` / `wrapComplete` change shape:

```typescript
wrapHandler?: <T>(opts: {
  jobs: RunningJob[];   // length 1 for non-batched processors
  workerId: string;
  next: (ctx: THandlerCtx) => Promise<T>;
}) => Promise<T>;
```

`wrapPrepare` / `wrapComplete` get the same treatment. Middleware authors handle one shape and rely on `jobs.length === 1` for the common case. Breaking change but small surface; bundles into the same release.

## Open questions

1. **Should the handler signature change with `batchLimit`?** Proposed yes (above), but the alternative is always-array `jobs` regardless. Cost of always-array: punishes the 99% non-batched case syntactically.

2. **`complete` callback shape & `continueWith`.** This is the crux. Today `continueWith` is a _method_ — it constructs a job (creates DB rows in `createJobs`), so it has to be invoked at the right point inside the tx. Symmetric extension to batches isn't obvious. Three angles:
   - **Imperative per-slot.** `complete(async ({ continueWith }) => { for each job: await continueWith(...) or set output })`. Preserves today's call-site shape exactly. User does the iteration. Awkward to express "ok / error / continued" in a uniform return.
   - **Declarative discriminated union.** User returns `BatchResult[]` like `[{ status: "ok", output }, { status: "continueWith", typeName, input, blockers }, { status: "error", error }]` and the worker invokes `continueWith` internally. Pros: symmetric with the other result kinds, fully declarative. Cons: gives up the imperative pattern; the user can't observe the constructed `Job` mid-callback. Also asymmetric with the current single-job processor (which returns a `Job` from `continueWith`).
   - **Hybrid.** `continueWith` stays a callback-provided method that returns `Promise<Job>`, but the user assembles a `BatchResult[]` themselves: `{ status: "ok", output }` or `{ status: "ok", continued: <Job from continueWith> }` or `{ status: "error", error }`. Both worlds; verbose.

   The discriminated-union sketch in earlier drafts came from option (2). Pick before implementation. Symmetry with the single-job processor matters — whatever shape we pick should map cleanly to `batchLimit: 1`.

3. **Group reaping.** Reaping currently picks one expired job at a time. For batched jobs, the entire batch shares a fate (lease, completion, abort). The reaper needs to reclaim them as a group. Possible approaches: a batch ID on each job written at acquire time; reaping by `(leasedBy, leasedUntil)` tuple; a `batch` join table. None decided. Until this is solved, batched processing has weaker recovery guarantees than per-job.

4. **OTel.** Whole section needs review.

## Implementation order

1. Migrate state-adapter contract to array-only. Update conformance suite.
2. PG adapter SQL.
3. SQLite adapter SQL.
4. Resolve open questions (2), (3), (4).
5. `runJobBatch` in `worker/`. Reuses `lease.ts`, savepoint/transaction context. Unify single-job path on top of it.
6. Wire `batchLimit` through `processors.ts` and `in-process-worker.ts`.
7. Migrate middleware to always-array shape.
8. Batched OTel adapter changes.
9. Tests: per-job error mixing, prepare-write semantics, lease renewal, ownership-lost mid-batch, abort propagation, atomic & staged, `continueWith` inside batches, group reap.
10. Benchmark: extend `processing-capacity` with a batched mode; verify PG atomic moves from ~600/s into the thousands.
11. Docs.
