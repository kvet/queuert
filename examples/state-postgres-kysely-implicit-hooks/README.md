# PostgreSQL State Adapter (Kysely, implicit transaction hooks)

A Kysely state provider in implicit mode: the app's own transaction and savepoint helpers bind `transactionHooks` to each Kysely transaction and savepoint, so `createChain` and `complete` take only the transaction context.

## Running

```bash
pnpm install
pnpm --filter example-state-postgres-kysely-implicit-hooks start
```

Requires Docker (uses testcontainers to start PostgreSQL).
