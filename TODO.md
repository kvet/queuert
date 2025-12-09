# Short term

# Long term

- Lease and lock: polish the wording to use lease consistently
- Rename `claim` to `prepare` - the current name is misleading since you're not claiming the job (that already happened during acquisition). The function's purpose is to read data in the initial transaction before long-running work begins. `prepare` better conveys this intent. The no-op case `await prepare(() => {})` also reads more naturally as "prepare with nothing to do". Alternative: auto-detect `claim` access via getter - if handler destructures `claim`, wait for it to be called; if not destructured, auto-start lease after handler initialization. This eliminates the no-op case entirely.
- Withstand state layer errors in worker
- Deduplication
- Notify about long transactions
- Finalize job externally (Cancellation)
- Termination
- Custom ids + schema name
- Redis NotifyAdapter

# Maybe

- Sandboxed execution (worker threads)
- Hard timeout support
- Partitioning
- Singletons/concurrency limit
