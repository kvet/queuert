import {
  type MigratorConformanceContext,
  migrationStoreBaseGroups,
  migrationStoreLeaseGroups,
} from "@queuert/typed-sql";
import type { ConformanceTestCase } from "queuert/conformance";
import { type ConformanceGroup, toConformanceTestCases } from "queuert/conformance-internal";

import { createApplicationMysqlMigrationStore } from "../migration-store/migration-store.mysql.ts";
import type { MysqlStateProvider } from "../state-provider/state-provider.mysql.ts";

/**
 * The context the {@link mysqlMigratorConformanceCases} run against. Get it from
 * {@link createMysqlMigratorConformanceContext} and pass it to every case unchanged.
 *
 * @experimental
 */
export type MysqlMigratorConformanceContext = MigratorConformanceContext;

export const mysqlMigratorConformanceGroups: ConformanceGroup<MysqlMigratorConformanceContext>[] = [
  ...migrationStoreBaseGroups,
  ...migrationStoreLeaseGroups,
];

/**
 * Prepares the context the {@link mysqlMigratorConformanceCases} run against, with
 * the store `createMysqlMigrator` uses over `stateProvider`. The cases create tables named
 * `conformance_<random>_*` in the connection's database and drop them when they end.
 *
 * @experimental
 * @param options - Context configuration.
 */
export const createMysqlMigratorConformanceContext = ({
  stateProvider,
}: {
  /** The provider under test, over a database the cases may create tables in. */
  stateProvider: MysqlStateProvider<any>;
}): MysqlMigratorConformanceContext => ({
  createMigrationStore: ({ migrationTableName, lockTableName }) =>
    createApplicationMysqlMigrationStore({ stateProvider, migrationTableName, lockTableName }),
  executeSql: async (sql, txCtx) => {
    await stateProvider.executeSql({
      txCtx,
      sql,
      params: [],
      paramTypes: {},
      columnTypes: {},
      readOnly: false,
    });
  },
  countRows: async (table) => {
    const [row] = (await stateProvider.executeSql({
      sql: `SELECT COUNT(*) AS count FROM ${table}`,
      params: [],
      paramTypes: {},
      columnTypes: {},
      readOnly: true,
    })) as { count: unknown }[];
    return Number(row.count);
  },
});

/**
 * Cases that check `createMysqlMigrator` over a provider: its history, transactional and
 * non-transactional migrations, reverts and lease. Run them one per test in your own test file
 * against a context from {@link createMysqlMigratorConformanceContext}. Works with any test runner.
 *
 * @experimental
 *
 * @example
 * ```ts
 * import { afterAll, test } from "vitest";
 *
 * const pool = createPool({ ...connectionOptions, database: "app" });
 * const context = createMysqlMigratorConformanceContext({
 *   stateProvider: createMysql2PoolStateProvider({ pool }),
 * });
 * afterAll(async () => pool.end());
 *
 * for (const conformanceCase of mysqlMigratorConformanceCases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run(context);
 *   });
 * }
 * ```
 */
export const mysqlMigratorConformanceCases: ConformanceTestCase<MysqlMigratorConformanceContext>[] =
  toConformanceTestCases(mysqlMigratorConformanceGroups);
