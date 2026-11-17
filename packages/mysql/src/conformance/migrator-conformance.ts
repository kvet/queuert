import {
  type MigratorConformanceContext,
  migrationStoreBaseGroups,
  migrationStoreLeaseGroups,
} from "@queuert/typed-sql";
import type { ConformanceTestCase } from "queuert/conformance";
import { type ConformanceGroup, toConformanceTestCases } from "queuert/conformance-internal";

import { createMysqlMigratorStore } from "../migration-store/migration-store.mysql.ts";
import type { MysqlStateProvider } from "../state-provider/state-provider.mysql.ts";

/**
 * The context the cases from {@link createMysqlMigratorConformanceContext} run against. Pass it
 * to every case unchanged.
 *
 * @experimental
 */
export type MysqlMigratorConformanceContext = MigratorConformanceContext;

export const mysqlMigratorConformanceGroups: ConformanceGroup<MysqlMigratorConformanceContext>[] = [
  ...migrationStoreBaseGroups,
  ...migrationStoreLeaseGroups,
];

/**
 * Prepares the cases that check `createMysqlMigrator` over a provider (its history, transactional and
 * non-transactional migrations, reverts and lease) and the context they run against, with the
 * store `createMysqlMigrator` uses over the provider. The cases create tables named
 * `conformance_<random>_*` in the connection's database and drop them when they end.
 *
 * @experimental
 * @param options - Context configuration.
 *
 * @example
 * ```ts
 * import { afterAll, beforeAll, test } from "vitest";
 *
 * let pool: Pool;
 * const { context, cases } = createMysqlMigratorConformanceContext({
 *   createStateProvider: () => createMysql2PoolStateProvider({ pool }),
 * });
 * beforeAll(() => {
 *   pool = createPool(connectionOptions);
 * });
 * afterAll(async () => pool.end());
 *
 * for (const conformanceCase of cases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run(context);
 *   });
 * }
 * ```
 */
export const createMysqlMigratorConformanceContext = ({
  createStateProvider,
}: {
  /**
   * Creates the provider under test, over a database the cases may create tables in. Called once,
   * when the first case runs.
   */
  createStateProvider: () => MysqlStateProvider<any>;
}): {
  context: MysqlMigratorConformanceContext;
  cases: ConformanceTestCase<MysqlMigratorConformanceContext>[];
} => {
  let stateProvider: MysqlStateProvider<any> | undefined;
  const provider = (): MysqlStateProvider<any> => (stateProvider ??= createStateProvider());
  return {
    context: {
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
    },
    cases: toConformanceTestCases(mysqlMigratorConformanceGroups),
  };
};
