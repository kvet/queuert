import type { ConformanceOptions, ConformanceReport } from "queuert/conformance";
import {
  type ConformanceGroup,
  type SchemaFenceConformanceFixture,
  runFixtureConformance,
  stateAdapterBaseGroups,
  stateAdapterSchemaFenceGroups,
} from "queuert/conformance-internal";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";

/** Fixture for {@link runSqliteStateProviderConformance}. */
export type SqliteStateProviderConformanceFixture = {
  /** The provider under test, over an empty database. */
  stateProvider: SqliteStateProvider<any>;
  /**
   * Runs the callback with a context of the provider's shape that is not inside a transaction,
   * so the suite can check `isTransaction` rejects it. Cases that need it are skipped when
   * omitted.
   */
  withNonTransactionContext?: <T>(fn: (txCtx: any) => Promise<T>) => Promise<T>;
  /** Called once after all cases finish (pass or fail) to release resources. */
  dispose?: () => Promise<void>;
};

export type SqliteStateProviderConformanceContext = SchemaFenceConformanceFixture & {
  stateProvider: SqliteStateProvider<any>;
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
      run: async ({ stateProvider }, expect) => {
        const error = await captureError(async () =>
          executeSql(stateProvider, `SELECT 1 FROM ${MISSING_TABLE}`),
        );
        expect(stateProvider.classifyError({ error })).toEqual({
          kind: "undefined_table",
          tableName: MISSING_TABLE,
        });
      },
    },
    {
      name: "classifies a missing table inside a transaction as undefined_table, naming it",
      run: async ({ stateProvider }, expect) => {
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
      },
    },
    {
      name: "returns undefined for an error other than a missing table",
      run: async ({ stateProvider }, expect) => {
        const error = await captureError(async () =>
          executeSql(stateProvider, "SELECT missing_column FROM queuert_job"),
        );
        expect(stateProvider.classifyError({ error })).toBeUndefined();
      },
    },
    {
      name: "returns undefined for a value that is not a driver error",
      run: async ({ stateProvider }, expect) => {
        expect(stateProvider.classifyError({ error: new Error("unrelated") })).toBeUndefined();
        expect(stateProvider.classifyError({ error: undefined })).toBeUndefined();
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

export const createSqliteConformanceContext = async ({
  stateProvider,
  withNonTransactionContext,
  dispose,
}: SqliteStateProviderConformanceFixture): Promise<
  SqliteStateProviderConformanceContext & {
    reset: () => Promise<void>;
    dispose?: () => Promise<void>;
  }
> => {
  const stateAdapter = createSqliteStateAdapter({ stateProvider });
  await stateAdapter.migrateToLatest();
  const executeDdl = async (sql: string): Promise<void> => {
    await stateProvider.executeSql({
      sql,
      params: [],
      paramTypes: {},
      columnTypes: {},
      readOnly: false,
    });
  };
  return {
    stateAdapter,
    stateProvider,
    withNonTransactionContext,
    withWritesFenced: async (fn) => {
      await executeDdl("DROP TABLE queuert_schema_fence_v1");
      try {
        return await fn();
      } finally {
        await executeDdl("CREATE TABLE queuert_schema_fence_v1 (id INTEGER PRIMARY KEY)");
      }
    },
    reset: async () => stateAdapter.truncate(),
    dispose,
  };
};

/**
 * Run the conformance suite against a {@link SqliteStateProvider}: every state adapter case,
 * run through `createSqliteStateAdapter` over the provider, and the provider's `classifyError`.
 * The adapter is migrated once and truncated before every case. Test-framework agnostic:
 * designed to be embedded in a single test. Throws `ConformanceError` with an aggregated report
 * on any failure.
 *
 * @example
 * ```ts
 * await runSqliteStateProviderConformance(async () => {
 *   const client = createClient({ url: ":memory:" });
 *   return {
 *     stateProvider: createLibsqlStateProvider({ client }),
 *     dispose: async () => client.close(),
 *   };
 * });
 * ```
 */
export const runSqliteStateProviderConformance = async (
  factory: () => Promise<SqliteStateProviderConformanceFixture>,
  options?: ConformanceOptions,
): Promise<ConformanceReport> => {
  const fixture = await factory();
  return runFixtureConformance(
    sqliteStateProviderConformanceGroups,
    async () => createSqliteConformanceContext(fixture),
    options,
  );
};
