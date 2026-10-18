# PostgreSQL Notify Adapter (Bun.SQL)

PostgreSQL LISTEN/NOTIFY via `@queuert/postgres` using Bun's built-in [`SQL`](https://bun.com/docs/runtime/sql) client — no external PostgreSQL dependencies.

## Running

```bash
pnpm install
pnpm --filter example-notify-postgres-bun-sql start
```

Requires [Bun](https://bun.com) and Docker (uses testcontainers to start PostgreSQL).
