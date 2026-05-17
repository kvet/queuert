---
title: "@queuert/postgres"
description: PostgreSQL state and notify adapters.
sidebar:
  order: 5
---

## createPgStateAdapter

```typescript
const stateAdapter = await createPgStateAdapter({
  stateProvider: PgStateProvider,  // You implement this
  schema?: string,                 // PostgreSQL schema name (default: "public")
  tablePrefix?: string,            // Table name prefix (default: "queuert_")
  idType?: string,                 // SQL type for job IDs (default: "uuid")
  generateId?: () => string,      // Generates new IDs in JS (default: () => crypto.randomUUID())
  validateId?: (id: string) => boolean,  // Optional predicate; runs on generated and caller-supplied IDs
});
```

Returns `Promise<PgStateAdapter>`.

## PgStateAdapter

**PgStateAdapter** — `StateAdapter` extended with migration support:

```typescript
type PgStateAdapter = StateAdapter & {
  migrateToLatest: () => Promise<MigrationResult>;
};
```

## PgStateProvider

**PgStateProvider** — you implement this to bridge your PostgreSQL client:

```typescript
type PgStateProvider<TTxContext> = {
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  withSavepoint?: <T>(txCtx: TTxContext, fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  executeSql: (options: {
    txCtx?: TTxContext;
    id?: string; // Stable cache key for prepared statements; unique per resolved SQL (omitted for one-off SQL)
    sql: string;
    params: unknown[];
    paramTypes: Record<number, RuntimeType>; // Positional param runtime types
    columnTypes: Record<string, RuntimeType>; // Column runtime types for result rows
    readOnly: boolean; // true for pure SELECTs (no FOR UPDATE)
  }) => Promise<unknown[]>;
  close?: () => Promise<void>; // Optional. Pass-through providers can omit it; when defined, must be idempotent.
};
```

`withSavepoint` is optional. When not provided, the adapter uses raw `SAVEPOINT` SQL via `executeSql`. Override it when your driver tracks transaction state client-side (e.g. `postgres.js` — use `txCtx.sql.savepoint()`).

`id` is a stable cache key — the adapter folds template variants (e.g. `schema`, `tablePrefix`) into the suffix, so it uniquely identifies the resolved SQL within a provider instance. Providers MAY use it directly as the prepared-statement name (`pg`: `query.name = id`) or as a flag to opt into driver-level caching (`postgres.js`: `prepare: true`). When omitted, the provider must execute the statement unprepared.

`paramTypes` / `columnTypes` are type hints for drivers that don't auto-serialize/parse (e.g. `postgres.js` `unsafe()`). Drivers that handle these natively (e.g. `pg`) can ignore them.

`readOnly` lets providers route to a read replica or a separate reader pool. The built-in pool / `postgres.js` providers ignore it.

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

## createPgNotifyAdapter

```typescript
const notifyAdapter = await createPgNotifyAdapter({
  notifyProvider: PgNotifyProvider, // You implement this
  channelPrefix?: string,         // Channel prefix (default: "queuert")
});
```

Returns `Promise<NotifyAdapter>`.

## PgNotifyProvider

**PgNotifyProvider** — you implement this to bridge your PostgreSQL client:

```typescript
type PgNotifyProvider = {
  publish: (channel: string, message: string) => Promise<void>;
  subscribe: (
    channel: string,
    onMessage: (message: string) => void,
  ) => Promise<() => Promise<void>>;
  close?: () => Promise<void>; // Optional. Pass-through providers can omit it; when defined, must be idempotent.
};
```

## MigrationResult

```typescript
type MigrationResult = {
  applied: string[]; // Migrations applied in this run
  skipped: string[]; // Already-applied migrations
  unrecognized: string[]; // Unknown migrations found in the database
};
```

## See Also

- [State Adapters](/queuert/integrations/state-adapters/) — Integration guide for state adapters
- [Notify Adapters](/queuert/integrations/notify-adapters/) — Integration guide for notify adapters
- [Adapter Architecture](/queuert/advanced/adapters/) — Design philosophy and context management
