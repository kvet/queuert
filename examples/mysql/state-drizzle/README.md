# MySQL state adapter (Drizzle ORM)

MySQL state storage via `@queuert/mysql` with Drizzle ORM over a mysql2 pool — job creation and completion inside application transactions.

Every transaction the provider opens runs at READ COMMITTED, where Queuert keeps its own work; the transactions you pass to Queuert can run at any level, and the example opens them at the server's default, REPEATABLE READ. The provider runs Queuert's SQL on the connection Drizzle's transaction checked out of the pool.

## Running

```bash
pnpm install
pnpm --filter example-mysql-state-drizzle start
```

Requires Docker (uses testcontainers to start MySQL).
