# MySQL State Adapter (Drizzle ORM)

MySQL state storage via `@queuert/mysql` with Drizzle ORM over a mysql2 pool — job creation and completion inside application transactions.

The provider opens its transactions at the session default level; the example opens the transactions it passes to Queuert with `db.transaction(..., { isolationLevel: "read committed" })`. The provider runs Queuert's SQL on the connection Drizzle's transaction checked out of the pool.

## Running

```bash
pnpm install
pnpm --filter example-mysql-state-drizzle start
```

Requires Docker (uses testcontainers to start MySQL).
