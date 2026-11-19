import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  type SavepointConformanceContext,
  type SchemaFenceConformanceContext,
  toConformanceTestCases,
  stateAdapterAsyncGroups,
  stateAdapterBaseGroups,
  stateAdapterSavepointGroups,
  stateAdapterConcurrentTransactionGroups,
  stateAdapterSchemaFenceConcurrentTransactionGroups,
  stateAdapterSchemaFenceGroups,
} from "queuert/conformance-internal";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";

export type PgStateProviderConformanceContext = SchemaFenceConformanceContext &
  SavepointConformanceContext & {
    createStateProvider: () => Promise<PgStateProvider<any>>;
  };

const MISSING_TABLE = "public.queuert_conformance_missing";

const statement = (sql: string, params: unknown[] = []) => ({
  sql,
  params,
  paramTypes: {},
  columnTypes: {},
  readOnly: false,
});

const executeStatement = async (
  stateProvider: PgStateProvider<any>,
  sql: string,
  txCtx?: unknown,
): Promise<unknown[]> => {
  const [rows] = await stateProvider.executeStatements({ txCtx, statements: [statement(sql)] });
  return rows;
};

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
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();

        try {
          const error = await captureError(async () =>
            executeStatement(stateProvider, `SELECT 1 FROM ${MISSING_TABLE}`),
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
                executeStatement(stateProvider, `SELECT 1 FROM ${MISSING_TABLE}`, txCtx),
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
            executeStatement(stateProvider, "SELECT missing_column FROM (SELECT 1) AS probe"),
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

export const executeStatementsGroup: ConformanceGroup<PgStateProviderConformanceContext> = {
  name: "executeStatements",
  cases: [
    {
      name: "returns one row array per statement, in statement order",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();

        try {
          const results = await stateProvider.executeStatements({
            statements: [
              statement("SELECT $1::integer AS value", [1]),
              statement("SELECT value FROM generate_series(2, 3) AS value ORDER BY value"),
              statement("SELECT 1 AS value WHERE false"),
              statement("SELECT $1::text AS value", ["four"]),
            ],
          });
          assert.deepEqual(results, [
            [{ value: 1 }],
            [{ value: 2 }, { value: 3 }],
            [],
            [{ value: "four" }],
          ]);
        } finally {
          await stateProvider.close?.();
        }
      },
    },
    {
      name: "returns no results for an empty batch",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();

        try {
          assert.deepEqual(await stateProvider.executeStatements({ statements: [] }), []);
          const results = await stateProvider.withTransaction(async (txCtx) =>
            stateProvider.executeStatements({ txCtx, statements: [] }),
          );
          assert.deepEqual(results, []);
        } finally {
          await stateProvider.close?.();
        }
      },
    },
    {
      name: "runs a single statement, prepared when it has an id",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();

        try {
          const [unprepared] = await stateProvider.executeStatements({
            statements: [statement("SELECT $1::integer + 1 AS value", [1])],
          });
          assert.deepEqual(unprepared, [{ value: 2 }]);
          for (const input of [1, 2]) {
            const [prepared] = await stateProvider.withTransaction(async (txCtx) =>
              stateProvider.executeStatements({
                txCtx,
                statements: [
                  {
                    ...statement("SELECT $1::integer * 10 AS value", [input]),
                    id: "queuert_conformance_execute_statements",
                  },
                ],
              }),
            );
            assert.deepEqual(prepared, [{ value: input * 10 }]);
          }
        } finally {
          await stateProvider.close?.();
        }
      },
    },
    {
      name: "rejects with the failing statement's error and rolls back the transaction",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();
        const table = `public.queuert_conformance_batch_${randomUUID().replaceAll("-", "")}`;

        try {
          await executeStatement(stateProvider, `CREATE TABLE ${table} (id integer PRIMARY KEY)`);
          let error: unknown;
          await assert.rejects(
            stateProvider.withTransaction(async (txCtx) => {
              error = await captureError(async () =>
                stateProvider.executeStatements({
                  txCtx,
                  statements: [
                    statement(`INSERT INTO ${table} (id) VALUES (1)`),
                    statement(`SELECT 1 FROM ${MISSING_TABLE}`),
                    statement(`INSERT INTO ${table} (id) VALUES (2)`),
                  ],
                }),
              );
              throw error;
            }),
          );
          assert.deepEqual(stateProvider.classifyError({ error }), {
            kind: "undefined_table",
            tableName: MISSING_TABLE,
          });
          assert.deepEqual(await executeStatement(stateProvider, `SELECT id FROM ${table}`), []);
        } finally {
          await executeStatement(stateProvider, `DROP TABLE IF EXISTS ${table}`);
          await stateProvider.close?.();
        }
      },
    },
    {
      name: "runs a batch without a transaction context in order",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();
        const table = `public.queuert_conformance_order_${randomUUID().replaceAll("-", "")}`;

        try {
          const results = (await stateProvider.executeStatements({
            statements: [
              statement(`CREATE TABLE ${table} (id integer PRIMARY KEY)`),
              statement(`INSERT INTO ${table} (id) VALUES (1)`),
              statement(`SELECT count(*)::integer AS count FROM ${table}`),
              statement(`INSERT INTO ${table} (id) VALUES (2)`),
              statement(`SELECT count(*)::integer AS count FROM ${table}`),
            ],
          })) as [[], [], { count: number }[], [], { count: number }[]];
          assert.deepEqual([results[2], results[4]], [[{ count: 1 }], [{ count: 2 }]]);
        } finally {
          await executeStatement(stateProvider, `DROP TABLE IF EXISTS ${table}`);
          await stateProvider.close?.();
        }
      },
    },
  ],
};

