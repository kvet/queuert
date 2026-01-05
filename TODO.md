# Medium term

- Notify adapter resiliency
- Optional notify adapter
- Soft timeout - Signal via AbortSignal + stop lease renewal; cooperative but covers most cases
- Metrics collection (Prometheus, OTEL)

# Long term

- MongoDB state adapter - Extends "use your existing database" promise; ACID transactions supported since MongoDB 4.0
- Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing

# ???

- Postgres notify adapter - LISTEN/NOTIFY not reliable enough for production use; requires periodic polling to guarantee delivery
- Support more job id types (integers)
- Zod job type definitions - TypeScript types already strong at compile-time; runtime validation is user's concern at system boundaries
- Singletons/concurrency limit - Achievable in userland via blocker-based semaphore pattern; document the pattern instead
- Partitioning - Scaling concern; defer until users hit limits
- Add donations link - Premature until adoption; revisit later
