# MySQL State Adapter (Kysely)

MySQL state storage via `@queuert/mysql` with Kysely's `MysqlDialect` over a mysql2 pool — job creation and completion inside application transactions.

The provider opens its transactions at the session default level; the example opens the transactions it passes to Queuert with `db.transaction().setIsolationLevel("read committed")`. Kysely sends every statement with mysql2's text protocol, so the provider prepares none server-side.

## Running

```bash
pnpm install
pnpm --filter example-mysql-state-kysely start
```

Requires Docker (uses testcontainers to start MySQL).
