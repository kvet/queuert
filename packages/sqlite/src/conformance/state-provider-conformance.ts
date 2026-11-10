import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  type SchemaFenceConformanceContext,
  toConformanceTestCases,
  stateAdapterBaseGroups,
  stateAdapterSchemaFenceGroups,
} from "queuert/conformance-internal";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";

/** What {@link createSqliteStateProviderConformanceContext} takes. */
export type SqliteStateProviderConformanceContextOptions = {
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
};

/**
 * The context the {@link sqliteStateProviderConformanceCases} run against. Get it from
 * {@link createSqliteStateProviderConformanceContext} and pass it to every case unchanged.
 */
export type SqliteStateProviderConformanceContext = SchemaFenceConformanceContext & {
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
      run: async ({ createStateProvider }, expect) => {
        const stateProvider = await createStateProvider();

        try {
          const error = await captureError(async () =>
            executeSql(stateProvider, `SELECT 1 FROM ${MISSING_TABLE}`),
          );
          expect(stateProvider.classifyError({ error })).toEqual({
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
      run: async ({ createStateProvider }, expect) => {
        const stateProvider = await createStateProvider();

        try {
          let error: unknown;
          await expect(
            stateProvider.withTransaction(async (txCtx) => {
              error = await captureError(async () =>
                executeSql(stateProvider, `SELECT 1 FROM ${MISSING_TABLE}`, txCtx),
              );
              throw error;
            }),
          ).rejects.toThrow();
          expect(stateProvider.classifyError({ error })).toEqual({
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
      run: async ({ createStateProvider }, expect) => {
        const stateProvider = await createStateProvider();

        try {
          const error = await captureError(async () =>
            executeSql(stateProvider, "SELECT missing_column FROM queuert_job"),
          );
          expect(stateProvider.classifyError({ error })).toBeUndefined();
        } finally {
          await stateProvider.close?.();
        }
      },
    },
    {
      name: "returns undefined for a value that is not a driver error",
      run: async ({ createStateProvider }, expect) => {
        const stateProvider = await createStateProvider();

        try {
          expect(stateProvider.classifyError({ error: new Error("unrelated") })).toBeUndefined();
          expect(stateProvider.classifyError({ error: undefined })).toBeUndefined();
        } finally {
          await stateProvider.close?.();
        }
      },
    },
  ],
};

const sqliteStateProviderBaseGroups: ConformanceGroup<SqliteStateProviderConformanceContext>[] = [
  ...stateAdapterBaseGroups,
  ...stateAdapterSchemaFenceGroups,
  classifyErrorGroup,
];

export const sqliteStateProviderConformanceGroups: ConformanceGroup<SqliteStateProviderConformanceContext>[] =
  [...sqliteStateProviderBaseGroups];

/**
 * Prepares the context the {@link sqliteStateProviderConformanceCases} run against: migrates the
 * schema once through a provider from `createStateProvider`. Each case then builds its own adapter
 * over a new provider from it, with the tables cleared. Call it once the database is ready, such
 * as in `beforeAll`; the test file owns the database and releases it itself.
 */
export const createSqliteStateProviderConformanceContext = async ({
  createStateProvider,
  withNonTransactionContext,
}: SqliteStateProviderConformanceContextOptions): Promise<SqliteStateProviderConformanceContext> => {
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
 * Every state adapter case, run through `createSqliteStateAdapter` over a provider, plus checks of
 * the provider's `classifyError`. Run them one per test in your own test file against a context
 * from {@link createSqliteStateProviderConformanceContext}. Works with any test runner.
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
