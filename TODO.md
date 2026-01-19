# Short term

- ObservabilityAdapter: tracing spans
- test against multiple versions of node on CI
- add migration table to skip already applied migrations
  - it should have a name, applied_at
  - each migration set should have a unique name starting from v1.0.0
  - when running migrations, check if the migration set was already applied, if so skip it

# Medium term

- MonogoDB ready:
  - MongoDB: Use native ObjectId instead of app-side UUID generation
  - MongoDB: Move collection configuration from provider to adapter - Provider should only handle context/transactions, collection name is an adapter concern (like schema/tablePrefix in PostgreSQL/SQLite)
  - Different mongo client libraries - e.g. Mongoose
  - Prisma MongoDB support - via generic StateProvider interface
- Sqlite ready:
  - Better concurrency handling - WAL mode, busy timeout, retries
  - Different sqlite client libraries - e.g. better-sqlite3
  - Prisma SQLite support - via generic StateProvider interface
- test against bun and it's built-in sqlite, postgres clients

# Long term

- Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing
- Singletons/concurrency limit
- Partitioning (PG) - Scaling concern; defer until users hit limits
- MySQL/MariaDB adapter - Popular databases; defer until users request
