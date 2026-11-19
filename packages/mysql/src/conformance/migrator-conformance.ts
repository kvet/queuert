import {
  type MigratorConformanceContext,
  migrationStoreBaseGroups,
  migrationStoreLeaseGroups,
} from "@queuert/typed-sql";
import type { ConformanceTestCase } from "queuert/conformance";
import { type ConformanceGroup, toConformanceTestCases } from "queuert/conformance-internal";

import { createMysqlMigratorStore } from "../migration-store/migration-store.mysql.ts";
import type { MysqlStateProvider } from "../state-provider/state-provider.mysql.ts";

export type MysqlMigratorConformanceContext = MigratorConformanceContext;

export const mysqlMigratorConformanceGroups: ConformanceGroup<MysqlMigratorConformanceContext>[] = [
  ...migrationStoreBaseGroups,
  ...migrationStoreLeaseGroups,
];

export const createMysqlMigratorConformanceContext = ({
  createStateProvider,
}: Parameters<typeof createMysqlMigratorConformanceCases>[0]): MysqlMigratorConformanceContext => {
  let stateProvider: MysqlStateProvider<any> | undefined;
  const provider = (): MysqlStateProvider<any> => (stateProvider ??= createStateProvider());
  return {
    createMigrationStore: ({ migrationTableName, lockTableName }) =>
      createMysqlMigratorStore({ stateProvider: provider(), migrationTableName, lockTableName }),
    executeSql: async (sql, txCtx) => {
      await provider().executeSql({
        txCtx,
        sql,
        params: [],
        paramTypes: {},
        columnTypes: {},
        readOnly: false,
      });
    },
    countRows: async (table) => {
      const [row] = (await provider().executeSql({
        sql: `SELECT COUNT(*) AS count FROM ${table}`,
        params: [],
        paramTypes: {},
        columnTypes: {},
        readOnly: true,
      })) as { count: unknown }[];
      return Number(row.count);
    },
  };
};

/**
 * Prepares the cases that check `createMysqlMigrator` over a provider (its history, transactional
 * and non-transactional migrations, reverts and lease), ready to run with the store
 * `createMysqlMigrator` uses over the provider. The cases create tables named
 * `conformance_<random>_*` in the connection's database and drop them when they end.
 *
 * @experimental
 * @param options - Suite configuration.
 *
 * @example
 * ```ts
 * import { afterAll, beforeAll, test } from "vitest";
 *
 * let pool: Pool;
 * const cases = createMysqlMigratorConformanceCases({
 *   createStateProvider: () => createMysql2PoolStateProvider({ pool }),
 * });
 * beforeAll(() => {
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
 */
export const createMysqlMigratorConformanceCases = (options: {
  /**
   * Creates the provider under test, over a database the cases may create tables in. Called once,
   * when the first case runs.
   */
  createStateProvider: () => MysqlStateProvider<any>;
}): ConformanceTestCase[] =>
  toConformanceTestCases(
    mysqlMigratorConformanceGroups,
    createMysqlMigratorConformanceContext(options),
  );
