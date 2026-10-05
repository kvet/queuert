# Batched Processors

Opt-in batched processing for in-process workers: an attempt handler that receives N jobs of one type and calls `finish` once per batch, in the user's own transaction ([user-owned-transactions.md](user-owned-transactions.md)). Non-batched processors are unchanged.

## Problem

| State adapter | Process atomic (jobs/s) | Process staged (jobs/s) |
| ------------- | ----------------------: | ----------------------: |
| In-process    |                  20,145 |                  13,997 |
| PostgreSQL    |                     843 |                     634 |

Per-job processing costs ~4–6 round-trips per job. On PG that is the whole story: batched _start_ already does ~14k jobs/s while full per-job processing does ~600/s — a 23× gap that is round-trip cost, not work. (Measured with the former atomic/staged processing modes, which user-owned transactions removed; the per-job round-trip count is of the same order under the new model: autocommit acquire, heartbeat, the user's `finish` transaction, the post-handler fenced reschedule probe.) Users also cannot batch their own side of the work (bulk API calls, bulk queries) because the handler only ever sees one job.

## API

```typescript
createProcessors({
  client,
  jobTypes,
  processors: {
    "send-email": {
      batchLimit: 50,
      attemptHandler: async ({ signal, jobs, finish }) => {
        const recipients = await db.query("SELECT id, email FROM users WHERE id = ANY($1)", [
          jobs.map((j) => j.input.userId),
        ]);
        const results = await emailService.sendBatch(
          jobs.map((j, i) => ({ to: recipients[i].email, body: j.input.body })),
        );
        return withTransactionHooks(async (transactionHooks) =>
          db.transaction(async (tx) =>
            finish({
              tx,
              transactionHooks,
              outcomes: results.map((r) =>
                r.ok
                  ? { output: { messageId: r.id } }
                  : r.throttled
                    ? { reschedule: { afterMs: 60_000 } }
                    : { fail: r.error },
              ),
            }),
          ),
        );
      },
    },
  },
});
```

- `batchLimit` is the only opt-in. Absent or `1` = today's behavior.
- With `batchLimit > 1` the handler receives `jobs: RunningJob[]` instead of `job: RunningJob` — length `1..batchLimit`, all one `typeName`. Blockers are not preloaded; `getBlockers()` returns them per job, aligned with `jobs` (one `getJobBlockers` query for the batch).
- `finish` is per batch, not per job, and is called in the user's transaction like the single-job `finish` (txCtx and `transactionHooks` required). `signal` is one signal for the batch.
- `finish` takes `outcomes` aligned with `jobs` (each one of `output` / `continueWith` / `reschedule` / `fail`) and returns results aligned the same way. The handler returns what `finish` returned.
- `{ fail: error }` exists only in batched handlers.
- Middleware unifies on always-array `jobs` (length 1 for non-batched). Breaking, small surface.

## Reasoning

**Opportunistic, never buffered.** We take up to `batchLimit` jobs that are already available; if one is available we run it alone. Waiting to accumulate would trade latency for throughput, and the throughput is already there.

**One type per batch.** A batch shares a handler, so it must share a type. The adapter picks the type with the oldest pending job and fills up to that type's limit — one statement, no cross-type fairness logic in the worker.

**The batch is the unit.** One attempt, one `finish` in one user transaction, one abort. Every job's write is fenced on its own `attempt = N AND attempt_by = workerId`; if any fence misses, `finish` throws, the user's transaction rolls back with nothing written, the whole batch aborts, and the post-handler fenced reschedule returns the survivors (attempt expiry and reclaim are the backstop after a crash). Per-job fates inside a shared transaction would need per-job rollback, which buys little and costs a lot.

**`fail` is a value, not a throw.** A throw fails all N — that is the all-or-nothing signal. Failing a subset therefore has to be data, so per-job errors ride in the same outcome array as successes and land in the same write.

**No processing modes.** Earlier drafts let `prepare({ mode })` pick atomic or staged per batch; both modes are gone. Every batch acquires with autocommit, sets the lease for each job at acquire, heartbeats every job until the handler ends, and does its work outside any queuert-owned transaction.

**User writes share the batch's fate.** Writes the handler makes in the transaction it passes to `finish` commit or roll back with the whole batch's outcomes. Writes in other transactions the handler opens are not ownership-fenced and must be idempotent.

**Single-job is batched-of-1.** Internally there is one path. That keeps the two shapes from drifting and makes the array vocabulary the same at `batchLimit` 1 and 50.

## Open questions

1. **Handler signature switching on `batchLimit`.** Proposed above. The alternative — always-array `jobs` — punishes the 99% non-batched case syntactically.

2. **Batch return typing.** `finish(outcomes[])` returns an array of a union, so mixed batches make the caller narrow per slot. Whether a mapped-tuple overload is worth the type complexity for literal call sites is undecided.

3. **Group reclamation.** Every attempt now has a lease set at acquire and renewed by the heartbeat, but expired-attempt reclamation picks one job at a time, while a batch shares a fate. Candidates: a batch ID written at acquire time, releasing by `(attemptBy, attemptUntil)`, or a batch join table. Until this is decided, batched processing has weaker recovery guarantees than per-job.

4. **OTel.** Direction is the standard messaging-batch convention: a batch span parenting per-job spans, producer contexts attached as links rather than parents, per-job errors on per-job spans with a failed count on the batch. Not finalized.
