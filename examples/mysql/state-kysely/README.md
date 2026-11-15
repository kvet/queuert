# MySQL State Adapter (Kysely)

MySQL state storage via `@queuert/mysql` with Kysely's `MysqlDialect` over a mysql2 pool — job creation and completion inside application transactions.

Every transaction the provider opens runs at READ COMMITTED, the only isolation level Queuert supports, so open the transactions you pass to Queuert with `db.transaction().setIsolationLevel("read committed")` as the example does. Kysely sends every statement with mysql2's text protocol, so the provider prepares none server-side.

## Running

```bash
pnpm install
pnpm --filter example-mysql-state-kysely start
```

Requires Docker (uses testcontainers to start MySQL).