export const isolationLevelGroup: ConformanceGroup<PgStateProviderConformanceContext> = {
  name: "isolationLevel",
  cases: [
    {
      name: "withTransaction opens transactions at READ COMMITTED",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();

        try {
          const rows = await stateProvider.withTransaction(async (txCtx) =>
            executeStatement(
              stateProvider,
              "SELECT current_setting('transaction_isolation') AS level",
              txCtx,
            ),
          );
          assert.deepEqual([...rows], [{ level: "read committed" }]);
        } finally {
          await stateProvider.close?.();
        }
      },
    },
  ],
};

export const pgStateAdapterConformanceGroups: ConformanceGroup<SchemaFenceConformanceContext>[] = [
  ...stateAdapterBaseGroups,
  ...stateAdapterAsyncGroups,
  ...stateAdapterSchemaFenceGroups,
  ...stateAdapterConcurrentTransactionGroups,
  ...stateAdapterSchemaFenceConcurrentTransactionGroups,
];

export const pgStateProviderConformanceGroups: ConformanceGroup<PgStateProviderConformanceContext>[] =
  [
    ...pgStateAdapterConformanceGroups,
    ...stateAdapterSavepointGroups,
    classifyErrorGroup,
    executeStatementsGroup,
    isolationLevelGroup,
  ];

export const createPgStateProviderConformanceContext = ({
  createStateProvider,
  withNonTransactionContext,
  withSavepoint,
  stateAdapterOptions,
}: Parameters<
  typeof createPgStateProviderConformanceCases
>[0]): PgStateProviderConformanceContext => {
  const tables = `${stateAdapterOptions?.schema ?? "public"}.${stateAdapterOptions?.tablePrefix ?? "queuert_"}`;
  const executeDdl = async (sql: string): Promise<void> => {
    const stateProvider = await createStateProvider();
    try {
      await executeStatement(stateProvider, sql);
    } finally {
      await stateProvider.close?.();
    }
  };
  let migrated: Promise<void> | undefined;
  const migrate = async (): Promise<void> => {
    migrated ??= (async () => {
      await using stateAdapter = createPgStateAdapter({
        ...stateAdapterOptions,
        stateProvider: await createStateProvider(),
      });
      await stateAdapter.migrateToLatest();
    })();
    return migrated;
  };

  return {
    createStateProvider,
    withNonTransactionContext,
    withSavepoint,
    createStateAdapter: async () => {
      await migrate();
      const stateProvider = await createStateProvider();
      const stateAdapter = createPgStateAdapter({ ...stateAdapterOptions, stateProvider });
      try {
        await executeStatement(
          stateProvider,
          `TRUNCATE ${tables}job_blocker, ${tables}job, ${tables}worker CASCADE`,
        );
      } catch (error) {
        await stateAdapter.close();
        throw error;
      }
      return stateAdapter;
    },
    withWritesFenced: async (fn) => {
      await migrate();
      await executeDdl(`DROP TABLE ${tables}schema_fence_v2`);
      try {
        return await fn();
      } finally {
        await executeDdl(`CREATE TABLE ${tables}schema_fence_v2 (id integer PRIMARY KEY)`);
      }
    },
  };
};

/**
 * Prepares the state adapter contract cases for a provider, ready to run. The cases are every state
 * adapter contract case, including those that hold two transactions open at once, run through
 * `createPgStateAdapter` over a provider, plus checks of the provider's `classifyError`,
 * `executeStatements` and transaction isolation level. The cases
 * migrate the schema once, before the first case, through a provider from `createStateProvider`;
 * each case then builds its own adapter over a new provider from it, with the tables cleared. The
 * test file owns the database and releases it itself. Works with any test runner.
 *
 * @param options - Suite configuration.
 *
 * @example
 * ```ts
 * import { afterAll, beforeAll, test } from "vitest";
 *
 * let pool: Pool;
 * const cases = createPgStateProviderConformanceCases({
 *   createStateProvider: async () => createPgPoolStateProvider({ pool }),
 *   withNonTransactionContext: async (fn) => {
 *     const poolClient = await pool.connect();
 *     try {
 *       return await fn({ poolClient });
 *     } finally {
 *       poolClient.release();
 *     }
 *   },
 * });
 * beforeAll(async () => {
 *   pool = new Pool({ connectionString });
 * });
 * afterAll(async () => pool.end());
 *
 * for (const conformanceCase of cases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run();
 *   });
 * }
 * ```
 */
export const createPgStateProviderConformanceCases = (options: {
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
  /**
   * Runs `fn` in a savepoint of `txCtx`'s transaction, opened the way the application opens one,
   * and passes it the savepoint's context: releases the savepoint when `fn` resolves and rolls it
   * back when `fn` throws, then rethrows. The suite checks that the provider's `onTransactionCommit` and
   * `onTransactionRollback` follow it; without it, those cases pass without checking anything.
   */
  withSavepoint?: <T>(txCtx: any, fn: (txCtx: any) => Promise<T>) => Promise<T>;
  /**
   * Options every adapter of the suite is created with, besides its provider, such as the
   * `schema`, `tablePrefix` and ID types your application configures. The suite migrates and
   * clears the tables they name.
   */
  stateAdapterOptions?: Omit<
    Parameters<typeof createPgStateAdapter<any, string, string>>[0],
    "stateProvider"
  >;
}): ConformanceTestCase[] =>
  toConformanceTestCases(
    pgStateProviderConformanceGroups,
    createPgStateProviderConformanceContext(options),
  );
