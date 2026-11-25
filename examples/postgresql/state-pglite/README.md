# PostgreSQL state adapter (PGlite)

PostgreSQL state storage via `@queuert/postgres` with PGlite, PostgreSQL compiled to WebAssembly running inside the process — job creation and completion inside application transactions, with no PostgreSQL server.

PGlite is a single connection, so its transaction mutex runs transactions one at a time and a query outside a transaction waits for the open one. Transactions cannot nest, so calling `withTransaction` or a statement outside the transaction from inside its callback deadlocks, and the conformance cases that need concurrent claims or a second session (row locks, serialization failures, deadlocks) are skipped.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createPgMigrator`.

## Running

```bash
pnpm install
pnpm --filter example-postgresql-state-pglite start
```
