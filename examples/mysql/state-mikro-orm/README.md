# MySQL State Adapter (MikroORM)

MySQL state storage via `@queuert/mysql` with MikroORM — job creation and completion inside `em.transactional`, with commit and rollback callbacks taken from MikroORM's transaction events, so calls take `{ em }` alone and no `txHooks`.

The provider's `withTransaction` opens every transaction at READ COMMITTED, where Queuert keeps its own work; the transactions you pass to Queuert can run at any level, and the example opens them with `em.transactional` at the server's default, REPEATABLE READ.

Queuert's tables share the database with the entities, so `schemaGenerator.skipTables` keeps MikroORM's schema diff (`schema:update`, generated migrations) from dropping them; Queuert migrates them itself with `migrateToLatest()`.

## Running

```bash
pnpm install
pnpm --filter example-mysql-state-mikro-orm start
```

Requires Docker (uses testcontainers to start MySQL).
