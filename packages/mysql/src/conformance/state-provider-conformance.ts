import assert from "node:assert/strict";

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

/**
 * The context the {@link mysqlStateProviderConformanceCases} run against. Get it from
 * {@link createMysqlStateProviderConformanceContext} and pass it to every case unchanged.
 *
 * @experimental
 */
export type MysqlStateProviderConformanceContext = SchemaFenceConformanceContext &
  SavepointConformanceContext & {
    createStateProvider: () => Promise<MysqlStateProvider<any>>;
  };

export const isolationLevelGroup: ConformanceGroup<MysqlStateProviderConformanceContext> = {
  name: "isolationLevel",
  cases: [
    {
      name: "withTransaction opens transactions at READ COMMITTED",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();
        const query = async (sql: string, txCtx?: unknown) =>
          stateProvider.executeSql({
            txCtx,
            sql,
            params: [],
            paramTypes: {},
            columnTypes: {},
            readOnly: false,
          });

        try {
          await query(
            "CREATE TABLE IF NOT EXISTS queuert_conformance_probe (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB",
          );
          const rows = await stateProvider.withTransaction(async (txCtx) => {
            await query("SELECT id FROM queuert_conformance_probe LIMIT 1 FOR UPDATE", txCtx);
            return query(
              "SELECT trx_isolation_level AS level FROM information_schema.innodb_trx WHERE trx_mysql_thread_id = CONNECTION_ID()",
              txCtx,
            );
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
    isolationLevelGroup,
  ];

/**
 * Prepares the context the {@link mysqlStateProviderConformanceCases} run against: migrates the
 * schema once through a provider from `createStateProvider`. Each case then builds its own adapter
 * over a new provider from it, with the tables cleared.
 *
 * @param options - Context configuration.
 *
 * @experimental
 */
export const createMysqlStateProviderConformanceContext = async ({
  createStateProvider,
  dialect,
  withNonTransactionContext,
  withSavepoint,
  stateAdapterOptions,
}: {
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
}): Promise<MysqlStateProviderConformanceContext> => {
  const tables = `${stateAdapterOptions?.schema === undefined ? "" : `${stateAdapterOptions.schema}.`}${stateAdapterOptions?.tablePrefix ?? "queuert_"}`;
  const executeStatements = async (statements: string[]): Promise<void> => {
    const stateProvider = await createStateProvider();
    try {
      for (const sql of statements) {
        await stateProvider.executeSql({
          sql,
          params: [],
          paramTypes: {},
          columnTypes: {},
          readOnly: false,
        });
      }
    } finally {
      await stateProvider.close?.();
    }
  };

  {
    await using stateAdapter = createMysqlStateAdapter({
      ...stateAdapterOptions,
      stateProvider: await createStateProvider(),
      dialect,
    });
    await stateAdapter.migrateToLatest();
  }

  return {
    createStateProvider,
    withNonTransactionContext,
    withSavepoint,
    createStateAdapter: async () => {
      await executeStatements([
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
      await executeStatements([`DROP TABLE ${tables}schema_fence_v1`]);
      try {
        return await fn();
      } finally {
        await executeStatements([
          `CREATE TABLE ${tables}schema_fence_v1 (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`,
        ]);
      }
    },
  };
};

/**
 * Every state adapter contract case, run through `createMysqlStateAdapter` over a provider. Run
 * them one per test in your own test file against a context from
 * {@link createMysqlStateProviderConformanceContext}. Works with any test runner.
 *
 * @experimental
 */
export const mysqlStateProviderConformanceCases: ConformanceTestCase<MysqlStateProviderConformanceContext>[] =
  toConformanceTestCases(mysqlStateProviderConformanceGroups);
