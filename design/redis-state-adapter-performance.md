# Redis state adapter: performance and open problems

Where the Redis state adapter stands, what still behaves differently from the SQL adapters, and which optimizations are worth doing next.

## Where it stands

All numbers are from an Apple M1 Pro with Redis in Docker Desktop, measured while other test containers were running, so treat them as rough.

- **Queries** (`benchmarks/query-performance`, scale 30): every case is at or below PostgreSQL except `listChains/running/nonIndependent` (about 14 ms against 9 ms).
- **Processing** (`benchmarks/processing-capacity`, the numbers in `docs/src/data/benchmarks.ts`): about 3.2–3.4k chains/s single, 25–26k batched, and 5.1–6.3k jobs/s completion at concurrency 16 (node-redis and ioredis).
- **Redis CPU per completed job**, at concurrency 16: about 80–115 µs. The suite prints Redis main-thread CPU per job for Redis state runs.

## Where Redis CPU goes

Per completed job there are about 2.25–3 script calls: claim, read (the `fence` in `complete`) and commit.

- A bare round trip (`PING`) costs about 20 µs of Redis main-thread CPU here, while each command inside a script costs about 1 µs. Call overhead is the largest cost, though it is much smaller on a native Linux Redis.
- `cjson` work was a minor cost. Moving the read, validate and commit scripts to positional arguments saved about 10% of Redis CPU per job. Removing JSON from the claim script would save only another 5–7 µs per job.
- The index updates are 7 `ZADD` and 7 `ZREM` per job, about 15% of the total.
- The replay markers that make a resent commit or claim apply once (a `commit:*` key per commit, a `claim:*` key per claim, both kept 60 s) cost about 5–6% of completion throughput at concurrency 16 and 10–13% of Redis CPU per job, from three runs each with and without them. The schema fence adds one `SISMEMBER` to each commit and claim.

How to measure: Redis main-thread CPU (`INFO cpu`) before and after a fixed loop. Avoid `slowlog-log-slower-than 0`, because Redis then logs every command a script runs and inflates script times.

## Current problems

- **Lock waits.** A Redis transaction never waits for another; the one that commits second reruns. 12 conformance cases that expect a lock wait are excluded (`redisStateAdapterLockWaitCaseNames`). Every outcome matches some serial order.
- **Job locks expire.** An exclusive read of a pending job, such as the one `completeChain` takes, takes a lock key for up to 60 s, and claims skip that job until it is released. A `completeChain` handler that runs longer than that can see a worker claim the job.
- **Notify latency.** "notify > handles distributed blocker jobs" takes about 80–88 ms against a 100 ms budget and is flaky under parallel load. The unblock step adds about 15 ms over the chain case. Its round trips have not been counted yet.
- **Claim scan cap.** Claims and `getStartAttemptDelayMs` look past locked jobs through at most the first 1,000 due jobs of a type. When all of those are locked, a worker claims nothing of that type and waits for its next poll, even if unlocked jobs are due further on.
- **`deleteChains` loops per chain.** It reads each chain's dependents and scans each chain's jobs separately, so its round trips grow with the number of chains deleted instead of staying constant.
- **`listChains` with `independent: false`** reads every blocker chain's score in the type's chain index, so its cost grows with the total number of blocker chains, not with the page size.

## Future optimizations

In order of value:

1. **Claim cache.** The claim script returns the job record and its version, and the adapter keeps it in memory. The `fence` read in `complete` then takes it from there instead of Redis. That is one round trip less per job and roughly 20% less Redis CPU. To keep it safe:
   - an entry is used once, and only on a transaction's first try
   - a transaction that read from the cache is always validated, read-only ones included
   - the commit's version check rejects any job that changed after the claim
   - the cache is capped by size, and a missing entry only means one ordinary read
2. **Fewer index updates per completion.** Drop indexes another index can stand in for, checking each against the query benchmark.
3. **Blocker-chain index.** A sorted set of chains referenced as blockers, per type and status, would make `listChains` with `independent: false` scale with the page size. It adds writes when chains are completed or deleted.
4. **Measure on Linux.** Repeat the numbers above on a native Linux Redis, where a round trip is far cheaper, before choosing between 1 and 2.
