import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers/sleep";
import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  type SavepointConformanceContext,
  type SchemaFenceConformanceContext,
  stateAdapterAsyncGroups,
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
  stateAdapterSavepointGroups,
  stateAdapterSchemaFenceConcurrentTransactionGroups,
  stateAdapterSchemaFenceGroups,
  toConformanceTestCases,
} from "queuert/conformance-internal";

import { createMysqlStateAdapter } from "../state-adapter/state-adapter.mysql.ts";
import type { MysqlStateProvider } from "../state-provider/state-provider.mysql.ts";

export type MysqlStateProviderConformanceContext = SchemaFenceConformanceContext &
  SavepointConformanceContext & {
    createStateProvider: () => Promise<MysqlStateProvider<any>>;
  };

const textStatement = (sql: string) => ({
  sql,
  params: [],
  paramTypes: {},
  columnTypes: {},
  readOnly: false,
});

export const executeStatementsGroup: ConformanceGroup<MysqlStateProviderConformanceContext> = {
  name: "executeStatements",
  cases: [
    {
      name: "executeStatements returns one row array per statement in statement order",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();
        try {
          const results = await stateProvider.executeStatements({
            statements: [
              textStatement("SELECT 1 AS value"),
              textStatement("DO 0"),
              { ...textStatement("SELECT ? AS value"), params: [2] },
              textStatement("SELECT 3 AS value UNION ALL SELECT 4"),
            ],
          });
          assert.equal(results.length, 4);
          assert.deepEqual(
            results.map((rows) => (rows as { value: unknown }[]).map((row) => Number(row.value))),
            [[1], [], [2], [3, 4]],
          );
        } finally {
          await stateProvider.close?.();
        }
      },
    },
    {
      name: "executeStatements resolves an empty batch to no results",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();
        try {
          assert.deepEqual(await stateProvider.executeStatements({ statements: [] }), []);
          await stateProvider.withTransaction(async (txCtx) => {
            assert.deepEqual(await stateProvider.executeStatements({ txCtx, statements: [] }), []);
          });
        } finally {
          await stateProvider.close?.();
        }
      },
    },
    {
      name: "executeStatements runs a single statement inside and outside a transaction",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();
        try {
          const outside = await stateProvider.executeStatements({
            statements: [textStatement("SELECT 1 AS value")],
          });
          const inside = await stateProvider.withTransaction(async (txCtx) =>
            stateProvider.executeStatements({
              txCtx,
              statements: [textStatement("SELECT 1 AS value")],
            }),
          );
          for (const results of [outside, inside]) {
            assert.equal(results.length, 1);
            assert.deepEqual(
              (results[0] as { value: unknown }[]).map((row) => Number(row.value)),
              [1],
            );
          }
        } finally {
          await stateProvider.close?.();
        }
      },
    },
    {
      name: "executeStatements without a transaction runs the batch in order",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();
        const orderTable = "queuert_conformance_batch_order";
        try {
          const results = await stateProvider.executeStatements({
            statements: [
              textStatement(`DROP TABLE IF EXISTS ${orderTable}`),
              textStatement(
                `CREATE TABLE ${orderTable} (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`,
              ),
              textStatement(`INSERT INTO ${orderTable} (id) VALUES (1)`),
              textStatement(`SELECT COUNT(*) AS count FROM ${orderTable}`),
              textStatement(`INSERT INTO ${orderTable} (id) VALUES (2)`),
              textStatement(`SELECT COUNT(*) AS count FROM ${orderTable}`),
            ],
          });
          assert.deepEqual(
            [results[3], results[5]].map((rows) => Number((rows as { count: unknown }[])[0].count)),
            [1, 2],
          );
        } finally {
          await stateProvider.executeStatements({
            statements: [textStatement(`DROP TABLE IF EXISTS ${orderTable}`)],
          });
          await stateProvider.close?.();
        }
      },
    },
    {
      name: "executeStatements rejects with the failing statement's error and the transaction rolls back",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();
        const probeTable = "queuert_conformance_batch_probe";
        const missingTable = "queuert_conformance_batch_missing";
        try {
          await stateProvider.executeStatements({
            statements: [
              textStatement(`DROP TABLE IF EXISTS ${missingTable}`),
              textStatement(`DROP TABLE IF EXISTS ${missingTable}_later`),
              textStatement(
                `CREATE TABLE IF NOT EXISTS ${probeTable} (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`,
              ),
              textStatement(`DELETE FROM ${probeTable}`),
            ],
          });
          await assert.rejects(
            stateProvider.withTransaction(async (txCtx) =>
              stateProvider.executeStatements({
                txCtx,
                statements: [
                  textStatement(`INSERT INTO ${probeTable} (id) VALUES (1)`),
                  textStatement(`SELECT id FROM ${missingTable}`),
                  textStatement(`INSERT INTO ${probeTable} (id) VALUES (2)`),
                  textStatement(`SELECT id FROM ${missingTable}_later`),
                ],
              }),
            ),
            (error: unknown) => {
              const classified = stateProvider.classifyError({ error });
              assert.ok(classified !== undefined);
              assert.equal(classified.kind, "undefined_table");
              assert.ok(classified.tableName.endsWith(`.${missingTable}`));
              return true;
            },
          );
          const [rows] = await stateProvider.executeStatements({
            statements: [textStatement(`SELECT COUNT(*) AS count FROM ${probeTable}`)],
          });
          assert.equal(Number((rows as { count: unknown }[])[0].count), 0);
        } finally {
          await stateProvider.executeStatements({
            statements: [textStatement(`DROP TABLE IF EXISTS ${probeTable}`)],
          });
          await stateProvider.close?.();
        }
      },
    },
  ],
};

