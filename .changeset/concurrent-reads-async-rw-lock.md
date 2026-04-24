---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

Concurrent reads via `AsyncRwLock`.

Replace the single-writer `AsyncLock` with a read-write lock across the core in-process adapter and the SQLite adapters so pure-`SELECT` queries run concurrently while writers stay serialized. SQLite still allows only one writer at a time, but readers no longer queue behind each other or behind unrelated writers.

### Removed / replaced APIs

| Before                                                         | After                                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `createAsyncLock` (from `queuert/internal`, `@queuert/sqlite`) | `createAsyncRwLock`                                                                             |
| `AsyncLock` type                                               | `AsyncRwLock` type                                                                              |
| `lock.acquire()` + `lock.release()`                            | `lock.acquireRead()` / `lock.acquireWrite()` returning a `LockHandle` (`Disposable`-compatible) |

`LockHandle` is a new exported type. It implements `Symbol.dispose`, so the idiomatic usage is `using h = await lock.acquireWrite();` — release happens automatically at scope exit. Manual `h.release()` is also supported and is idempotent.

### `SqliteStateProvider.executeSql` — signature change

```ts
executeSql: (options: {
  txCtx?: TTxContext;
  sql: string;
  params: unknown[]; // was: params?: unknown[]
  paramTypes: Record<number, RuntimeType>; // new — required
  columnTypes: Record<string, RuntimeType>;
  readOnly: boolean; // new — required
}) => Promise<unknown[]>;
```

- `params` is now required (no longer optional).
- `paramTypes` annotates each positional parameter's runtime type. The built-in adapter pre-serializes non-primitive values to strings before they reach the provider, so the standard `better-sqlite3` and `node:sqlite` providers can ignore it. It exists for custom providers backed by drivers that need explicit type hints (e.g. remote SQLite bridges).
- `readOnly` is `true` for pure `SELECT` statements (no `FOR UPDATE`). Custom providers must use it to choose between `acquireRead()` and `acquireWrite()` on their lock, or to route to a reader connection pool. **Wiring `executeSql` to an exclusive lock for every call will silently disable concurrent reads.**

### `PgStateProvider.executeSql` — signature change

```ts
executeSql: (options: {
  txCtx?: TTxContext;
  sql: string;
  params: unknown[]; // was: params?: unknown[]
  paramTypes: Record<number, RuntimeType>;
  columnTypes: Record<string, RuntimeType>;
  readOnly: boolean; // new — required
}) => Promise<unknown[]>;
```

- `params` is now required.
- `readOnly` is supplied for parity and for custom providers that want to route reads to a replica or a separate reader pool. The built-in `pg` (pool) and `postgres-js` providers ignore it.

### Migration

If you only use the bundled providers (`createBetterSqlite3Provider`, `createNodeSqliteProvider`, the built-in `pg`/`postgres-js` providers), you do not need to do anything beyond bumping the package version — the bundled providers were updated for you.

If you implemented a **custom `SqliteStateProvider`**:

1. Replace `createAsyncLock()` with `createAsyncRwLock()` and switch `acquire`/`release` to `acquireWrite()`/`acquireRead()`. Prefer the `using` form for automatic release. Example (before / after):

   ```ts
   // Before
   const lock = createAsyncLock();
   executeSql: async ({ txCtx, sql, params, columnTypes }) => {
     await lock.acquire();
     try {
       return run();
     } finally {
       lock.release();
     }
   };

   // After
   const lock = createAsyncRwLock();
   executeSql: async ({ txCtx, sql, params, columnTypes, readOnly }) => {
     using _h = readOnly ? await lock.acquireRead() : await lock.acquireWrite();
     return run();
   };
   ```

2. Treat `params` as a non-optional array (it is now always provided, possibly empty).
3. Accept the new `paramTypes` and `readOnly` fields. Ignore `paramTypes` unless your driver needs explicit per-parameter type hints; you must consult `readOnly` to opt into concurrent reads.
4. `withTransaction` should always take an exclusive write lock (`acquireWrite()`); SQLite supports only one writer.

If you implemented a **custom `PgStateProvider`**: treat `params` as required and accept the new `readOnly` field (you may ignore it unless you are routing to a read replica).

There is no runtime fallback — TypeScript will flag every wrong call site at compile time.
