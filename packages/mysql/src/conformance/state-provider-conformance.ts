import assert from "node:assert/strict";

import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  type SavepointConformanceContext,
  type SchemaFenceConformanceContext,
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

        try {
          const rows = await stateProvider.withTransaction(async (txCtx) => {
            const query = async (sql: string) =>
              stateProvider.executeSql({
                txCtx,
                sql,
                params: [],
                paramTypes: {},
                columnTypes: {},
                readOnly: false,
              });
            await query("SELECT id FROM queuert_job LIMIT 1 FOR UPDATE");
            return query(
              "SELECT trx_isolation_level AS level FROM information_schema.innodb_trx WHERE trx_mysql_thread_id = CONNECTION_ID()",
            );
          });
          assert.equal(rows.length, 1);
          assert.equal((rows[0] as { level: unknown }).level, "READ COMMITTED");
        } finally {
          await stateProvider.close?.();
        }
      },
    },
  ],
};

export const mysqlStateProviderConformanceGroups: ConformanceGroup<MysqlStateProviderConformanceContext>[] =
  [
    ...stateAdapterBaseGroups,
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
}: {
  /** Creates the provider under test, over a database the suite may create tables in. */
  createStateProvider: () => Promise<MysqlStateProvider<any>>;
  /** The server the provider connects to. */
  dialect: "mysql" | "mariadb";
  /** Runs the callback with a context of the provider's shape that is not inside a transaction. */
  withNonTransactionContext: <T>(fn: (txCtx: any) => Promise<T>) => Promise<T>;
  /** Runs `fn` in a savepoint of `txCtx`'s transaction, opened the way the application opens one. */
  withSavepoint?: <T>(txCtx: any, fn: (txCtx: any) => Promise<T>) => Promise<T>;
}): Promise<MysqlStateProviderConformanceContext> => {
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
        "DELETE FROM queuert_job_blocker",
        "DELETE FROM queuert_job",
        "DELETE FROM queuert_worker",
      ]);
      return createMysqlStateAdapter({ stateProvider: await createStateProvider(), dialect });
    },
    withWritesFenced: async (fn) => {
      await executeStatements(["DROP TABLE queuert_schema_fence_v1"]);
      try {
        return await fn();
      } finally {
        await executeStatements([
          "CREATE TABLE queuert_schema_fence_v1 (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB",
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
