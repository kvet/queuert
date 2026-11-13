import {
  type MigratorConformanceContext,
  migrationStoreBaseGroups,
  migrationStoreLeaseGroups,
  migrationStoreTransactionalDdlGroups,
} from "@queuert/typed-sql";
import type { ConformanceTestCase } from "queuert/conformance";
import { type ConformanceGroup, toConformanceTestCases } from "queuert/conformance-internal";

import { createApplicationSqliteMigrationStore } from "../migration-store/migration-store.sqlite.ts";
import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";

/**
 * The context the {@link sqliteMigratorConformanceCases} run against. Get it from
 * {@link createSqliteMigratorConformanceContext} and pass it to every case unchanged.
 *
 * @experimental
 */
export type SqliteMigratorConformanceContext = MigratorConformanceContext;

export const sqliteMigratorConformanceGroups: ConformanceGroup<SqliteMigratorConformanceContext>[] =
  [
    ...migrationStoreBaseGroups,
    ...migrationStoreTransactionalDdlGroups,
    ...migrationStoreLeaseGroups,
  ];

/**
 * Prepares the context the {@link sqliteMigratorConformanceCases} run against, with
 * the store `createSqliteMigrator` uses over `stateProvider`. The cases create tables named
 * `conformance_<random>_*` and drop them when they end.
 *
 * @experimental
 * @param options - Context configuration.
 */
export const createSqliteMigratorConformanceContext = ({
  stateProvider,
}: {
  /** The provider under test, over a database the cases may create tables in. */
  stateProvider: SqliteStateProvider<any>;
}): SqliteMigratorConformanceContext => ({
  createMigrationStore: ({ migrationTableName, lockTableName }) =>
    createApplicationSqliteMigrationStore({
      stateProvider,
      migrationTableName,
      lockTableName,
    }),
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
      sql: `SELECT CAST(count(*) AS integer) AS count FROM ${table}`,
      params: [],
      paramTypes: {},
      columnTypes: { count: "number" },
      readOnly: true,
    })) as { count: number }[];
    return row.count;
  },
});

/**
 * Cases that check `createSqliteMigrator` over a provider: its history, transactional and
 * non-transactional migrations, reverts and lease. Run them one per test in your own test file
 * against a context from {@link createSqliteMigratorConformanceContext}. Works with any test runner.
 *
 * @experimental
 *
 * @example
 * ```ts
 * import { test } from "vitest";
 *
 * const context = createSqliteMigratorConformanceContext({
 *   stateProvider: createBetterSqlite3Provider({ db: new Database(":memory:") }),
 * });
 *
 * for (const conformanceCase of sqliteMigratorConformanceCases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run(context);
 *   });
 * }
 * ```
 */
export const sqliteMigratorConformanceCases: ConformanceTestCase<SqliteMigratorConformanceContext>[] =
  toConformanceTestCases(sqliteMigratorConformanceGroups);
