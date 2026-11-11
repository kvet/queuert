# PostgreSQL State Adapter (MikroORM)

PostgreSQL state storage via `@queuert/postgres` with MikroORM — job creation and completion inside `em.transactional`, with commit and rollback callbacks taken from MikroORM's transaction events, so calls take `{ em }` alone and no `txHooks`.

MikroORM fires no rollback event when PostgreSQL answers `COMMIT` with `ROLLBACK` (a failed statement inside the transaction was caught and the callback returned). The provider's own `withTransaction` still runs the rollback callbacks then; a transaction opened with `em.transactional` does not, so let statement errors propagate out of it.

Queuert's tables share the database with the entities, so `schemaGenerator.skipTables` keeps MikroORM's schema diff (`schema:update`, generated migrations) from dropping them; Queuert migrates them itself with `migrateToLatest()`.

## Running

```bash
pnpm install
pnpm --filter example-state-postgres-mikro-orm start
```

Requires Docker (uses testcontainers to start PostgreSQL).
