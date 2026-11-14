import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import {
  andThen,
  dynamicSyncAsync,
  type MaybePromise,
  syncAsync,
  resource,
  step,
  type Mode,
  type ModeResult,
} from "@queuert/sync-async";
import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  type SavepointConformanceContext,
  type SchemaFenceConformanceContext,
  runInModeOf,
  stateAdapterAsyncGroups,
  stateAdapterBaseGroups,
  stateAdapterSavepointGroups,
  stateAdapterSchemaFenceGroups,
  toConformanceTestCases,
} from "queuert/conformance-internal";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";

/**
 * The context the {@link sqliteStateProviderConformanceCases} run against, over a provider of
 * either mode. Get it from {@link createSqliteStateProviderConformanceContext} and pass it to every
 * case unchanged.
 */
export type SqliteStateProviderConformanceContext = SchemaFenceConformanceContext &
  SavepointConformanceContext & {
    /**
     * Creates a provider under test; disposing it closes it. Each case disposes the providers it
     * creates.
     */
    createStateProvider(): MaybePromise<
      (SqliteStateProvider<any, "sync"> | SqliteStateProvider<any>) & AsyncDisposable
    >;
  };

const MISSING_TABLE = "queuert_conformance_missing";

const executeSql = (
  stateProvider: SqliteStateProvider<any, Mode>,
  sql: string,
  txCtx?: unknown,
): MaybePromise<unknown[]> =>
  stateProvider.executeSql({
    txCtx,
    sql,
    params: [],
    paramTypes: {},
    columnTypes: {},
    readOnly: true,
  });

const captureError = syncAsync(function* (run: () => MaybePromise<unknown>) {
  try {
    yield* step(run());
  } catch (error) {
    return error;
  }
  throw new Error("expected the statement to fail");
});

const classifyErrorGroup: ConformanceGroup<SqliteStateProviderConformanceContext> = {
  name: "classifyError",
  cases: [
    {
      name: "classifies a missing table as undefined_table, naming it",
      run: dynamicSyncAsync(function* (context: SqliteStateProviderConformanceContext) {
        const stateProvider: SqliteStateProvider<any, Mode> = yield* resource(
          context.createStateProvider(),
        );
        const error = yield* captureError.steps(() =>
          executeSql(stateProvider, `SELECT 1 FROM ${MISSING_TABLE}`),
        );
        assert.deepEqual(stateProvider.classifyError({ error }), {
          kind: "undefined_table",
          tableName: MISSING_TABLE,
        });
      }),
    },
    {
      name: "classifies a missing table inside a transaction as undefined_table, naming it",
      run: dynamicSyncAsync(function* (context: SqliteStateProviderConformanceContext) {
        const stateProvider: SqliteStateProvider<any, Mode> = yield* resource(
          context.createStateProvider(),
        );
        let error: unknown;
        yield* step(
          assertRejects(() =>
            stateProvider.withTransaction((txCtx) =>
              runInModeOf(
                stateProvider,
                syncAsync(function* () {
                  error = yield* captureError.steps(() =>
                    executeSql(stateProvider, `SELECT 1 FROM ${MISSING_TABLE}`, txCtx),
                  );
                  throw error;
                }),
              ),
            ),
          ),
        );
        assert.deepEqual(stateProvider.classifyError({ error }), {
          kind: "undefined_table",
          tableName: MISSING_TABLE,
        });
      }),
    },
    {
      name: "returns undefined for an error other than a missing table",
      run: dynamicSyncAsync(function* (context: SqliteStateProviderConformanceContext) {
        const stateProvider: SqliteStateProvider<any, Mode> = yield* resource(
          context.createStateProvider(),
        );
        const error = yield* captureError.steps(() =>
          executeSql(stateProvider, "SELECT missing_column FROM (SELECT 1)"),
        );
        assert.equal(stateProvider.classifyError({ error }), undefined);
      }),
    },
    {
      name: "returns undefined for a value that is not a driver error",
      run: dynamicSyncAsync(function* (context: SqliteStateProviderConformanceContext) {
        const stateProvider: SqliteStateProvider<any, Mode> = yield* resource(
          context.createStateProvider(),
        );
        assert.equal(stateProvider.classifyError({ error: new Error("unrelated") }), undefined);
        assert.equal(stateProvider.classifyError({ error: undefined }), undefined);
      }),
    },
  ],
};

