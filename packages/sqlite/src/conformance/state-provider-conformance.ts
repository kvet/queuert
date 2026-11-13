import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { type MaybePromise, isPromise } from "@queuert/helpers/maybe-promise";
import { modal } from "@queuert/helpers/modal";
import { type Steps, step } from "@queuert/helpers/steps";
import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  type SavepointConformanceContext,
  type SchemaFenceConformanceContext,
  inMode,
  stateAdapterBaseGroups,
  stateAdapterSavepointGroups,
  stateAdapterSchemaFenceGroups,
  toConformanceTestCases,
} from "queuert/conformance-internal";
import { isSyncAdapter } from "queuert/internal";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import type {
  AnySqliteStateProvider,
  ModeSqliteStateProvider,
  SqliteStateProvider,
  SyncSqliteStateProvider,
} from "../state-provider/state-provider.sqlite.ts";

/**
 * The context the {@link sqliteStateProviderConformanceCases} and
 * {@link syncSqliteStateProviderConformanceCases} run against, over a provider of either mode. Get
 * it from {@link createSqliteStateProviderConformanceContext} and pass it to every case unchanged.
 */
export type SqliteStateProviderConformanceContext = SchemaFenceConformanceContext &
  SavepointConformanceContext & {
    /** Creates a provider under test; each case closes the providers it creates. */
    createStateProvider(): MaybePromise<AnySqliteStateProvider<any>>;
  };

const MISSING_TABLE = "queuert_conformance_missing";

