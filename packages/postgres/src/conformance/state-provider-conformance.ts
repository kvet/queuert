import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  type SchemaFenceConformanceContext,
  toConformanceTestCases,
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
  stateAdapterSchemaFenceConcurrentTransactionGroups,
  stateAdapterSchemaFenceGroups,
} from "queuert/conformance-internal";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";

/** What {@link createPgStateProviderConformanceContext} takes. */
export type PgStateProviderConformanceContextOptions = {
  /**
   * Creates the provider under test, over a database the suite may create tables in. Each case's
   * adapter gets its own provider and closes it when the case ends, so closing one must not
   * release resources the next one needs, such as the pool or the database connection.
   */
  createStateProvider: () => Promise<PgStateProvider<any>>;
  /**
   * Runs the callback with a context of the provider's shape that is not inside a transaction
   * (e.g. a pool client with no `BEGIN`), so the suite can check `isTransaction` rejects it.
   */
  withNonTransactionContext: <T>(fn: (txCtx: any) => Promise<T>) => Promise<T>;
};

/**
 * The context the {@link pgStateProviderConformanceCases} run against. Get it from
 * {@link createPgStateProviderConformanceContext} and pass it to every case unchanged.
 */
export type PgStateProviderConformanceContext = SchemaFenceConformanceContext & {
  createStateProvider: () => Promise<PgStateProvider<any>>;
};

const MISSING_TABLE = "public.queuert_conformance_missing";

const executeSql = async (
  stateProvider: PgStateProvider<any>,
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

export const classifyErrorGroup: ConformanceGroup<PgStateProviderConformanceContext> = {
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
            executeSql(stateProvider, "SELECT missing_column FROM public.queuert_job"),
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

const pgStateProviderBaseGroups: ConformanceGroup<PgStateProviderConformanceContext>[] = [
  ...stateAdapterBaseGroups,
  ...stateAdapterSchemaFenceGroups,
  classifyErrorGroup,
];

export const pgStateProviderConformanceGroups: ConformanceGroup<PgStateProviderConformanceContext>[] =
  [
    ...pgStateProviderBaseGroups,
    ...stateAdapterConcurrentTransactionGroups,
    ...stateAdapterSchemaFenceConcurrentTransactionGroups,
  ];

/**
 * Prepares the context the {@link pgStateProviderConformanceCases} run against: migrates the
 * schema once through a provider from `createStateProvider`. Each case then builds its own adapter
 * over a new provider from it, with the tables cleared. Call it once the database is ready, such
 * as in `beforeAll`; the test file owns the database and releases it itself.
 */
export const createPgStateProviderConformanceContext = async ({
  createStateProvider,
  withNonTransactionContext,
}: PgStateProviderConformanceContextOptions): Promise<PgStateProviderConformanceContext> => {
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
    await using stateAdapter = createPgStateAdapter({ stateProvider: await createStateProvider() });
    await stateAdapter.migrateToLatest();
  }

  return {
    createStateProvider,
    withNonTransactionContext,
    createStateAdapter: async () => {
      const stateProvider = await createStateProvider();
      const stateAdapter = createPgStateAdapter({ stateProvider });
      try {
        await stateProvider.executeSql({
          ...ddl,
          sql: "TRUNCATE public.queuert_job_blocker, public.queuert_job, public.queuert_worker CASCADE",
        });
      } catch (error) {
        await stateAdapter.close();
        throw error;
      }
      return stateAdapter;
    },
    withWritesFenced: async (fn) => {
      await executeDdl("DROP TABLE public.queuert_schema_fence_v1");
      try {
        return await fn();
      } finally {
        await executeDdl("CREATE TABLE public.queuert_schema_fence_v1 (id integer PRIMARY KEY)");
      }
    },
  };
};

/**
 * Every state adapter case, including those that hold two transactions open at once, run through
 * `createPgStateAdapter` over a provider, plus checks of the provider's `classifyError`. Run them
 * one per test in your own test file against a context from {@link
 * createPgStateProviderConformanceContext}. Works with any test runner.
 *
 * @example
 * ```ts
 * import { afterAll, beforeAll, test } from "vitest";
 *
 * let pool: Pool;
 * let context: PgStateProviderConformanceContext;
 * beforeAll(async () => {
 *   pool = new Pool({ connectionString });
 *   context = await createPgStateProviderConformanceContext({
 *     createStateProvider: async () => createPgPoolStateProvider({ pool }),
 *     withNonTransactionContext: async (fn) => {
 *       const poolClient = await pool.connect();
 *       try {
 *         return await fn({ poolClient });
 *       } finally {
 *         poolClient.release();
 *       }
 *     },
 *   });
 * });
 * afterAll(async () => pool.end());
 *
 * for (const conformanceCase of pgStateProviderConformanceCases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run(context);
 *   });
 * }
 * ```
 */
export const pgStateProviderConformanceCases: ConformanceTestCase<PgStateProviderConformanceContext>[] =
  toConformanceTestCases(pgStateProviderConformanceGroups);
