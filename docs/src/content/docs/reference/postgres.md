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
  schema?: string,                 // PostgreSQL schema name (default: "queuert")
  tablePrefix?: string,            // Table name prefix (default: "")
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
  runInTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  executeSql: (options: {
    txCtx?: TTxContext;
    sql: string;
    params?: unknown[];
  }) => Promise<unknown[]>;
};
```

## createPgNotifyAdapter

```typescript
const notifyAdapter = await createPgNotifyAdapter({
  provider: PgNotifyProvider,     // You implement this
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
};
```

## pgLiteral

:::caution
This API is experimental and may change without notice.
:::

**pgLiteral** — SQL literal escaping. Use when ORMs require raw SQL strings (e.g., Prisma's `$queryRawUnsafe`, Drizzle's `sql.raw()`):

```typescript
function pgLiteral(value: unknown): string;
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
