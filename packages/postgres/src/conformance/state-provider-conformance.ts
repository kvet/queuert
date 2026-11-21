import assert from "node:assert/strict";

import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  type SavepointConformanceContext,
  type SchemaFenceConformanceContext,
  toConformanceTestCases,
  stateAdapterAsyncGroups,
  stateAdapterAsyncLockWaitGroups,
  stateAdapterBaseGroups,
  stateAdapterSavepointGroups,
  stateAdapterConcurrentTransactionGroups,
  stateAdapterConcurrentTransactionLockWaitGroups,
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
const CONFLICT_TABLE = "public.queuert_conformance_conflict";

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
      name: "classifies a serialization failure as transaction_conflict",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();
        const write = async (sql: string, txCtx?: unknown) =>
          stateProvider.executeSql({
            txCtx,
            sql,
            params: [],
            paramTypes: {},
            columnTypes: {},
            readOnly: false,
          });

        try {
          await write(
            `CREATE TABLE IF NOT EXISTS ${CONFLICT_TABLE} (id integer PRIMARY KEY, value integer NOT NULL)`,
          );
          await write(`INSERT INTO ${CONFLICT_TABLE} VALUES (1, 0) ON CONFLICT (id) DO NOTHING`);
          let error: unknown;
          await assert.rejects(
            stateProvider.withTransaction(async (txCtx) => {
              await write("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ", txCtx);
              await write(`SELECT value FROM ${CONFLICT_TABLE} WHERE id = 1`, txCtx);
              await write(`UPDATE ${CONFLICT_TABLE} SET value = value + 1 WHERE id = 1`);
              error = await captureError(async () =>
                write(`UPDATE ${CONFLICT_TABLE} SET value = value + 1 WHERE id = 1`, txCtx),
              );
              throw error;
            }),
          );
          assert.deepEqual(stateProvider.classifyError({ error }), {
            kind: "transaction_conflict",
          });
        } finally {
          await write(`DROP TABLE IF EXISTS ${CONFLICT_TABLE}`);
          await stateProvider.close?.();
        }
      },
    },
    {
      name: "classifies a deadlock as transaction_conflict",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();
        const write = async (sql: string, txCtx?: unknown) =>
          stateProvider.executeSql({
            txCtx,
            sql,
            params: [],
            paramTypes: {},
            columnTypes: {},
            readOnly: false,
          });

        try {
          await write(
            `CREATE TABLE IF NOT EXISTS ${CONFLICT_TABLE} (id integer PRIMARY KEY, value integer NOT NULL)`,
          );
          await write(
            `INSERT INTO ${CONFLICT_TABLE} VALUES (1, 0), (2, 0) ON CONFLICT (id) DO NOTHING`,
          );
          const firstLocked = Promise.withResolvers<void>();
          const secondLocked = Promise.withResolvers<void>();
          const lockInOrder = async (
            first: number,
            second: number,
            locked: PromiseWithResolvers<void>,
            otherLocked: Promise<void>,
          ) =>
            stateProvider.withTransaction(async (txCtx) => {
              await write(
                `UPDATE ${CONFLICT_TABLE} SET value = value + 1 WHERE id = ${first}`,
                txCtx,
              );
              locked.resolve();
              await otherLocked;
              await write(
                `UPDATE ${CONFLICT_TABLE} SET value = value + 1 WHERE id = ${second}`,
                txCtx,
              );
            });

          const outcomes = await Promise.allSettled([
            lockInOrder(1, 2, firstLocked, secondLocked.promise),
            lockInOrder(2, 1, secondLocked, firstLocked.promise),
          ]);
          const errors = outcomes.flatMap((outcome) =>
            outcome.status === "rejected" ? [outcome.reason as unknown] : [],
          );
          assert.equal(errors.length, 1);
          assert.deepEqual(stateProvider.classifyError({ error: errors[0] }), {
            kind: "transaction_conflict",
          });
        } finally {
          await write(`DROP TABLE IF EXISTS ${CONFLICT_TABLE}`);
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
            executeSql(stateProvider, "SELECT missing_column FROM (SELECT 1) AS probe"),
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

export const isolationLevelGroup: ConformanceGroup<PgStateProviderConformanceContext> = {
  name: "isolationLevel",
  cases: [
    {
      name: "withTransaction runs no statement before the callback, so SET TRANSACTION takes effect",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();

        try {
          const rows = await stateProvider.withTransaction(async (txCtx) => {
            await stateProvider.executeSql({
              txCtx,
              sql: "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
              params: [],
              paramTypes: {},
              columnTypes: {},
              readOnly: false,
            });
            return executeSql(
              stateProvider,
              "SELECT current_setting('transaction_isolation') AS level",
              txCtx,
            );
          });
          assert.deepEqual([...rows], [{ level: "repeatable read" }]);
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
  ...stateAdapterAsyncLockWaitGroups,
  ...stateAdapterSchemaFenceGroups,
  ...stateAdapterConcurrentTransactionGroups,
  ...stateAdapterConcurrentTransactionLockWaitGroups,
  ...stateAdapterSchemaFenceConcurrentTransactionGroups,
];

export const pgStateProviderConformanceGroups: ConformanceGroup<PgStateProviderConformanceContext>[] =
  [
    ...pgStateAdapterConformanceGroups,
    ...stateAdapterSavepointGroups,
    classifyErrorGroup,
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
  const ddl = { params: [], paramTypes: {}, columnTypes: {}, readOnly: false };
  const executeDdl = async (sql: string): Promise<void> => {
    const stateProvider = await createStateProvider();
    try {
      await stateProvider.executeSql({ ...ddl, sql });
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
        await stateProvider.executeSql({
          ...ddl,
          sql: `TRUNCATE ${tables}job_blocker, ${tables}job, ${tables}worker CASCADE`,
        });
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
 * `createPgStateAdapter` over a provider, plus checks of the provider's `classifyError` and that its
 * `withTransaction` runs no statement before the callback, so the migrations' `SET TRANSACTION`
 * takes effect. The cases run at the isolation level of the provider's transactions; to cover
 * several levels, create the cases once per level over providers whose connections default to it,
 * and register each list under its own name, since the case titles repeat. The cases
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
