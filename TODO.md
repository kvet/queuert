# Short term

- Rework logging to "commit" only once transaction is successful
- Ensure that worker uses optimal number of state provider operations
- Reevaluate test lease times (currently 10ms) - balance between fast tests and avoiding timing-related flakiness
- ObservabilityAdapter: tracing spans
- test against multiple versions of node on CI
- add migration table to skip already applied migrations
  - it should have a name, applied_at
  - each migration set should have a unique name starting from YYYYMMDDHHMMSS_name (e.g. 20240612120000_add_users_table)
  - when running migrations, check if the migration set was already applied, if so skip it
- extract state and notify adapter test suites to efficiently test multiple configurations (prefixes etc)
- rename createQueuertClient to createClient and createQueuertInProcessWorker to createInProcessWorker. review all other names for similar verbosity
- add a proper example/test with multiple workers sharing the same database

# Medium term

- MySQL/MariaDB adapter - Popular databases; defer until users request
- MonogoDB ready:
  - MongoDB: Add migration version tracking (store applied migrations in metadata collection, run incremental index changes)
  - MongoDB: Use native ObjectId instead of app-side UUID generation
  - MongoDB: Move collection configuration from provider to adapter - Provider should only handle context/transactions, collection name is an adapter concern (like schema/tablePrefix in PostgreSQL/SQLite)
  - Prisma MongoDB support - via generic StateProvider interface
  - withTransaction can retry on transient transaction errors
  - run with standalone + replica set mode on testcontainers
  - support notifications (change streams) for job activation with MongoDB
- PostgreSQL: Support `tablePrefix` configuration option for table names
- Sqlite ready:
  - Better concurrency handling - WAL mode, busy timeout, retries
  - Separate read/write connection pools (single writer, multiple readers)
  - get rid of skipConcurrencyTests flag in resilience tests
  - usage of db without pool is incorrect
- Revisit Prisma examples
- test against bun and it's built-in sqlite, postgres clients

# Long term

- Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing
- Singletons/concurrency limit
- Partitioning (PG) - Scaling concern; defer until users hit limits
