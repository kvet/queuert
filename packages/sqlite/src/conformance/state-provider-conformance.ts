import assert from "node:assert/strict";

import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  type SavepointConformanceContext,
  type SchemaFenceConformanceContext,
  toConformanceTestCases,
  stateAdapterBaseGroups,
  stateAdapterSavepointGroups,
  stateAdapterSchemaFenceGroups,
} from "queuert/conformance-internal";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";

/**
 * The context the {@link sqliteStateProviderConformanceCases} run against. Get it from
 * {@link createSqliteStateProviderConformanceContext} and pass it to every case unchanged.
 */
export type SqliteStateProviderConformanceContext = SchemaFenceConformanceContext &
  SavepointConformanceContext & {
    createStateProvider: () => Promise<SqliteStateProvider<any>>;
  };

const MISSING_TABLE = "queuert_conformance_missing";

const executeSql = async (
  stateProvider: SqliteStateProvider<any>,
  sql: string,
  txCtx?: unknown,
): Promise<unknown[]> =>
  stateProvider.executeSql({
    txCtx,
    sql,
    params: [],
    paramTypes: {},
    columnTypes: {},
    readOnly: true,
  });

const captureError = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the statement to fail");
};

export const classifyErrorGroup: ConformanceGroup<SqliteStateProviderConformanceContext> = {
  name: "classifyError",
  cases: [
    {
      name: "classifies a missing table as undefined_table, naming it",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();

        try {
          const error = await captureError(async () =>
            executeSql(stateProvider, `SELECT 1 FROM ${MISSING_TABLE}`),
          );
          assert.deepEqual(stateProvider.classifyError({ error }), {
            kind: "undefined_table",
            tableName: MISSING_TABLE,
          });
        } finally {
          await stateProvider.close?.();
        }
      },
    },
    {
      name: "classifies a missing table inside a transaction as undefined_table, naming it",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();

        try {
          let error: unknown;
          await assert.rejects(
            stateProvider.withTransaction(async (txCtx) => {
              error = await captureError(async () =>
                executeSql(stateProvider, `SELECT 1 FROM ${MISSING_TABLE}`, txCtx),
              );
              throw error;
            }),
          );
          assert.deepEqual(stateProvider.classifyError({ error }), {
            kind: "undefined_table",
            tableName: MISSING_TABLE,
          });
        } finally {
          await stateProvider.close?.();
        }
      },
    },
    {
      name: "returns undefined for an error other than a missing table",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();

        try {
          const error = await captureError(async () =>
            executeSql(stateProvider, "SELECT missing_column FROM queuert_job"),
          );
          assert.equal(stateProvider.classifyError({ error }), undefined);
        } finally {
          await stateProvider.close?.();
        }
      },
    },
    {
      name: "returns undefined for a value that is not a driver error",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();

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

export const sqliteStateAdapterConformanceGroups: ConformanceGroup<SchemaFenceConformanceContext>[] =
  [...stateAdapterBaseGroups, ...stateAdapterSchemaFenceGroups];

export const sqliteStateProviderConformanceGroups: ConformanceGroup<SqliteStateProviderConformanceContext>[] =
  [...sqliteStateAdapterConformanceGroups, ...stateAdapterSavepointGroups, classifyErrorGroup];

/**
 * Prepares the context the {@link sqliteStateProviderConformanceCases} run against: migrates the
 * schema once through a provider from `createStateProvider`. Each case then builds its own adapter
 * over a new provider from it, with the tables cleared. Call it once the database is ready, such
 * as in `beforeAll`; the test file owns the database and releases it itself.
 *
 * @param options - Context configuration.
 */
export const createSqliteStateProviderConformanceContext = async ({
  createStateProvider,
  withNonTransactionContext,
  withSavepoint,
}: {
  /**
   * Creates the provider under test, over a database the suite may create tables in. Each case's
   * adapter gets its own provider and closes it when the case ends, so closing one must not
   * release resources the next one needs, such as the pool or the database connection.
   */
  createStateProvider: () => Promise<SqliteStateProvider<any>>;
  /**
   * Runs the callback with a context of the provider's shape that is not inside a transaction,
   * so the suite can check `isTransaction` rejects it.
   */
  withNonTransactionContext: <T>(fn: (txCtx: any) => Promise<T>) => Promise<T>;
  /**
   * Runs `fn` in a savepoint of `txCtx`'s transaction, opened the way the application opens one,
   * and passes it the savepoint's context: releases the savepoint when `fn` resolves and rolls it
   * back when `fn` throws, then rethrows. The suite checks that the provider's `onTransactionCommit` and
   * `onTransactionRollback` follow it; without it, those cases pass without checking anything.
   */
  withSavepoint?: <T>(txCtx: any, fn: (txCtx: any) => Promise<T>) => Promise<T>;
}): Promise<SqliteStateProviderConformanceContext> => {
  const ddl = { params: [], paramTypes: {}, columnTypes: {}, readOnly: false };
  const executeDdl = async (sql: string): Promise<void> => {
    const stateProvider = await createStateProvider();
    try {
      await stateProvider.executeSql({ ...ddl, sql });
    } finally {
      await stateProvider.close?.();
    }
  };

  {
    await using stateAdapter = createSqliteStateAdapter({
      stateProvider: await createStateProvider(),
    });
    await stateAdapter.migrateToLatest();
  }

  return {
    createStateProvider,
    withNonTransactionContext,
    withSavepoint,
    createStateAdapter: async () => {
      const stateProvider = await createStateProvider();
      const stateAdapter = createSqliteStateAdapter({ stateProvider });
      try {
        await stateProvider.executeSql({ ...ddl, sql: "DELETE FROM queuert_job_blocker" });
        await stateProvider.executeSql({ ...ddl, sql: "DELETE FROM queuert_job" });
        await stateProvider.executeSql({ ...ddl, sql: "DELETE FROM queuert_worker" });
      } catch (error) {
        await stateAdapter.close();
        throw error;
      }
      return stateAdapter;
    },
    withWritesFenced: async (fn) => {
      await executeDdl("DROP TABLE queuert_schema_fence_v1");
      try {
        return await fn();
      } finally {
        await executeDdl("CREATE TABLE queuert_schema_fence_v1 (id INTEGER PRIMARY KEY)");
      }
    },
  };
};

/**
 * Every state adapter contract case, run through `createSqliteStateAdapter` over a provider, plus
 * checks of the provider's `classifyError`. Run them one per test in your own test file against a
 * context from {@link createSqliteStateProviderConformanceContext}. Works with any test runner.
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
  toConformanceTestCases(sqliteStateProviderConformanceGroups);
