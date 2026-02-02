# Short term

- Rework logging to "commit" only once transaction is successful
- Ensure that worker uses optimal number of state provider operations
- Reevaluate test lease times (currently 10ms) - balance between fast tests and avoiding timing-related flakiness
- ObservabilityAdapter: tracing spans
  - Add trace context columns to state adapters (chainTraceContext, jobTraceContext)
  - Extend ObservabilityAdapter interface with tracing methods and types
  - Implement OTEL tracing in @queuert/otel
  - Integrate tracing in core (startJobChain, worker processing, continueWith)
  - Add observability-tracing example
- test against multiple versions of node on CI
- extract state and notify adapter test suites to efficiently test multiple configurations (prefixes etc)
  - support all methods for state adapter test suite
  - notify adapter

# Medium term

- Sqlite ready:
  - Better concurrency handling - WAL mode, busy timeout, retries
  - Separate read/write connection pools (single writer, multiple readers)
  - get rid of skipConcurrencyTests flag in resilience tests
  - usage of db without pool is incorrect
- MySQL/MariaDB adapter - Popular databases; defer until users request
- MonogoDB ready:
  - MongoDB: Add migration version tracking (store applied migrations in metadata collection, run incremental index changes)
  - MongoDB: Use native ObjectId instead of app-side UUID generation
  - MongoDB: Move collection configuration from provider to adapter - Provider should only handle context/transactions, collection name is an adapter concern (like schema/tablePrefix in PostgreSQL/SQLite)
  - Prisma MongoDB support - via generic StateProvider interface
  - withTransaction can retry on transient transaction errors
  - run with standalone + replica set mode on testcontainers
  - support notifications (change streams) for job activation with MongoDB
- Revisit Prisma examples
- test against bun and it's built-in sqlite, postgres clients

# Long term

- Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing
- Singletons/concurrency limit
- Partitioning (PG) - Scaling concern; defer until users hit limits
