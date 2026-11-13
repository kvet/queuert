# MySQL State Adapter (mysql2)

MySQL state storage via `@queuert/mysql` with the mysql2 driver — job creation and completion inside application transactions.

mysql2 keeps no transaction flag, so the provider's `isTransaction` recognizes only transactions its own `withTransaction` opened: open the transactions you pass to Queuert with it, not with `connection.beginTransaction()`. Every transaction it opens runs at READ COMMITTED, the only isolation level Queuert supports.

## Running

```bash
pnpm install
pnpm --filter example-state-mysql-mysql2 start
```

Requires Docker (uses testcontainers to start MySQL).