const executeSql = (
  stateProvider: ModeSqliteStateProvider<any>,
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

const captureError = modal(function* (run: () => MaybePromise<unknown>) {
  try {
    yield* step(run());
  } catch (error) {
    return error;
  }
  throw new Error("expected the statement to fail");
});

const providerCase =
  (body: (stateProvider: ModeSqliteStateProvider<any>) => Steps<void>) =>
  async (context: SqliteStateProviderConformanceContext): Promise<void> => {
    const stateProvider: ModeSqliteStateProvider<any> = await context.createStateProvider();
    try {
      await inMode(stateProvider, () => body(stateProvider));
    } finally {
      await stateProvider.close?.();
    }
  };

const classifyErrorGroup: ConformanceGroup<SqliteStateProviderConformanceContext> = {
  name: "classifyError",
  cases: [
    {
      name: "classifies a missing table as undefined_table, naming it",
      run: providerCase(function* (stateProvider) {
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
      run: providerCase(function* (stateProvider) {
        let error: unknown;
        yield* step(
          assertRejects(() =>
            stateProvider.withTransaction((txCtx) =>
              inMode(stateProvider, function* () {
                error = yield* captureError.steps(() =>
                  executeSql(stateProvider, `SELECT 1 FROM ${MISSING_TABLE}`, txCtx),
                );
                throw error;
              }),
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
      run: providerCase(function* (stateProvider) {
        const error = yield* captureError.steps(() =>
          executeSql(stateProvider, "SELECT missing_column FROM queuert_job"),
        );
        assert.equal(stateProvider.classifyError({ error }), undefined);
      }),
    },
    {
      name: "returns undefined for a value that is not a driver error",
      run: async (context) => {
        const stateProvider: ModeSqliteStateProvider<any> = await context.createStateProvider();
        try {
          assert.equal(stateProvider.classifyError({ error: new Error("unrelated") }), undefined);
          assert.equal(stateProvider.classifyError({ error: undefined }), undefined);
        } finally {
          await stateProvider.close?.();
        }
      },
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

const countStatement = (txCtx?: unknown) => ({
  ...statement(`SELECT COUNT(*) AS count FROM ${probeTable}`, txCtx),
  columnTypes: { count: "number" as const },
  readOnly: true,
});

const insertStatement = (txCtx?: unknown) =>
  statement(`INSERT INTO ${probeTable} (value) VALUES (1)`, txCtx);

const readCount = (rows: unknown[]): number => Number((rows[0] as { count: unknown }).count);

const resetProbe = (stateProvider: SyncSqliteStateProvider<any>): void => {
  stateProvider.executeSql(
    statement(`CREATE TABLE IF NOT EXISTS ${probeTable} (value INTEGER NOT NULL)`),
  );
  stateProvider.executeSql(statement(`DELETE FROM ${probeTable}`));
};

const syncProviderCase =
  (
    body: (
      stateProvider: SyncSqliteStateProvider<any>,
      withNonTransactionContext: <T>(fn: (txCtx: any) => T) => T,
    ) => void,
  ) =>
  async (context: SqliteStateProviderConformanceContext): Promise<void> => {
    body(
      context.createStateProvider() as SyncSqliteStateProvider<any>,
      (fn) => context.withNonTransactionContext(fn) as ReturnType<typeof fn>,
    );
  };

const syncSqliteStateProviderGroup: ConformanceGroup<SqliteStateProviderConformanceContext> = {
  name: "SyncSqliteStateProvider",
  cases: [
    {
      name: "executeSql returns rows without a promise",
      mode: "sync",
      run: syncProviderCase((stateProvider) => {
        resetProbe(stateProvider);
        stateProvider.executeSql(insertStatement());
        const rows = stateProvider.executeSql(countStatement());
        assert.ok(Array.isArray(rows));
        assert.equal(readCount(rows), 1);
      }),
    },
    {
      name: "withTransaction returns the callback's value and commits its writes",
      mode: "sync",
      run: syncProviderCase((stateProvider) => {
        resetProbe(stateProvider);
        const result = stateProvider.withTransaction((txCtx) => {
          stateProvider.executeSql(insertStatement(txCtx));
          return "committed";
        });
        assert.equal(result, "committed");
        assert.equal(readCount(stateProvider.executeSql(countStatement())), 1);
      }),
    },
    {
      name: "withTransaction rolls back its writes and rethrows when the callback throws",
      mode: "sync",
      run: syncProviderCase((stateProvider) => {
        resetProbe(stateProvider);
        assert.throws(
          () =>
            stateProvider.withTransaction((txCtx) => {
              stateProvider.executeSql(insertStatement(txCtx));
              throw new Error("callback failed");
            }),
          /callback failed/,
        );
        assert.equal(readCount(stateProvider.executeSql(countStatement())), 0);
      }),
    },
    {
      name: "withTransaction rolls back and throws when the callback returns a promise",
      mode: "sync",
      run: syncProviderCase((stateProvider) => {
        resetProbe(stateProvider);
        assert.throws(() =>
          stateProvider.withTransaction((txCtx) => {
            stateProvider.executeSql(insertStatement(txCtx));
            return Promise.resolve("async");
          }),
        );
        assert.equal(readCount(stateProvider.executeSql(countStatement())), 0);
      }),
    },
    {
      name: "isTransaction is true inside withTransaction and false outside it",
      mode: "sync",
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
      mode: "sync",
      run: syncProviderCase((stateProvider, withNonTransactionContext) => {
        resetProbe(stateProvider);
        withNonTransactionContext((txCtx) => {
          stateProvider.executeSql(statement("BEGIN", txCtx));
          try {
            assert.throws(() => stateProvider.executeSql(insertStatement()));
          } finally {
            stateProvider.executeSql(statement("ROLLBACK", txCtx));
          }
        });
        assert.equal(readCount(stateProvider.executeSql(countStatement())), 0);
      }),
    },
  ],
};

export const sqliteStateAdapterConformanceGroups: ConformanceGroup<SchemaFenceConformanceContext>[] =
  [...stateAdapterBaseGroups, ...stateAdapterSchemaFenceGroups];

export const sqliteStateProviderConformanceGroups: ConformanceGroup<SqliteStateProviderConformanceContext>[] =
  [
    ...sqliteStateAdapterConformanceGroups,
    ...stateAdapterSavepointGroups,
    classifyErrorGroup,
    syncSqliteStateProviderGroup,
  ];

const ddl = { params: [], paramTypes: {}, columnTypes: {}, readOnly: false };

const prepareContext = modal(function* (
  {
    createStateProvider,
    withNonTransactionContext,
    withSavepoint,
  }: {
    createStateProvider: () => MaybePromise<AnySqliteStateProvider<any>>;
    withNonTransactionContext: <T>(fn: (txCtx: any) => MaybePromise<T>) => MaybePromise<T>;
    withSavepoint?: <T>(txCtx: any, fn: (txCtx: any) => MaybePromise<T>) => MaybePromise<T>;
  },
  firstStateProvider: AnySqliteStateProvider<any>,
) {
  const sync = isSyncAdapter(firstStateProvider);
  const createStateAdapter = (stateProvider: AnySqliteStateProvider<any>) =>
    createSqliteStateAdapter({ stateProvider });

  const executeDdl = modal(function* (sql: string) {
    const stateProvider: ModeSqliteStateProvider<any> = yield* step(createStateProvider());
    try {
      yield* step(stateProvider.executeSql({ ...ddl, sql }));
    } finally {
      yield* step(stateProvider.close?.());
    }
  });

  const createCaseStateAdapter = modal(function* () {
    const stateProvider: ModeSqliteStateProvider<any> = yield* step(createStateProvider());
    const stateAdapter = createStateAdapter(stateProvider as AnySqliteStateProvider<any>);
    try {
      yield* step(stateProvider.executeSql({ ...ddl, sql: "DELETE FROM queuert_job_blocker" }));
      yield* step(stateProvider.executeSql({ ...ddl, sql: "DELETE FROM queuert_job" }));
      yield* step(stateProvider.executeSql({ ...ddl, sql: "DELETE FROM queuert_worker" }));
    } catch (error) {
      yield* step(stateAdapter.close());
      throw error;
    }
    return stateAdapter;
  });

  const withWritesFenced = modal(function* (fn: () => MaybePromise<unknown>) {
    yield* executeDdl.steps("DROP TABLE queuert_schema_fence_v1");
    try {
      return yield* step(fn());
    } finally {
      yield* executeDdl.steps("CREATE TABLE queuert_schema_fence_v1 (id INTEGER PRIMARY KEY)");
    }
  });

  const migratingStateAdapter = createStateAdapter(firstStateProvider);
  try {
    yield* step(migratingStateAdapter.migrateToLatest());
  } finally {
    yield* step(migratingStateAdapter.close());
  }

  const context: SqliteStateProviderConformanceContext = {
    createStateProvider,
    withNonTransactionContext,
    withSavepoint,
    createStateAdapter: sync ? createCaseStateAdapter.sync : createCaseStateAdapter.async,
    withWritesFenced: (sync ? withWritesFenced.sync : withWritesFenced.async) as <T>(
      fn: () => MaybePromise<T>,
    ) => MaybePromise<T>,
  };
  return context;
});

type ContextOptions = Parameters<typeof prepareContext.sync>[0];

/**
 * Prepares the context the {@link sqliteStateProviderConformanceCases} or
 * {@link syncSqliteStateProviderConformanceCases} run against: migrates the schema once through a
 * provider from `createStateProvider`. Each case then builds its own adapter over a new provider
 * from it, with the tables cleared. Call it once the database is ready, such as in `beforeAll`;
 * the test file owns the database and releases it itself.
 *
 * The context follows the provider's mode: for a {@link SyncSqliteStateProvider} it is returned
 * directly, and for a {@link SqliteStateProvider} it comes as a promise.
 *
 * @param options - Context configuration.
 */
export const createSqliteStateProviderConformanceContext: {
  (options: {
    /**
     * Creates the provider under test, over a database the suite may create tables in. Each
     * case's adapter gets its own provider and closes it when the case ends, so closing one must
     * not release resources the next one needs, such as the database connection.
     */
    createStateProvider: () => SyncSqliteStateProvider<any>;
    /**
     * Runs the callback with a context of the provider's shape that is not inside a transaction,
     * such as `{ db }`, so the suite can check that `isTransaction` rejects it.
     */
    withNonTransactionContext: <T>(fn: (txCtx: any) => T) => T;
    /**
     * Runs `fn` in a savepoint of `txCtx`'s transaction, opened the way the application opens
     * one, and passes it the savepoint's context: releases the savepoint when `fn` succeeds and
     * rolls it back when `fn` fails, then rethrows. The suite checks that the provider's
     * `onTransactionCommit` and `onTransactionRollback` follow it; without it, those cases pass
     * without checking anything.
     */
    withSavepoint?: <T>(txCtx: any, fn: (txCtx: any) => T) => T;
  }): SqliteStateProviderConformanceContext;
  (options: {
    /**
     * Creates the provider under test, over a database the suite may create tables in. Each
     * case's adapter gets its own provider and closes it when the case ends, so closing one must
     * not release resources the next one needs, such as the pool or the database connection.
     */
    createStateProvider: () => MaybePromise<SqliteStateProvider<any>>;
    /**
     * Runs the callback with a context of the provider's shape that is not inside a transaction,
     * such as `{ db }`, so the suite can check that `isTransaction` rejects it.
     */
    withNonTransactionContext: <T>(fn: (txCtx: any) => Promise<T>) => Promise<T>;
    /**
     * Runs `fn` in a savepoint of `txCtx`'s transaction, opened the way the application opens
     * one, and passes it the savepoint's context: releases the savepoint when `fn` succeeds and
     * rolls it back when `fn` fails, then rethrows. The suite checks that the provider's
     * `onTransactionCommit` and `onTransactionRollback` follow it; without it, those cases pass
     * without checking anything.
     */
    withSavepoint?: <T>(txCtx: any, fn: (txCtx: any) => Promise<T>) => Promise<T>;
  }): Promise<SqliteStateProviderConformanceContext>;
} = ((options: ContextOptions) => {
  const firstStateProvider = options.createStateProvider();
  if (isPromise(firstStateProvider)) {
    return firstStateProvider.then(async (stateProvider) =>
      prepareContext.async(options, stateProvider),
    );
  }
  return isSyncAdapter(firstStateProvider)
    ? prepareContext.sync(options, firstStateProvider)
    : prepareContext.async(options, firstStateProvider);
}) as any;

/**
 * Every state adapter contract case, run through `createSqliteStateAdapter` over an asynchronous
 * provider, plus checks of the provider's `classifyError`. Run them one per test in your own test
 * file against a context from {@link createSqliteStateProviderConformanceContext}. Works with any
 * test runner.
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
 * for (const conformanceCase of sqliteStateProviderConformanceCases) {
 *   void test(conformanceCase.title, async () => {
 *     await conformanceCase.run(context);
 *   });
 * }
 * ```
 */
export const sqliteStateProviderConformanceCases: ConformanceTestCase<SqliteStateProviderConformanceContext>[] =
  toConformanceTestCases(sqliteStateProviderConformanceGroups, "async");

/**
 * The {@link sqliteStateProviderConformanceCases} for a {@link SyncSqliteStateProvider}. They also
 * check the provider's own contract: results without a promise, commit, rollback,
 * `isTransaction`, and an autocommit statement that throws inside an open transaction.
 */
export const syncSqliteStateProviderConformanceCases: ConformanceTestCase<SqliteStateProviderConformanceContext>[] =
  toConformanceTestCases(sqliteStateProviderConformanceGroups, "sync");