const probeTable = "queuert_provider_probe";

const statement = (sql: string, txCtx?: unknown) => ({
  txCtx,
  sql,
  params: [],
  paramTypes: {},
  columnTypes: {},
  readOnly: false,
});

const syncProviderCase =
  (
    body: (
      stateProvider: SqliteStateProvider<any, "sync">,
      withNonTransactionContext: <T>(fn: (txCtx: any) => T) => T,
    ) => void,
  ) =>
  async (context: SqliteStateProviderConformanceContext): Promise<void> => {
    const stateProvider = await context.createStateProvider();
    try {
      if (stateProvider.sync === true) {
        body(stateProvider, (fn) => context.withNonTransactionContext(fn) as ReturnType<typeof fn>);
      }
    } finally {
      await stateProvider.close?.();
    }
  };

const syncSqliteStateProviderGroup: ConformanceGroup<SqliteStateProviderConformanceContext> = {
  name: "SqliteStateProvider (sync)",
  cases: [
    {
      name: "executeSql returns rows without a promise",
      run: syncProviderCase((stateProvider) => {
        stateProvider.executeSql(
          statement(`CREATE TABLE IF NOT EXISTS ${probeTable} (value INTEGER NOT NULL)`),
        );
        stateProvider.executeSql(statement(`DELETE FROM ${probeTable}`));
        stateProvider.executeSql(statement(`INSERT INTO ${probeTable} (value) VALUES (1)`));
        const rows = stateProvider.executeSql({
          ...statement(`SELECT COUNT(*) AS count FROM ${probeTable}`),
          columnTypes: { count: "number" },
          readOnly: true,
        });
        assert.ok(Array.isArray(rows));
        assert.equal(Number((rows[0] as { count: unknown }).count), 1);
      }),
    },
    {
      name: "withTransaction returns the callback's value and commits its writes",
      run: syncProviderCase((stateProvider) => {
        stateProvider.executeSql(
          statement(`CREATE TABLE IF NOT EXISTS ${probeTable} (value INTEGER NOT NULL)`),
        );
        stateProvider.executeSql(statement(`DELETE FROM ${probeTable}`));
        const result = stateProvider.withTransaction((txCtx) => {
          stateProvider.executeSql(
            statement(`INSERT INTO ${probeTable} (value) VALUES (1)`, txCtx),
          );
          return "committed";
        });
        assert.equal(result, "committed");
        const rows = stateProvider.executeSql({
          ...statement(`SELECT COUNT(*) AS count FROM ${probeTable}`),
          columnTypes: { count: "number" },
          readOnly: true,
        });
        assert.equal(Number((rows[0] as { count: unknown }).count), 1);
      }),
    },
    {
      name: "withTransaction rolls back its writes and rethrows when the callback throws",
      run: syncProviderCase((stateProvider) => {
        stateProvider.executeSql(
          statement(`CREATE TABLE IF NOT EXISTS ${probeTable} (value INTEGER NOT NULL)`),
        );
        stateProvider.executeSql(statement(`DELETE FROM ${probeTable}`));
        assert.throws(
          () =>
            stateProvider.withTransaction((txCtx) => {
              stateProvider.executeSql(
                statement(`INSERT INTO ${probeTable} (value) VALUES (1)`, txCtx),
              );
              throw new Error("callback failed");
            }),
          /callback failed/,
        );
        const rows = stateProvider.executeSql({
          ...statement(`SELECT COUNT(*) AS count FROM ${probeTable}`),
          columnTypes: { count: "number" },
          readOnly: true,
        });
        assert.equal(Number((rows[0] as { count: unknown }).count), 0);
      }),
    },
    {
      name: "withTransaction rolls back and throws when the callback returns a promise",
      run: syncProviderCase((stateProvider) => {
        stateProvider.executeSql(
          statement(`CREATE TABLE IF NOT EXISTS ${probeTable} (value INTEGER NOT NULL)`),
        );
        stateProvider.executeSql(statement(`DELETE FROM ${probeTable}`));
        assert.throws(() =>
          stateProvider.withTransaction((txCtx) => {
            stateProvider.executeSql(
              statement(`INSERT INTO ${probeTable} (value) VALUES (1)`, txCtx),
            );
            return Promise.resolve("async");
          }),
        );
        const rows = stateProvider.executeSql({
          ...statement(`SELECT COUNT(*) AS count FROM ${probeTable}`),
          columnTypes: { count: "number" },
          readOnly: true,
        });
        assert.equal(Number((rows[0] as { count: unknown }).count), 0);
      }),
    },
    {
      name: "isTransaction is true inside withTransaction and false outside it",
      run: syncProviderCase((stateProvider, withNonTransactionContext) => {
        assert.equal(
          stateProvider.withTransaction((txCtx) => stateProvider.isTransaction(txCtx)),
          true,
        );
        assert.equal(
          withNonTransactionContext((txCtx) => stateProvider.isTransaction(txCtx)),
          false,
        );
      }),
    },
    {
      name: "an autocommit statement inside an open transaction throws instead of joining it",
      run: syncProviderCase((stateProvider, withNonTransactionContext) => {
        stateProvider.executeSql(
          statement(`CREATE TABLE IF NOT EXISTS ${probeTable} (value INTEGER NOT NULL)`),
        );
        stateProvider.executeSql(statement(`DELETE FROM ${probeTable}`));
        withNonTransactionContext((txCtx) => {
          stateProvider.executeSql(statement("BEGIN", txCtx));
          try {
            assert.throws(() =>
              stateProvider.executeSql(statement(`INSERT INTO ${probeTable} (value) VALUES (1)`)),
            );
          } finally {
            stateProvider.executeSql(statement("ROLLBACK", txCtx));
          }
        });
        const rows = stateProvider.executeSql({
          ...statement(`SELECT COUNT(*) AS count FROM ${probeTable}`),
          columnTypes: { count: "number" },
          readOnly: true,
        });
        assert.equal(Number((rows[0] as { count: unknown }).count), 0);
      }),
    },
  ],
};

