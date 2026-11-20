# MySQL State Adapter (Bun.SQL)

MySQL state storage via `@queuert/mysql` using Bun's built-in [`SQL`](https://bun.com/docs/runtime/sql) client — job creation and completion inside application transactions, no external MySQL dependencies.

MySQL's `START TRANSACTION` takes no isolation level, so `sql.begin` opens transactions at the server's default, REPEATABLE READ. The provider's `withTransaction` reserves a connection, sets READ COMMITTED for its next transaction and begins it there, so Queuert's own work stays at READ COMMITTED; the transactions you pass to Queuert can run at any level. MySQL 8.4+ authenticates with `caching_sha2_password`, so a connection without TLS needs `allowPublicKeyRetrieval: true`.

## Running

```bash
pnpm install
pnpm --filter example-mysql-state-bun-sql start
```

Requires [Bun](https://bun.com) and Docker (uses testcontainers to start MySQL).