export const isolationLevelGroup: ConformanceGroup<MysqlStateProviderConformanceContext> = {
  name: "isolationLevel",
  cases: [
    {
      name: "withTransaction opens transactions at READ COMMITTED",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();
        const query = async (sql: string, txCtx?: unknown) => {
          const [rows] = await stateProvider.executeStatements({
            txCtx,
            statements: [textStatement(sql)],
          });
          return rows;
        };

        try {
          await query(
            "CREATE TABLE IF NOT EXISTS queuert_conformance_probe (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB",
          );
          const rows = await stateProvider.withTransaction(async (txCtx) => {
            await query("SELECT id FROM queuert_conformance_probe LIMIT 1 FOR UPDATE", txCtx);
            // InnoDB serves innodb_trx from a server-wide cache refreshed at most every 100 ms,
            // so a read by another session just before this one can hide this transaction.
            for (let attempt = 1; ; attempt++) {
              const trxRows = await query(
                "SELECT trx_isolation_level AS level FROM information_schema.innodb_trx WHERE trx_mysql_thread_id = CONNECTION_ID()",
                txCtx,
              );
              if (trxRows.length > 0 || attempt === 10) return trxRows;
              await sleep(150);
            }
          });
          assert.equal(rows.length, 1);
          assert.equal((rows[0] as { level: unknown }).level, "READ COMMITTED");
        } finally {
          await query("DROP TABLE IF EXISTS queuert_conformance_probe");
          await stateProvider.close?.();
        }
      },
    },
  ],
};

export const mysqlStateProviderConformanceGroups: ConformanceGroup<MysqlStateProviderConformanceContext>[] =
  [
    ...stateAdapterBaseGroups,
    ...stateAdapterAsyncGroups,
    ...stateAdapterSchemaFenceGroups,
    ...stateAdapterConcurrentTransactionGroups,
    ...stateAdapterSchemaFenceConcurrentTransactionGroups,
    ...stateAdapterSavepointGroups,
    executeStatementsGroup,
    isolationLevelGroup,
  ];

