# State gauges

Direction only — not implementable yet. Expose the live state of the job table as OTel gauges from one periodic snapshot.

## Problem

The `ObservabilityAdapter` only emits events, so it sees transitions and misses state: how much work is in flight, how long ready jobs have waited, how many jobs are failing and chains overdue. Today the answer is `listChains` / `listJobs` or the database, neither of which can be alerted on.

## Direction

- **Gauges, by type:** incomplete jobs and chains by `status` (chains by their tail job's `status`), age of the oldest due pending job, failing jobs and chains, overdue chains, and the age of the oldest failing job and overdue chain.
- **Failing and overdue come from `design/failing-and-overdue.md`**, which this depends on. The gauges use the same predicates as the client filters and read thresholds from the type config there, not from their own.
- **One snapshot, two consumers.** A single state adapter call (`getStateSnapshot()` or similar) returns all aggregates in one round-trip; OTel `ObservableGauge` callbacks and the dashboard read from it. Scrape cadence and query cadence stay decoupled.
- **Opt-in package**, so `@queuert/core` keeps no OTel dependency and nothing runs until wired in.
- **Indexes:** queries stay on the running working set and reuse the failing and overdue partial indexes. Depends on cleanup running.

## History

The previous design, `design/state-snapshot-metrics.md`, was deleted in `2647ad91`; read it with `git show 2647ad91^:design/state-snapshot-metrics.md` (and `git show 9ea7353b:design/state-snapshot-metrics.md` for the version with stuck gauges). Its gauge set, queries and snapshot-distribution analysis are the starting point, but it was written against a derived-status job model; the `job` table has a stored `status` again, so the queries need rewriting.

## Open questions

1. **Who scans.** One runner (recurring job with chain identity) storing the snapshot for every process to read, or each process scanning on its own (N× load, no shared state). The old design leaned toward a stored snapshot for fleets above one worker.
2. **Package shape** — follows from 1.
3. **Dashboard source.** Read the same snapshot, or query live (it already queries live for lists).
4. **Retry distribution** — a bucketed `consecutive_failures` gauge next to the failing count.
