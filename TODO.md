# Short term

- [TASK,MEDIUM] Rework telemetry to emit only after transaction commits
  - Problem: spans/logs/metrics emitted inside transactions become misleading if transaction rolls back
  - Affected areas:
    - `startJobChain` / `createStateJob` - span ended and logs emitted before caller's transaction commits
    - `complete()` in job-process.ts - `jobAttemptCompleted` called inside transaction
  - Potential approaches:
    - Buffer pattern (like `withNotifyContext` already does for notifications)
    - Transaction afterCommit hooks (requires state adapter support)
    - Span event pattern: end span for timing, add `transaction.committed` event after commit
  - See: transactional outbox pattern for reliable side effects
- [TASK,COMPLEX] Ensure that worker uses optimal number of state provider operations
- [TASK,MEDIUM] OTEL blocker spans
- [REF] Review metrics against OTEL Messaging Semantic Conventions (https://opentelemetry.io/docs/specs/semconv/messaging/messaging-metrics/)
  - Consider adding standard `messaging.*` metrics alongside domain-specific `queuert.*` metrics
- [TASK,MEDIUM] test against multiple versions of node on CI
- [EPIC] extract state and notify adapter test suites to efficiently test multiple configurations (prefixes etc)
  - [TASK,MEDIUM] support all methods for state adapter test suite
  - [TASK,MEDIUM] notify adapter
- [TASK,MEDIUM] update lease in one operation (currently two: getForUpdate + update)
- [TASK,EASY] Run postgres against multiple versions
- [TASK,EASY] Run redis against multiple versions

# Medium term

- [TASK,COMPLEX] Optimized batched lease renewal
- [EPIC] Dashboard
- [EPIC] Sqlite ready:
  - [REF] Better concurrency handling - WAL mode, busy timeout, retries
  - [REF] Separate read/write connection pools (single writer, multiple readers)
  - [TASK,EASY] get rid of skipConcurrencyTests flag in resilience tests
  - [REF] usage of db without pool is incorrect
  - [TASK,EASY] Run against multiple versions
- [EPIC] MySQL/MariaDB adapter
- [EPIC] MonogoDB ready:
  - [REF] MongoDB: Add migration version tracking (store applied migrations in metadata collection, run incremental index changes)
  - [TASK,COMPLEX] MongoDB: Use native ObjectId instead of app-side UUID generation
  - [REF] MongoDB: Move collection configuration from provider to adapter - Provider should only handle context/transactions, collection name is an adapter concern (like schema/tablePrefix in PostgreSQL/SQLite)
  - [REF] Prisma MongoDB support - via generic StateProvider interface
  - [REF] withTransaction can retry on transient transaction errors
  - [REF] run with standalone + replica set mode on testcontainers
  - [REF] support notifications (change streams) for job activation with MongoDB
  - [TASK,EASY] try to use single operations where possible (findOneAndUpdate, updateMany)
  - [TASK,EASY] Run against multiple versions
- [REF] Revisit Prisma examples
- [TASK,?] test against bun and it's built-in sqlite, postgres clients

# Long term

- [TASK,EASY] Add OpenTelemetry logs support to @queuert/otel adapter (OTEL logs API is experimental)
- [EPIC] Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing
- [EPIC] Singletons/concurrency limit
- [EPIC] Partitioning (PG) - Scaling concern; defer until users hit limits
