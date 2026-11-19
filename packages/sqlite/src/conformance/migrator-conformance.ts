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

export type SqliteMigratorConformanceContext = MigratorConformanceContext<Mode>;

export const sqliteMigratorConformanceGroups: ConformanceGroup<SqliteMigratorConformanceContext>[] =
  [
    ...migrationStoreBaseGroups,
    ...migrationStoreTransactionalDdlGroups,
    ...migrationStoreLeaseGroups,
  ];

export const createSqliteMigratorConformanceContext = ({
  mode,
  createStateProvider,
}: Parameters<
  typeof createSqliteMigratorConformanceCases
>[0]): SqliteMigratorConformanceContext => {
  let stateProvider: SqliteStateProvider<any, Mode> | undefined;
  const provider = (): SqliteStateProvider<any, Mode> => {
    if (stateProvider !== undefined) return stateProvider;
    const created: SqliteStateProvider<any, Mode> = createStateProvider();
    if ((created.sync === true) !== (mode === "sync")) {
      throw new TypeError(
        `createSqliteMigratorConformanceCases: createStateProvider returned a ${created.sync === true ? "sync" : "async"} provider, but mode is "${mode}"`,
      );
    }
    return (stateProvider = created);
  };
  return {
    createMigrationStore: ({ migrationTableName, lockTableName }) => {
      const store = createSqliteMigratorStore({
        stateProvider: provider(),
        migrationTableName,
        lockTableName,
      });
      return provider().sync === true ? { sync: true, ...store } : store;
    },
    executeSql: (sql, txCtx) =>
      runInModeOf(
        provider(),
        syncAsync(function* () {
          yield* step(
            provider().executeSql({
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
        provider(),
        syncAsync(function* () {
          const rows = yield* step(
            provider().executeSql({
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
 * Prepares the cases that check `createSqliteMigrator` over the provider in its mode (its history,
 * transactional and non-transactional migrations, reverts and, over an asynchronous provider, its
 * lease), ready to run with the store `createSqliteMigrator` uses over the provider. The synchronous
 * migrator takes no lease, so the lease cases pass without running over a provider with
 * `sync: true`. The cases create tables named `conformance_<random>_*` and drop them when they end.
 * Works with any test runner.
 *
 * @experimental
 * @param options - Suite configuration.
 *
 * @example
 * ```ts
 * import { test } from "vitest";
 *
 * const db = new Database(":memory:");
 * const cases = createSqliteMigratorConformanceCases({
 *   mode: "async",
 *   createStateProvider: () => createBetterSqlite3Provider({ db }),
 * });
 *
 * for (const conformanceCase of cases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run();
 *   });
 * }
 * ```
 */
export const createSqliteMigratorConformanceCases = (
  options:
    | {
        /** The provider's mode: `"sync"` for a {@link SqliteStateProvider} with `sync: true`. */
        mode: "sync";
        /**
         * Creates the provider under test, over a database the cases may create tables in. Called
         * once, when the first case runs.
         */
        createStateProvider: () => SqliteStateProvider<any, "sync">;
      }
    | {
        /** The provider's mode: `"async"` for a {@link SqliteStateProvider} without `sync: true`. */
        mode: "async";
        /**
         * Creates the provider under test, over a database the cases may create tables in. Called
         * once, when the first case runs.
         */
        createStateProvider: () => SqliteStateProvider<any>;
      },
): ConformanceTestCase[] =>
  toConformanceTestCases(
    sqliteMigratorConformanceGroups,
    createSqliteMigratorConformanceContext(options),
  );
