# Worker liveness — the lease belongs to the worker, not the job

> **Status**: design. Breaking (`major`) for `@queuert/core` and the two SQL state adapters.
> Independent of [job-model-v3.md](job-model-v3.md) — it can ship before, after, or with it.

A running attempt is protected by `job.attempt_until`, extended every 30 s per running job. That
column asserts one fact — _the process holding this attempt is still alive_ — and asserts it once per
job. Liveness is a property of the **worker process**, so it should be one row per worker, heartbeated
once per worker, and the job row should stop being written to mid-attempt at all.

## Problem

### The lease is asserted at the wrong granularity, and the code already knows it

The reclaimer passes the worker's own in-flight job ids to the database on every poll:

```ts
stateAdapter.reclaimExpiredJobAttempt({
  txCtx,
  typeNames,
  ignoredJobIds: Array.from(jobIdsInProgress), // in-process-worker.ts
});
```

…which lands in the reclaim query as `AND id != ALL($2::uuid[])`. That parameter exists to express
"these attempts belong to a process that is alive — I am that process." It is the right idea at the
wrong layer: it is a client-supplied, unbounded id array, re-sent every poll, evaluated as a residual
filter inside the `LATERAL`, and it only protects a worker from reclaiming **its own** jobs. Any
_other_ worker still decides the same question from `attempt_until` alone.

The attempt guards agree. Every mutation verifies ownership with `attempt_by`, never with
`attempt_until`:

```sql
UPDATE … SET attempt_until = … WHERE id = $1 AND attempt_by = $2   -- extendJobAttempt
UPDATE … SET attempt_at = NULL, …  WHERE id = $1 AND attempt_by = $5 -- attempt failure
```

Across the whole PostgreSQL adapter, `attempt_until` is **read by exactly one query**:
`reclaimExpiredJobAttempt`. Everything else writes it or projects it. One consumer, asking one
question — "is the owner still there?" — that is not a question about a job.

Per-job leases can also _disagree_. Two attempts on the same process can reach different verdicts
about whether that process is alive. At most one of those verdicts is correct.

### `attempt_until` is not a timeout

