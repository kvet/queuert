import { step, syncAsync, type Mode } from "@queuert/sync-async";
import {
  type MigratorConformanceContext,
  migrationStoreBaseGroups,
  migrationStoreLeaseGroups,
  migrationStoreTransactionalDdlGroups,
} from "@queuert/typed-sql";
import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  runInModeOf,
  toConformanceTestCases,
} from "queuert/conformance-internal";

import { createSqliteMigratorStore } from "../migration-store/migration-store.sqlite.ts";
import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";

/**
 * The context the {@link sqliteMigratorConformanceCases} run against, over a provider of either mode. Get it
 * from {@link createSqliteMigratorConformanceContext} and pass it to every case unchanged.
 *
 * @experimental
 */
export type SqliteMigratorConformanceContext = MigratorConformanceContext<Mode>;

export const sqliteMigratorConformanceGroups: ConformanceGroup<SqliteMigratorConformanceContext>[] =
  [
    ...migrationStoreBaseGroups,
    ...migrationStoreTransactionalDdlGroups,
    ...migrationStoreLeaseGroups,
  ];

/**
 * Prepares the context the {@link sqliteMigratorConformanceCases} run against, with the store `createSqliteMigrator`
 * uses over `stateProvider`, in the provider's mode. The cases create tables named
 * `conformance_<random>_*` and drop them when they end.
 *
 * @experimental
 * @param options - Context configuration.
 */
export const createSqliteMigratorConformanceContext = ({
  stateProvider,
}: {
  /** The provider under test, over a database the cases may create tables in. */
  stateProvider: SqliteStateProvider<any, Mode>;
}): SqliteMigratorConformanceContext => {
  const provider: SqliteStateProvider<any, Mode> = stateProvider;
  return {
    createMigrationStore: ({ migrationTableName, lockTableName }) => {
      const store = createSqliteMigratorStore({
        stateProvider: provider,
        migrationTableName,
        lockTableName,
      });
      return stateProvider.sync === true ? { sync: true, ...store } : store;
    },
    executeSql: (sql, txCtx) =>
      runInModeOf(
        provider,
        syncAsync(function* () {
          yield* step(
            provider.executeSql({
              txCtx,
              sql,
              params: [],
              paramTypes: {},
              columnTypes: {},
              readOnly: false,
            }),
          );
        }),
      ),
    countRows: (table) =>
      runInModeOf(
        provider,
        syncAsync(function* () {
          const rows = yield* step(
            provider.executeSql({
              sql: `SELECT CAST(count(*) AS integer) AS count FROM ${table}`,
              params: [],
              paramTypes: {},
              columnTypes: { count: "number" },
              readOnly: true,
            }),
          );
          return (rows as { count: number }[])[0].count;
        }),
      ),
  };
};

/**
 * Cases that check `createSqliteMigrator` over the provider in its mode: its history,
 * transactional and non-transactional migrations, reverts and, over an asynchronous provider, its
 * lease. The synchronous migrator takes no lease, so the lease cases pass without running over a
 * provider with `sync: true`. Run them one per test in your
 * own test file against a context from {@link createSqliteMigratorConformanceContext}. Works with
 * any test runner.
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
