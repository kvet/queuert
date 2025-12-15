# Short term

# Long term

- Better StateJobSequence definition
- Make some job types internal only (like can be called only from other jobs, not enqueued directly, add `internal` flag to job type definition)
- Make sure (sent a warning) that a job handler is resolved after lease expiry
- Finalize job externally (Cancellation)
- Termination (add deletedAt to jobs, worker skips those)
- Custom ids + schema name
- Redis NotifyAdapter
- Metrics collection (Prometheus, OTEL)
- Publish to NPM
- Zod job type definitions

# Maybe

- Sandboxed execution (worker threads)
- Hard timeout support
- Partitioning
- Singletons/concurrency limit