export const sqliteStateAdapterConformanceGroups: ConformanceGroup<SchemaFenceConformanceContext>[] =
  [...stateAdapterBaseGroups, ...stateAdapterSchemaFenceGroups];

export const sqliteStateProviderConformanceGroups: ConformanceGroup<SqliteStateProviderConformanceContext>[] =
  [...sqliteStateAdapterConformanceGroups, ...stateAdapterSavepointGroups, classifyErrorGroup];

export const sqliteSyncStateProviderConformanceGroups: ConformanceGroup<SqliteStateProviderConformanceContext>[] =
  [syncSqliteStateProviderGroup];

const ddl = { params: [], paramTypes: {}, columnTypes: {}, readOnly: false };

/**
 * Options of {@link createSqliteStateProviderConformanceContext}, in the provider's mode.
 *
 * @typeParam TMode - The provider's mode: in the `"sync"` mode the callbacks return their results
 * directly, in the `"async"` mode they return promises
 */
type SqliteStateProviderConformanceOptions<TMode extends Mode = "async"> = {
  /**
   * Creates the provider under test, over a database the suite may create tables in. Each
   * case's adapter gets its own provider and closes it when the case ends, so closing one must
   * not release resources the next one needs, such as the pool or the database connection.
   */
  createStateProvider(
    this: void,
  ): TMode extends "sync"
    ? SqliteStateProvider<any, "sync">
    : MaybePromise<SqliteStateProvider<any, TMode>>;
  /**
   * Runs the callback with a context of the provider's shape that is not inside a transaction,
   * such as `{ db }`, so the suite can check that `isTransaction` rejects it.
   */
  withNonTransactionContext<T>(
    this: void,
    fn: (txCtx: any) => ModeResult<TMode, T>,
  ): ModeResult<TMode, T>;
  /**
   * Runs `fn` in a savepoint of `txCtx`'s transaction, opened the way the application opens
   * one, and passes it the savepoint's context: releases the savepoint when `fn` succeeds and
   * rolls it back when `fn` fails, then rethrows. The suite checks that the provider's
   * `onTransactionCommit` and `onTransactionRollback` follow it; without it, those cases pass
   * without checking anything.
   */
  withSavepoint?<T>(
    this: void,
    txCtx: any,
    fn: (txCtx: any) => ModeResult<TMode, T>,
  ): ModeResult<TMode, T>;
  /**
   * Options every adapter of the suite is created with, besides its provider, such as the
   * `tablePrefix` and ID types your application configures. The suite migrates and clears the
   * tables they name.
   */
  stateAdapterOptions?: Omit<Parameters<typeof createSqliteStateAdapter>[0], "stateProvider">;
};