export const createMysqlStateProviderConformanceContext = ({
  createStateProvider,
  dialect,
  withNonTransactionContext,
  withSavepoint,
  stateAdapterOptions,
}: Parameters<
  typeof createMysqlStateProviderConformanceCases
>[0]): MysqlStateProviderConformanceContext => {
  const tables = `${stateAdapterOptions?.schema === undefined ? "" : `${stateAdapterOptions.schema}.`}${stateAdapterOptions?.tablePrefix ?? "queuert_"}`;
  const runStatements = async (statements: string[]): Promise<void> => {
    const stateProvider = await createStateProvider();
    try {
      await stateProvider.executeStatements({ statements: statements.map(textStatement) });
    } finally {
      await stateProvider.close?.();
    }
  };

  let migrated: Promise<void> | undefined;
  const migrate = async (): Promise<void> => {
    migrated ??= (async () => {
      await using stateAdapter = createMysqlStateAdapter({
        ...stateAdapterOptions,
        stateProvider: await createStateProvider(),
        dialect,
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
      await runStatements([
        `DELETE FROM ${tables}job_blocker`,
        `DELETE FROM ${tables}job`,
        `DELETE FROM ${tables}worker`,
      ]);
      return createMysqlStateAdapter({
        ...stateAdapterOptions,
        stateProvider: await createStateProvider(),
        dialect,
      });
    },
    withWritesFenced: async (fn) => {
      await migrate();
      await runStatements([`DROP TABLE ${tables}schema_fence_v2`]);
      try {
        return await fn();
      } finally {
        await runStatements([
          `CREATE TABLE ${tables}schema_fence_v2 (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`,
        ]);
      }
    },
  };
};

/**
 * Prepares the state adapter contract cases for a provider, ready to run. The cases are every state
 * adapter contract case run through `createMysqlStateAdapter` over a provider. The cases migrate
 * the schema once, before the first case, through a provider from `createStateProvider`; each case
 * then builds its own adapter over a new provider from it, with the tables cleared. Works with any
 * test runner.
 *
 * @param options - Suite configuration.
 *
 * @example
 * ```ts
 * import { afterAll, beforeAll, test } from "vitest";
 *
 * let pool: Pool;
 * const cases = createMysqlStateProviderConformanceCases({
 *   createStateProvider: async () => createMysql2PoolStateProvider({ pool }),
 *   dialect: "mysql",
 *   withNonTransactionContext: async (fn) => {
 *     const connection = await pool.getConnection();
 *     try {
 *       return await fn({ connection });
 *     } finally {
 *       connection.release();
 *     }
 *   },
 * });
 * beforeAll(async () => {
 *   pool = createPool(connectionOptions);
 * });
 * afterAll(async () => pool.end());
 *
 * for (const conformanceCase of cases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run();
 *   });
 * }
 * ```
 *
 * @experimental
 */
export const createMysqlStateProviderConformanceCases = (options: {
  /** Creates the provider under test, over a database the suite may create tables in. */
  createStateProvider: () => Promise<MysqlStateProvider<any>>;
  /** The server the provider connects to. */
  dialect: "mysql" | "mariadb";
  /** Runs the callback with a context of the provider's shape that is not inside a transaction. */
  withNonTransactionContext: <T>(fn: (txCtx: any) => Promise<T>) => Promise<T>;
  /** Runs `fn` in a savepoint of `txCtx`'s transaction, opened the way the application opens one. */
  withSavepoint?: <T>(txCtx: any, fn: (txCtx: any) => Promise<T>) => Promise<T>;
  /**
   * Options every adapter of the suite is created with, besides its provider and `dialect`, such
   * as the `schema`, `tablePrefix` and ID types your application configures. The suite migrates
   * and clears the tables they name.
   */
  stateAdapterOptions?: Omit<
    Parameters<typeof createMysqlStateAdapter<any, string, string>>[0],
    "stateProvider" | "dialect"
  >;
}): ConformanceTestCase[] =>
  toConformanceTestCases(
    mysqlStateProviderConformanceGroups,
    createMysqlStateProviderConformanceContext(options),
  );
