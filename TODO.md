# Short term

- Withstand state layer errors in worker
  - Add withRetry utility using existing RetryConfig with maxRetries property
  - Two separate configs: one for top-level worker loop, one for state adapter calls
  - State adapter retries: 3 attempts with 1s, 5s delays. If fails, abandon job (reaper handles)
  - Localize retry in StateProvider.executeSql (or wrap StateAdapter)
  - Filter only real connection problems (network, timeout), NOT DB errors (constraints, etc.)
  - Consider adding timeout to executeSql
  - Top-level worker loop: use exponential backoff (existing RetryConfig) instead of fixed 10x pollInterval
  - What reaper handles (no extra work needed):
    - Lease renewal failures → job picked up later
    - Mid-transaction failures → lease expires, reaper cleans up
    - Zombie jobs (crash after handler but before finalize) → lease expires

# Long term

- Finalize job externally (Cancellation)
- Termination
- Custom ids + schema name
- Redis NotifyAdapter

# Maybe

- Sandboxed execution (worker threads)
- Hard timeout support
- Partitioning
- Singletons/concurrency limit
