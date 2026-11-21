# MySQL State Adapter (Knex)

MySQL state storage via `@queuert/mysql` with Knex over the mysql2 driver — job creation and completion inside application transactions.

The provider opens its transactions with Knex's `isolationLevel: "read committed"`, where Queuert keeps its own work, and derives `getTransaction` from Knex's own transaction flag and `txHooks.isOpen`; the example opens its own transactions at the server's default, REPEATABLE READ. It also runs the application's own migrations (`src/migrations.ts`) with `createMysqlMigrator`, through Knex's schema and query builders.

## Running

```bash
pnpm install
pnpm --filter example-mysql-state-knex start
```

Requires Docker (uses testcontainers to start MySQL).
