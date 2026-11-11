# SQLite State Adapter (MikroORM)

SQLite state storage via `@queuert/sqlite` with MikroORM — job creation and completion inside `em.transactional`, with commit and rollback callbacks taken from MikroORM's transaction events, so calls take `{ em }` alone and no `txHooks`. MikroORM's SQLite driver runs on one better-sqlite3 connection through Kysely, which holds it for the whole transaction, so writers are serialized without an external lock.

Queuert's tables share the database with the entities, so `schemaGenerator.skipTables` keeps MikroORM's schema diff (`schema:update`, generated migrations) from dropping them; Queuert migrates them itself with `migrateToLatest()`.

## Running

```bash
pnpm install
pnpm --filter example-state-sqlite-mikro-orm start
```
