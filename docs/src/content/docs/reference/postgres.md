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
  idDefault?: string,              // SQL DEFAULT expression (default: "gen_random_uuid()")
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
    id?: string; // Stable cache key for prepared statements (omitted for one-off SQL)
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

`id` is a stable cache key — providers MAY use it to opt the statement into server-side preparation (`postgres.js`: `prepare: true`; `pg`: `name = hash(id+sql)`). When omitted, the provider must execute the statement unprepared.

`paramTypes` / `columnTypes` are type hints for drivers that don't auto-serialize/parse (e.g. `postgres.js` `unsafe()`). Drivers that handle these natively (e.g. `pg`) can ignore them.

`readOnly` lets providers route to a read replica or a separate reader pool. The built-in pool / `postgres.js` providers ignore it.

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