The name and the config field (`timeoutMs`, "how long a worker holds a job before it can be
reclaimed") suggest a hard deadline. It is not one. Expiry does not stop the handler — nothing in
JavaScript can, which is exactly why "hard timeout via worker threads and `terminate()`" is an open
idea in [TODO.md](../TODO.md). A promise cannot be cancelled from the outside.

So when a lease expires while the process is alive and the handler is still running, the system does
not terminate anything. It authorizes a **second, concurrent execution** of work that never stopped.
The mechanism marketed as a safety timeout is, in the live-worker case, purely a duplication source.

### The write cost is proportional to concurrency × duration

Detailed in [job-model-v3.md](job-model-v3.md) §6: `attempt_until` is a key column of
`job_running_idx`, so every heartbeat is a non-HOT update on the largest table in the database, and a
non-HOT update rewrites an entry in every index the new version qualifies for — the primary key and
`job_idx (created_at)` included, neither of which mentions the changed column. At 10k concurrent
attempts and a 30 s heartbeat that is ~333 dead tuples per second on the 1B-row table, produced by a
system that may be creating no jobs at all.

### Graceful shutdown pins jobs for a full timeout

A worker that stops cleanly leaves its in-flight attempts stamped with a future `attempt_until`.
Nobody may touch them until it elapses, even though the process announced its exit. Rolling deploys
pay this on every instance.

## Solution: one lease row per worker

```
worker (
  id            {{id_type}}  PRIMARY KEY,   -- fresh per process run
  started_at    timestamptz  NOT NULL,
  heartbeat_at  timestamptz  NOT NULL,
  stopping_at   timestamptz  NULL           -- set on graceful shutdown
)
```

`job` **drops `attempt_until`** and keeps `attempt_by`, which is already the worker id and already the
guard column on every attempt mutation. An attempt is expired if and only if its worker's lease is
expired:

```sql
-- who is gone
SELECT id FROM worker WHERE heartbeat_at < now() - $ttl OR stopping_at IS NOT NULL;

-- release what they held
UPDATE job SET attempt_at = NULL, attempt_by = NULL
WHERE attempt_by = $dead AND attempt_at IS NOT NULL AND completed_at IS NULL
LIMIT $batch;
```

The heartbeat becomes `UPDATE worker SET heartbeat_at = now() WHERE id = $1` — one row per process per
tick, on a table of tens to hundreds of rows that is permanently in cache.

### Why this is the right granularity

The lease answers "is the holder alive?". That is one fact per process. Storing it per job stores the
same fact _n_ times, updates all _n_ copies on a fixed cadence, and lets the copies contradict each
other. Storing it once per process removes the redundancy, the contradiction, and the write
amplification in a single move — and it is the same rule [job-model-v3.md](job-model-v3.md) §3 applies
to chain facts: a fact lives on the row of the entity it is about.

`ignoredJobIds` disappears entirely. A live worker is not in the dead set, so its jobs are never
candidates; there is nothing to exclude and no array to ship.

### The job row stops being written mid-attempt

This is the structural payoff. The job row's write history becomes exactly:

| event  | writes                                             |
| ------ | -------------------------------------------------- |
| create | insert                                             |
| claim  | `attempt_at`, `attempt_by`, `attempt` — one update |
| finish | `completed_at`, `output` — one update              |

No writes proportional to how long the attempt runs. `job_running_idx` becomes
`(type_name, attempt_at)` — indexing a **write-once** column, so it is built at claim and untouched
until the attempt ends, instead of being rewritten every 30 s. That also makes it the honest sort for
"running jobs": `attempt_at ASC` is longest-running-first, which is what an operator is looking for,
whereas `attempt_until` sorts by lease expiry — an artifact of the heartbeat, not of the work.
[minimize-listing-surface.md](minimize-listing-surface.md) picks `attemptUntil` as the running sort
and should switch to `attemptAt`.

Reclaim needs `job_worker_idx (attempt_by) WHERE attempt_at IS NOT NULL AND completed_at IS NULL` —
a partial index over running jobs only, so a few thousand entries. It replaces the reclaim scan's use
of `job_running_idx`.

### Timeouts become worker-local, which is what they always were

`timeoutMs` stops being a database-observed deadline and becomes the worker's own watchdog: when an
attempt exceeds it, the worker aborts it through the existing `AbortController` — the same signal
`worker_stopping` already uses — and then **explicitly releases** the job through the normal failure
path. Not by letting a lease lapse; by writing the release.

This is strictly more honest than today. A deadline enforced by the process that owns the work can
actually act on it (abort the handler, record an error, release the row), and the release is immediate
rather than TTL-delayed. A deadline enforced by a lease can only authorize a duplicate. Nothing is
lost that was real, and the remaining gap — a handler that ignores its abort signal — is the same gap
that exists today, still awaiting worker-thread isolation.

The same mechanism covers a live worker that simply wants to give a job back: it releases it, rather
than waiting out a lease it is actively renewing.

### Losing the lease is now a single, global signal

If a worker cannot reach the database, its lease expires and its jobs are reclaimed while it is still
running them. That double-execution window exists today and this design does **not** close it — but it
makes the worker's side of it tractable. Today the worker learns per job, on whichever heartbeat
happens to fail. With one lease it has one fact to watch: "I have not renewed in T." Crossing a safety
margin strictly shorter than the reclaim TTL, it aborts **every** attempt at once and stops
acquiring — standard fencing, one timer, one decision, instead of _n_ independent ones racing.

### Shutdown becomes instant

`stopping_at` (or deleting the row) makes every attempt the worker held immediately reclaimable. A
rolling deploy hands work over as fast as another worker polls, rather than after a timeout per
instance.

### A worker registry falls out

The table is a live inventory of workers: when each started, when it was last seen, whether it is
draining. That is the natural home for the worker-level gauges
[state-snapshot-metrics.md](state-snapshot-metrics.md) wants, and it makes "which workers are alive
and what are they holding" a two-table query for the dashboard. Not a justification on its own —
worth noting, since the row has to exist regardless.

## Costs and risks

- **A fourth table**, plus its migration. `attempt_until` must be dropped from `job` and
  `job_running_idx` rebuilt, while old workers are still writing the column. The cut is ordered:
  ship the worker table and dual-write leases → switch reclaim to worker-driven → drop the column.
- **Reclaim crosses type boundaries.** A dead worker's jobs span whatever types it processed, so the
  reclaiming worker touches types it does not itself handle. Fine operationally — it must still emit
  `notifyJobScheduled` per reclaimed type — but it removes the current type-scoping and needs a
  `LIMIT` plus a loop so one dead worker holding 10k attempts is not one 10k-row transaction.
- **`attemptUntil` leaves `StateJob`.** It is on the public `Job` entity and in the dashboard. It
  either disappears or becomes derived (`worker.heartbeat_at + ttl`) via a join, which is a read cost
  on a path that currently reads one row. Deriving it is the compatible choice; dropping it is the
  honest one, since the value was never a promise about the job.
- **Worker ids must not be reused across process runs.** Already true —
  `workerId = randomUUID()` per instance ([in-process-worker.ts:379](../packages/core/src/in-process-worker.ts#L379)).
  It becomes load-bearing: a restarted process reusing an id would revive the lease on its
  predecessor's orphaned attempts, which would then never be reclaimed. Worth an explicit assertion
  in the conformance suite rather than an implicit property.
- **Lease TTL is now a global knob**, not a per-attempt one. Nothing today varies `timeoutMs` per
  job type in a way that matters to reclaim, but the axis is gone; per-job deadlines survive only as
  the worker-local watchdog.
- **Clock.** Unchanged — `now()` is the database's, and both the heartbeat and the expiry test are
  evaluated there. Worker clocks stay uninvolved.
- **A worker with a wedged event loop** still fails to heartbeat and still gets its jobs reclaimed
  while it holds them. No better than today, no worse — and one heartbeat has a better chance of
  getting through than _n_.

## Interaction with other designs

| design                                                     | interaction                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [job-model-v3.md](job-model-v3.md)                         | Independent. Removes v3 §6's largest write-path concern and retires its `job_lease` open question — a per-job lease table was the smaller version of this idea. `job_running_idx` changes key column under either. |
| [minimize-listing-surface.md](minimize-listing-surface.md) | Its running-jobs sort must become `attemptAt`; `job_running_idx` becomes `(type_name, attempt_at)`.                                                                                                                |
| [state-snapshot-metrics.md](state-snapshot-metrics.md)     | Gains a real source for worker-level gauges instead of inferring workers from `attempt_by` on job rows.                                                                                                            |
| [attempt-abort-events.md](attempt-abort-events.md)         | The worker-local watchdog is a new abort reason, and losing the lease becomes one global abort rather than _n_ `taken_by_another_worker` discoveries. Should be classified there.                                  |
| TODO "hard timeout (worker threads)"                       | Complementary, and clarified by this: worker threads are the only thing that can make a timeout _hard_. This design stops pretending the lease already does.                                                       |

## Open questions

- **Delete the worker row on shutdown, or keep it as a tombstone?** Deleting is simplest and makes
  reclaim's dead-set query trivial. Keeping it with `stopping_at` preserves a short operational
  history and distinguishes "exited cleanly" from "vanished" — which is the more useful signal when
  diagnosing why work was reclaimed. Retention for the table then needs an answer.
- **Who reclaims, and how eagerly?** Today every worker polls for one expired attempt when it has an
  idle slot. Dead-worker-driven reclaim is naturally batched, which argues for a dedicated pass rather
  than an opportunistic one inside the acquisition loop — but a dedicated pass is a scheduler, and the
  library currently has none.
- **Should `attempt_by` gain a foreign key to `worker`?** It must not cascade: completed jobs record
  the worker that ran them long after that worker is gone, and `completed_by` has the same property.
  Probably no constraint at all, with `worker` treated as a liveness registry rather than a dimension
  table — but that should be stated rather than defaulted into.
- **Does the notify adapter get a liveness role?** `listenJobAttemptLost` already exists, and a
  presence-capable adapter (NATS, Redis) could detect a dead worker faster than any TTL. Keeping the
  database as the sole source of truth is the safer default; whether the notify layer may _accelerate_
  the verdict is a separate question, and answering "yes" reintroduces two clocks.

## Tests

- A worker's attempts survive indefinitely while it heartbeats, with no per-job writes — assert via
  the adapter spy that no `job` update occurs between claim and finish.
- Killing a worker (no further heartbeats) makes every attempt it held reclaimable after the TTL, and
  reclaim releases them in bounded batches.
- Graceful stop makes attempts reclaimable immediately, without waiting out the TTL.
- A worker never reclaims its own attempts, with no `ignoredJobIds` parameter in existence.
- Exceeding the worker-local watchdog aborts the handler and explicitly releases the job; the release
  is visible before the lease would have expired.
- A worker that cannot renew its lease aborts all of its attempts before the reclaim TTL elapses.
- Reclaim spans types the reclaiming worker does not process, and notifies per reclaimed type.
- Two workers cannot hold the same job: `attempt_by` guards still reject the loser.
- Conformance asserts a fresh worker id per process run.
