# Short term

- MongoDB: Use native ObjectId instead of app-side UUID generation
- MongoDB: Move collection configuration from provider to adapter - Provider should only handle context/transactions, collection name is an adapter concern (like schema/tablePrefix in PostgreSQL/SQLite)

# Medium term

- Add sequenceTypeName to Job type (Phase 2) - Type-safe generic TSequenceTypeName on Job entity
- Metrics collection & OTEL
- Refactor `jobTypeDefinitions` parameter - Currently required but only used for type inference; integrate with optional Zod schema to provide actual runtime value (input/output validation)
- Restore generic return types on `StateProvider.provideContext` and `NotifyProvider.provideContext` - Currently uses `unknown`, should use `<T>` for type-safe return values without casting

# Long term

- Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing

# ???

- Separate queuert client and worker. The worker should accept a queuert client instance to allow job definition reuse. The change is pure cosmetic but would clarify the separation of concerns.
- Support more job id types (integers)
- Zod job type definitions - TypeScript types already strong at compile-time; runtime validation is user's concern at system boundaries
- Singletons/concurrency limit - Achievable in userland via blocker-based semaphore pattern; document the pattern instead
- Partitioning - Scaling concern; defer until users hit limits
- Add donations link - Premature until adoption; revisit later
