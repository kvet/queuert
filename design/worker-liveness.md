# Worker liveness — the lease belongs to the worker, not the job

> **Status**: design. Breaking (`major`) for `@queuert/core` and the two SQL state adapters.
> Independent of [job-model-v3.md](job-model-v3.md) — it can ship before, after, or with it.

A running attempt is protected by `job.attempt_until`, extended every 30 s per running job. That
column asserts one fact — _the process holding this attempt is still alive_ — and asserts it once per
job. Liveness is a property of the **worker process**.

## Problem

**The granularity is wrong, and the code already knows it.** The reclaimer passes the worker's own
in-flight job ids to the database on every poll (`ignoredJobIds`, landing as `AND id != ALL($2)`).
That parameter exists to say "these attempts belong to a process that is alive — I am that process":
the right idea at the wrong layer. It is a client-supplied unbounded array, re-sent every poll, and it
only protects a worker from reclaiming **its own** jobs — any other worker still decides the same
question from `attempt_until` alone. The attempt guards agree: every mutation verifies ownership with
`attempt_by`, never with `attempt_until`. Across the whole PostgreSQL adapter `attempt_until` is
**read by exactly one query**, `reclaimExpiredJobAttempt`. Per-job leases can also _disagree_ — two
attempts on the same process can reach different verdicts about whether that process is alive, and at
most one of those is correct.

**`attempt_until` is not a timeout.** The name and `timeoutMs` suggest a hard deadline. Expiry does
not stop the handler — nothing in JavaScript can, which is why worker-thread isolation is still an
open idea in [TODO.md](../TODO.md). So when a lease expires while the process is alive and the
handler is still running, the system authorizes a **second, concurrent execution** of work that never
stopped. In the live-worker case the mechanism is purely a duplication source.

**The write cost is proportional to concurrency × duration.** `attempt_until` is a key column of
`job_running_idx`, so every heartbeat is a non-HOT update on the largest table in the database, and a
non-HOT update rewrites an entry in every index the new version qualifies for — the primary key and
`job_idx (created_at)` included, neither of which mentions the changed column. At 10k concurrent
attempts and a 30 s heartbeat that is ~333 dead tuples per second on the 1B-row table, produced by a
system that may be creating no jobs at all.

**Graceful shutdown pins jobs for a full timeout.** A worker that stops cleanly leaves its in-flight
attempts stamped with a future `attempt_until`. Nobody may touch them until it elapses, even though
the process announced its exit. Rolling deploys pay this on every instance.

## API

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
expired, so reclaim becomes dead-worker-driven and batched. The heartbeat becomes one
`UPDATE worker SET heartbeat_at = now() WHERE id = $1` per process per tick, on a table of tens to
hundreds of rows that is permanently in cache. `ignoredJobIds` disappears — a live worker is not in
the dead set, so there is nothing to exclude.

`timeoutMs` becomes the worker's own watchdog: on expiry it aborts through the existing
`AbortController` and **explicitly releases** the job through the normal failure path.

Reclaim needs one new index, `job_worker_idx (attempt_by) WHERE attempt_at IS NOT NULL AND
completed_at IS NULL` — a few thousand entries — replacing the reclaim scan's use of
`job_running_idx`.

## Reasoning

**Why per-worker is the right granularity.** The lease answers "is the holder alive?" — one fact per
process. Storing it per job stores that fact _n_ times, updates all _n_ copies on a fixed cadence, and
lets the copies contradict each other. Storing it once removes the redundancy, the contradiction, and
the write amplification in a single move. It is the same rule [job-model-v3.md](job-model-v3.md) §2
applies to chain facts: a fact lives on the row of the entity it is about.

**The job row stops being written mid-attempt** — the structural payoff. Its write history becomes
insert, one update at claim, one update at finish. Nothing proportional to how long the attempt runs.
`job_running_idx` becomes `(type_name, attempt_at)`, indexing a **write-once** column. That also makes
it the honest sort for "running jobs": `attempt_at ASC` is longest-running-first, which is what an
operator wants, whereas `attempt_until` sorts by lease expiry — an artifact of the heartbeat, not of
the work. [minimize-listing-surface.md](minimize-listing-surface.md) picks `attemptUntil` and should
switch.

