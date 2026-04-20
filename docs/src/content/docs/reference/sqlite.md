---
title: "@queuert/sqlite"
description: SQLite state adapter.
sidebar:
  order: 6
---

:::caution
This package is experimental and may change without notice.
:::

## createSqliteStateAdapter

```typescript
const stateAdapter = await createSqliteStateAdapter({
  stateProvider: SqliteStateProvider,  // You implement this
  tablePrefix?: string,                // Table name prefix (default: "queuert_")
  idType?: string,                     // SQL type for job IDs (default: "TEXT")
  idGenerator?: () => string,          // ID generator (default: crypto.randomUUID())
  checkForeignKeys?: boolean,          // Enable PRAGMA foreign_keys (default: true)
});
```

Returns `Promise<SqliteStateAdapter>`.

## SqliteStateAdapter

**SqliteStateAdapter** — `StateAdapter` extended with migration support, following the same pattern as `PgStateAdapter`:

```typescript
type SqliteStateAdapter = StateAdapter & {
  migrateToLatest: () => Promise<MigrationResult>;
};
```

## SqliteStateProvider

**SqliteStateProvider** — you implement this to bridge your SQLite client (`node:sqlite`, `better-sqlite3`, ORMs, etc.). Note the extra `columnTypes` parameter compared to `PgStateProvider`:

```typescript
type SqliteStateProvider<TTxContext> = {
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  withSavepoint?: <T>(txCtx: TTxContext, fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  executeSql: (options: {
    txCtx?: TTxContext;
    sql: string;
    params?: unknown[];
    columnTypes: Record<string, RuntimeType>; // Non-empty when the query returns rows
  }) => Promise<unknown[]>;
};
```

## createAsyncLock / AsyncLock

Re-exported from `queuert/internal`. SQLite requires serialized write access. If your application performs writes outside of Queuert (e.g., in your state provider), use `createAsyncLock` to coordinate access so that your writes and Queuert's writes don't conflict:

```typescript
import { createAsyncLock } from "@queuert/sqlite";

const lock = createAsyncLock();

// Use the same lock in your state provider and application code
await lock.acquire();
try {
  // Serialized database access
} finally {
  lock.release();
}
```

## MigrationResult

Same type as `@queuert/postgres`:

```typescript
type MigrationResult = {
  applied: string[]; // Migrations applied in this run
  skipped: string[]; // Already-applied migrations
  unrecognized: string[]; // Unknown migrations found in the database
};
```

## See Also

- [State Adapters](/queuert/integrations/state-adapters/) — Integration guide for state adapters
- [Adapter Architecture](/queuert/advanced/adapters/) — Design philosophy and context management