const prepareContext = syncAsync(function* (
  {
    createStateProvider,
    withNonTransactionContext,
    withSavepoint,
    stateAdapterOptions,
  }: SqliteStateProviderConformanceOptions<"sync"> | SqliteStateProviderConformanceOptions,
  firstStateProvider: SqliteStateProvider<any, Mode>,
) {
  const sync = firstStateProvider.sync === true;
  const tablePrefix = stateAdapterOptions?.tablePrefix ?? "queuert_";
  const createModeStateProvider = sync ? createStateProvider : async () => createStateProvider();
  const createStateAdapter = (stateProvider: SqliteStateProvider<any, Mode>) =>
    createSqliteStateAdapter({ ...stateAdapterOptions, stateProvider });

  const executeDdl = syncAsync(function* (sql: string) {
    const stateProvider = yield* step(createModeStateProvider());
    try {
      yield* step(stateProvider.executeSql({ ...ddl, sql }));
    } finally {
      if (stateProvider.close) yield* step(stateProvider.close());
    }
  });

  const createCaseStateAdapter = syncAsync(function* () {
    const stateProvider = yield* step(createModeStateProvider());
    const stateAdapter = createStateAdapter(stateProvider);
    try {
      yield* step(
        stateProvider.executeSql({ ...ddl, sql: `DELETE FROM ${tablePrefix}job_blocker` }),
      );
      yield* step(stateProvider.executeSql({ ...ddl, sql: `DELETE FROM ${tablePrefix}job` }));
      yield* step(stateProvider.executeSql({ ...ddl, sql: `DELETE FROM ${tablePrefix}worker` }));
    } catch (error) {
      yield* step(stateAdapter.close());
      throw error;
    }
    return stateAdapter;
  });

  const withWritesFenced = syncAsync(function* (fn: () => MaybePromise<unknown>) {
    yield* executeDdl.steps(`DROP TABLE ${tablePrefix}schema_fence_v1`);
    try {
      return yield* step(fn());
    } finally {
      yield* executeDdl.steps(
        `CREATE TABLE ${tablePrefix}schema_fence_v1 (id INTEGER PRIMARY KEY)`,
      );
    }
  });

  const createDisposableStateProvider = syncAsync(function* () {
    const stateProvider = yield* step(createStateProvider());
    return {
      ...stateProvider,
      [Symbol.asyncDispose]: async () => {
        await stateProvider.close?.();
      },
    };
  });

  const migratingStateAdapter = createStateAdapter(firstStateProvider);
  try {
    yield* step(migratingStateAdapter.migrateToLatest());
  } finally {
    yield* step(migratingStateAdapter.close());
  }

  const context: SqliteStateProviderConformanceContext = {
    createStateProvider: sync
      ? createDisposableStateProvider.sync
      : createDisposableStateProvider.async,
    withNonTransactionContext,
    withSavepoint,
    createStateAdapter: sync ? createCaseStateAdapter.sync : createCaseStateAdapter.async,
    withWritesFenced: <T>(fn: () => MaybePromise<T>) =>
      (sync ? withWritesFenced.sync(fn) : withWritesFenced.async(fn)) as MaybePromise<T>,
  };
  return context;
});

