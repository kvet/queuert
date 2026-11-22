# Failing and overdue

Mark jobs that keep failing and chains that run past their expected duration, and expose both on the client, the dashboard and observability events.

## Problem

`consecutive_failures` is stored and shown in the dashboard, but nothing says when it is too high, nothing can filter on it, and nothing alerts. A chain that never fails but never completes (long-poll reschedules, blocked on another chain, waiting in a backlog) has no signal at all.

## Signals

- **Failing** (job): `consecutive_failures` reached a threshold. Set only on the error path of an attempt, in the same `rescheduleJobs` statement that increments the counter; cleared whenever the counter resets. A chain is failing when its tail job is.
- **Overdue** (chain): not completed past `created_at + expectedDuration`. Nothing writes at the deadline, so it is derived at read time from a deadline stored at creation.

## Schema

- `job.failing_since` timestamp, null when not failing. Same row and statement as `consecutive_failures`, no extra write.
- `job.chain_expected_by` timestamp on the chain head, written by `createChain`, null without config.
- Partial indexes for the two filters over the running working set.

No chain-level failing column: it would add a chain head write and lock to every failing attempt.

## API

- Config: a failure threshold per job type and an `expectedDuration` per chain type. Both optional; nothing is flagged without them.
- `Job.failingSince`, `Chain.expectedBy`.
- `listJobs({ failing })`, `listChains({ failing, overdue })`, failing and overdue counts on `countJobsByTypeName` / `countChainsByTypeName`.
- `jobFailing` observability event when an attempt crosses the threshold, as a `queuert.job.failing` counter in `@queuert/otel`.

## Dashboard

Failing and overdue badges on job and chain rows, filters on the lists, counts on the type overview.

## Open questions

1. **Where config lives.** The threshold is needed by the worker (like `backoffConfig`, on processors); `expectedDuration` is needed by `createChain` (client side, the job types registry carries no runtime config today).
2. **Client reschedule.** It resets `consecutive_failures` today, so "retry now" clears failing. Keep or not.
3. **Deadline stored or computed.** A stored `chain_expected_by` ignores later config changes; computing from config at read time follows them but needs a per-type predicate.
4. **Names.** `failing` / `overdue` go into the domain vocabulary in `code-style.md`.
