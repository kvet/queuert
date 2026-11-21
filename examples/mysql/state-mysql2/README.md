# MySQL State Adapter (mysql2)

MySQL state storage via `@queuert/mysql` with the mysql2 driver — job creation and completion inside application transactions.

mysql2 keeps no transaction flag, so the provider's `getTransaction` recognizes only transactions its own `withTransaction` opened: open the transactions you pass to Queuert with it, not with `connection.beginTransaction()`. Every transaction it opens runs at READ COMMITTED, where Queuert keeps its own work.

## Running

```bash
pnpm install
pnpm --filter example-mysql-state-mysql2 start
```

Requires Docker (uses testcontainers to start MySQL).
