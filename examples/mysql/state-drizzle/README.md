# MySQL State Adapter (Drizzle ORM)

MySQL state storage via `@queuert/mysql` with Drizzle ORM over a mysql2 pool — job creation and completion inside application transactions.

Every transaction the provider opens runs at READ COMMITTED, the only isolation level Queuert supports, so open the transactions you pass to Queuert with `db.transaction(..., { isolationLevel: "read committed" })` as the example does. The provider runs Queuert's SQL on the connection Drizzle's transaction checked out of the pool.

## Running

```bash
pnpm install
pnpm --filter example-mysql-state-drizzle start
```

Requires Docker (uses testcontainers to start MySQL).
