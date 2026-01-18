# Short term

- ioredis example
- single queries for migrations to simplify prisma example; if needed, migration can use runInTransaction directly
- ObservabilityAdapter: tracing spans
- Separate queuert client and worker. The worker should accept a queuert client instance to allow job definition reuse. The change is pure cosmetic but would clarify the separation of concerns.

# Medium term

- Polish providers:
  - Prepare more examples like SQLite with kysely, drizzle, prisma; redis with ioredis, node-redis
- MonogoDB ready:
  - MongoDB: Use native ObjectId instead of app-side UUID generation
  - MongoDB: Move collection configuration from provider to adapter - Provider should only handle context/transactions, collection name is an adapter concern (like schema/tablePrefix in PostgreSQL/SQLite)
  - Different mongo client libraries - e.g. Mongoose
  - Prisma MongoDB support - via generic StateProvider interface
- Sqlite ready:
  - Better concurrency handling - WAL mode, busy timeout, retries
  - Different sqlite client libraries - e.g. better-sqlite3
  - Prisma SQLite support - via generic StateProvider interface

# Long term

- Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing
- Singletons/concurrency limit
- Partitioning (PG) - Scaling concern; defer until users hit limits
- MySQL/MariaDB adapter - Popular databases; defer until users request
