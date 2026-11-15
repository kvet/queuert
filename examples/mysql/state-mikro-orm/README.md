# MySQL State Adapter (MikroORM)

MySQL state storage via `@queuert/mysql` with MikroORM — job creation and completion inside `em.transactional`, with commit and rollback callbacks taken from MikroORM's transaction events, so calls take `{ em }` alone and no `txHooks`.

The provider's `withTransaction` opens every transaction at READ COMMITTED, the only isolation level Queuert supports; open the transactions you pass to Queuert with `em.transactional(fn, { isolationLevel: IsolationLevel.READ_COMMITTED })` too.

Queuert's tables share the database with the entities, so `schemaGenerator.skipTables` keeps MikroORM's schema diff (`schema:update`, generated migrations) from dropping them; Queuert migrates them itself with `migrateToLatest()`.

## Running

```bash
pnpm install
pnpm --filter example-mysql-state-mikro-orm start
```

Requires Docker (uses testcontainers to start MySQL).
