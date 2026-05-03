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

**SqliteStateProvider** — you implement this to bridge your SQLite client (`node:sqlite`, `bun:sqlite`, `better-sqlite3`, ORMs, etc.). Note the extra `columnTypes` parameter compared to `PgStateProvider`:

```typescript
type SqliteStateProvider<TTxContext> = {
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  withSavepoint?: <T>(txCtx: TTxContext, fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  executeSql: (options: {
    txCtx?: TTxContext;
    id?: string; // Stable cache key for `db.prepare(sql)` handles; unique per resolved SQL (omitted for one-off SQL)
    sql: string;
    params: unknown[];
    paramTypes: Record<number, RuntimeType>; // Positional param runtime types
    columnTypes: Record<string, RuntimeType>; // Non-empty when the query returns rows
    readOnly: boolean; // true for pure SELECTs (no FOR UPDATE)
  }) => Promise<unknown[]>;
  close?: () => Promise<void>; // Optional. Pass-through providers can omit it; when defined, must be idempotent.
};
```

The adapter pre-serializes non-primitive values, so the built-in `better-sqlite3` and `node:sqlite` providers ignore `paramTypes`. It exists for custom providers backed by drivers that need explicit type hints (e.g. remote SQLite bridges).

## RuntimeType

Runtime tag describing each parameter or column type. Providers use it to drive serialization (for parameters) and parsing (for columns). Optional variants (`string?`, `uuid?`, etc.) accept `null`:

```typescript
type RuntimeType =
  | "string"
  | "number"
  | "boolean"
  | "uuid"
  | "json"
  | "array"
  | "jsonArray"
  | "string?"
  | "number?"
  | "boolean?"
  | "uuid?"
  | "json?"
  | "date?";
```

## createAsyncRwLock / AsyncRwLock / LockHandle

Re-exported from `queuert/internal`. SQLite requires serialized write access but permits concurrent reads. If your application performs writes outside of Queuert (e.g., in your state provider), use `createAsyncRwLock` to coordinate access so that your writes and Queuert's writes don't conflict:

```typescript
import { createAsyncRwLock } from "@queuert/sqlite";

const lock = createAsyncRwLock();

// Exclusive (writer) — blocks readers and other writers
{
  using _h = await lock.acquireWrite();
  // Serialized write access
}

// Shared (reader) — concurrent with other readers, blocks writers
{
  using _h = await lock.acquireRead();
  // Concurrent read access
}
```

Handles implement `Symbol.dispose`, so `using` releases at scope exit. You can also call `handle.release()` manually. Release is idempotent.

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
