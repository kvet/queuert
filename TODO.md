# Medium term

- Add firstJobTypeName to state - Simplifies job type discovery for UIs and monitoring tools
- Metrics collection & OTEL

# Long term

- MongoDB state adapter - Extends "use your existing database" promise; ACID transactions supported since MongoDB 4.0
- Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing

# ???

- Separate queuert client and worker. The worker should accept a queuert client instance to allow job definition reuse. The change is pure cosmetic but would clarify the separation of concerns.
- Support more job id types (integers)
- Zod job type definitions - TypeScript types already strong at compile-time; runtime validation is user's concern at system boundaries
- Singletons/concurrency limit - Achievable in userland via blocker-based semaphore pattern; document the pattern instead
- Partitioning - Scaling concern; defer until users hit limits
- Add donations link - Premature until adoption; revisit later
