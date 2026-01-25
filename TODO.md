# Short term

- Rename worker config for less verbosity:
  - `jobTypeRegistry` → `registry`
  - `jobTypeProcessors` → `processors`
  - `process` → `execute`
- Rename deduplication strategy `'completed'` → `'incomplete'` for clarity (describes what to deduplicate against, not when deduplication stops)
- ObservabilityAdapter: tracing spans
- test against multiple versions of node on CI
- add migration table to skip already applied migrations
  - it should have a name, applied_at
  - each migration set should have a unique name starting from YYYYMMDDHHMMSS_name (e.g. 20240612120000_add_users_table)
  - when running migrations, check if the migration set was already applied, if so skip it

# Medium term

- MonogoDB ready:
  - MongoDB: Use native ObjectId instead of app-side UUID generation
  - MongoDB: Move collection configuration from provider to adapter - Provider should only handle context/transactions, collection name is an adapter concern (like schema/tablePrefix in PostgreSQL/SQLite)
  - Different mongo client libraries - e.g. Mongoose
  - Prisma MongoDB support - via generic StateProvider interface
- Sqlite ready:
  - Better concurrency handling - WAL mode, busy timeout, retries
- test against bun and it's built-in sqlite, postgres clients

# Long term

- Revisit Prisma SQLite example - poor fit for raw SQL (BigInt returns, no :memory:, runtime db push)
- Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing
- Singletons/concurrency limit
- Partitioning (PG) - Scaling concern; defer until users hit limits
- MySQL/MariaDB adapter - Popular databases; defer until users request
