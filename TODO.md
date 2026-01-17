# Short term

- !!! Jobs created during another job's execution should not be linked to the parent job's chain unless it's about continuation !!! - Avoids confusion; only continuation jobs are part of the same chain
- Logs: add metrics for logs (like common attributes inside spans, e.g. winston.log can show context attributes)
- ObservabilityAdapter: Add histograms (job duration, wait time, total time, attempts, poll duration), gauges (active workers, processing jobs), and tracing spans
- Setup `files` field in package.json for public packages to exclude unnecessary files (\*.tsbuildinfo, tests, etc.) from npm packages
- review transitive dep versions for public packages (e.g. pg)

# Medium term

- Polish providers:
  - Prepare more examples like SQLite with kysely, drizzle, prisma; redis with ioredis, node-redis
  - Restore generic return types on `StateProvider.provideContext` and `NotifyProvider.provideContext` - Currently uses `unknown`, should use `<T>` for type-safe return values without casting
- MonogoDB ready:
  - MongoDB: Use native ObjectId instead of app-side UUID generation
  - MongoDB: Move collection configuration from provider to adapter - Provider should only handle context/transactions, collection name is an adapter concern (like schema/tablePrefix in PostgreSQL/SQLite)
  - Different mongo client libraries - e.g. Mongoose
  - Prisma MongoDB support - via generic StateProvider interface

# Long term

- Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing

# ???

- Separate queuert client and worker. The worker should accept a queuert client instance to allow job definition reuse. The change is pure cosmetic but would clarify the separation of concerns.
- Support more job id types (integers)
- Singletons/concurrency limit - Achievable in userland via blocker-based semaphore pattern; document the pattern instead
- Partitioning - Scaling concern; defer until users hit limits
- Add donations link - Premature until adoption; revisit later
