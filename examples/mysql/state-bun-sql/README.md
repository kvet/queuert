# MySQL State Adapter (Bun.SQL)

MySQL state storage via `@queuert/mysql` using Bun's built-in [`SQL`](https://bun.com/docs/runtime/sql) client — job creation and completion inside application transactions, no external MySQL dependencies.

The provider's `withTransaction` sets no isolation level, so its transactions run at the server's default, REPEATABLE READ. MySQL 8.4+ authenticates with `caching_sha2_password`, so a connection without TLS needs `allowPublicKeyRetrieval: true`.

## Running

```bash
pnpm install
pnpm --filter example-mysql-state-bun-sql start
```

Requires [Bun](https://bun.com) and Docker (uses testcontainers to start MySQL).