**A worker-local timeout is strictly more honest.** A deadline enforced by the process that owns the
work can actually act on it — abort the handler, record the error, release the row — and the release
is immediate rather than TTL-delayed. A deadline enforced by a lease can only authorize a duplicate.
Nothing real is lost; the remaining gap (a handler that ignores its abort signal) is the same gap that
exists today. The same mechanism covers a live worker that simply wants to give a job back.

**Losing the lease becomes one global signal.** If a worker cannot reach the database its jobs are
reclaimed while it is still running them. That window exists today and this does **not** close it —
but today the worker learns per job, on whichever heartbeat happens to fail. With one lease it has one
fact to watch: "I have not renewed in T." Crossing a margin shorter than the reclaim TTL, it aborts
every attempt at once and stops acquiring — standard fencing, one timer, one decision, instead of _n_
racing.

**Shutdown becomes instant.** `stopping_at` makes every attempt the worker held immediately
reclaimable, so a rolling deploy hands work over as fast as another worker polls.

**A worker registry falls out** — a live inventory of who started when, was last seen when, and is
draining. The natural home for [state-snapshot-metrics.md](state-snapshot-metrics.md)'s worker gauges.
Not a justification on its own, since the row has to exist regardless.

## Costs

- **A fourth table** and an ordered migration: ship the worker table and dual-write leases → switch
  reclaim to worker-driven → drop `attempt_until` and rebuild `job_running_idx`.
- **Reclaim crosses type boundaries.** A dead worker's jobs span whatever types it processed, so the
  reclaimer touches types it does not handle — fine operationally (it must still notify per reclaimed
  type), but it removes the current type-scoping and needs a `LIMIT` plus a loop so one dead worker
  holding 10k attempts is not one 10k-row transaction.
- **`attemptUntil` leaves `StateJob`**, and it is on the public `Job` entity and the dashboard.
  Deriving it (`worker.heartbeat_at + ttl`) is the compatible choice; dropping it is the honest one,
  since the value was never a promise about the job.
- **Worker ids must not be reused across process runs.** Already true (`randomUUID()` per instance),
  but it becomes load-bearing: a restarted process reusing an id would revive the lease on its
  predecessor's orphaned attempts, which would then never be reclaimed. Needs an explicit conformance
  assertion rather than an implicit property.
- **Lease TTL becomes a global knob.** Per-job deadlines survive only as the worker-local watchdog.
- **A wedged event loop** still fails to heartbeat and still gets its jobs reclaimed. No better than
  today, no worse — and one heartbeat has a better chance of getting through than _n_.

Unchanged: the clock. `now()` is the database's, and both the heartbeat and the expiry test are
evaluated there.

## Interaction with other designs

| design                                                     | interaction                                                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [job-model-v3.md](job-model-v3.md)                         | Independent. Removes v3's largest write-path concern; `job_running_idx` changes key column under either.                                 |
| [minimize-listing-surface.md](minimize-listing-surface.md) | Its running-jobs sort must become `attemptAt`.                                                                                           |
| [state-snapshot-metrics.md](state-snapshot-metrics.md)     | Gains a real source for worker-level gauges instead of inferring workers from `attempt_by`.                                              |
| [attempt-abort-events.md](attempt-abort-events.md)         | The watchdog is a new abort reason, and losing the lease becomes one global abort rather than _n_ `taken_by_another_worker` discoveries. |
| TODO "hard timeout (worker threads)"                       | Complementary. Worker threads are the only thing that can make a timeout _hard_; this design stops pretending the lease already does.    |

## Open questions

- **Delete the worker row on shutdown, or keep it as a tombstone?** Deleting makes the dead-set query
  trivial. Keeping it with `stopping_at` distinguishes "exited cleanly" from "vanished" — the more
  useful signal when diagnosing why work was reclaimed — but then needs a retention answer.
- **Who reclaims, and how eagerly?** Dead-worker-driven reclaim is naturally batched, which argues for
  a dedicated pass rather than an opportunistic one inside the acquisition loop — but a dedicated pass
  is a scheduler, and the library currently has none.
- **Should `attempt_by` gain a foreign key to `worker`?** It must not cascade: completed jobs record
  the worker that ran them long after that worker is gone. Probably no constraint at all, with
  `worker` treated as a liveness registry rather than a dimension table — but that should be stated
  rather than defaulted into.
- **Does the notify adapter get a liveness role?** A presence-capable adapter (NATS, Redis) could
  detect a dead worker faster than any TTL. Keeping the database as the sole source of truth is the
  safer default; letting notify _accelerate_ the verdict reintroduces two clocks.