/**
 * Prepares the context the {@link sqliteStateProviderConformanceCases} run against: migrates the schema once through a
 * provider from `createStateProvider`. Each case then builds its own adapter over a new provider
 * from it, with the tables cleared. Call it once the database is ready, such as in `beforeAll`;
 * the test file owns the database and releases it itself.
 *
 * The context follows the provider's mode: for a {@link SqliteStateProvider} with `sync: true` it is
 * returned directly, and for an async provider it comes as a promise.
 *
 * @param options - Context configuration.
 */
export function createSqliteStateProviderConformanceContext(
  options: SqliteStateProviderConformanceOptions<"sync">,
): SqliteStateProviderConformanceContext;
export function createSqliteStateProviderConformanceContext(
  options: SqliteStateProviderConformanceOptions,
): Promise<SqliteStateProviderConformanceContext>;
export function createSqliteStateProviderConformanceContext(
  options: SqliteStateProviderConformanceOptions<"sync"> | SqliteStateProviderConformanceOptions,
): MaybePromise<SqliteStateProviderConformanceContext> {
  return andThen(options.createStateProvider(), (firstStateProvider) =>
    firstStateProvider.sync === true
      ? prepareContext.sync(options, firstStateProvider)
      : prepareContext.async(options, firstStateProvider),
  );
}

/**
 * Every state adapter contract case, run through `createSqliteStateAdapter` over the provider in
 * its mode, plus checks of the provider's `classifyError`. Over a provider with `sync: true` they
 * also check its own contract: results without a promise, commit, rollback, `isTransaction`, and
 * an autocommit statement that throws inside an open transaction. Run them one per test in your own test
 * file against a context from {@link createSqliteStateProviderConformanceContext}; an async
 * provider also runs {@link asyncSqliteStateProviderConformanceCases}. Works with any test runner.
 *
 * @example
 * ```ts
 * import { after, before, test } from "node:test";
 *
 * const client = createClient({ url: ":memory:" });
 * const lock = createAsyncRwLock();
 * let context: SqliteStateProviderConformanceContext;
 * before(async () => {
 *   context = await createSqliteStateProviderConformanceContext({
 *     createStateProvider: async () => createLibsqlStateProvider({ client, lock }),
 *     withNonTransactionContext: async (fn) => fn({ client }),
 *   });
 * });
 * after(() => client.close());
 *
 * for (const conformanceCase of [
 *   ...sqliteStateProviderConformanceCases,
 *   ...asyncSqliteStateProviderConformanceCases,
 * ]) {
 *   void test(conformanceCase.title, async () => {
 *     await conformanceCase.run(context);
 *   });
 * }
 * ```
 */
export const sqliteStateProviderConformanceCases: ConformanceTestCase<SqliteStateProviderConformanceContext>[] =
  toConformanceTestCases([
    ...sqliteStateProviderConformanceGroups,
    ...sqliteSyncStateProviderConformanceGroups,
  ]);

/**
 * The state adapter contract cases that hold a transaction open across an `await`, run through
 * `createSqliteStateAdapter` over the provider. Only an async provider can pass them; it runs them
 * next to {@link sqliteStateProviderConformanceCases}.
 */
export const asyncSqliteStateProviderConformanceCases: ConformanceTestCase<SqliteStateProviderConformanceContext>[] =
  toConformanceTestCases(stateAdapterAsyncGroups);
