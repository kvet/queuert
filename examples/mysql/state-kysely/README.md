# MySQL State Adapter (Kysely)

MySQL state storage via `@queuert/mysql` with Kysely's `MysqlDialect` over a mysql2 pool — job creation and completion inside application transactions.

Every transaction the provider opens runs at READ COMMITTED, where Queuert keeps its own work; the transactions you pass to Queuert can run at any level, and the example opens them at the server's default, REPEATABLE READ. Kysely sends every statement with mysql2's text protocol, so the provider prepares none server-side.

## Running

```bash
pnpm install
pnpm --filter example-mysql-state-kysely start
```

Requires Docker (uses testcontainers to start MySQL).
