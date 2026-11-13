import { type MaybePromise, type Mode, andThen } from "@queuert/helpers/maybe-promise";
import {
  type MigratorConformanceContext,
  type SyncMigratorConformanceContext,
  migrationStoreBaseGroups,
  migrationStoreLeaseGroups,
  migrationStoreTransactionalDdlGroups,
  syncMigrationStoreBaseGroups,
  syncMigrationStoreTransactionalDdlGroups,
} from "@queuert/typed-sql/migration-store-conformance";
import type { MigrationStore } from "@queuert/typed-sql/migrator";
import type { ConformanceTestCase } from "queuert/conformance";
import { type ConformanceGroup, toConformanceTestCases } from "queuert/conformance-internal";
import { isSyncAdapter } from "queuert/internal";

import { createApplicationSqliteMigrationStore } from "../migration-store/migration-store.sqlite.ts";
import type {
  AnySqliteStateProvider,
  ModeSqliteStateProvider,
} from "../state-provider/state-provider.sqlite.ts";

/**
 * The context the {@link sqliteMigratorConformanceCases} and
 * {@link syncSqliteMigratorConformanceCases} run against, over a provider of either mode. Get it
 * from {@link createSqliteMigratorConformanceContext} and pass it to every case unchanged.
 *
 * @experimental
 */
export type SqliteMigratorConformanceContext = {
  /** Present on a context over a synchronous provider. */
  readonly sync?: true;
  /** Creates the store under test over the given history and lock tables. */
  createMigrationStore(tables: {
    migrationTableName: string;
    lockTableName: string;
  }): MigrationStore<any, Mode>;
  /** Runs a statement that returns no rows, inside the transaction when `txCtx` is given. */
  executeSql(sql: string, txCtx?: unknown): MaybePromise<void>;
  /** Counts the rows of a table. Fails when the table doesn't exist. */
  countRows(table: string): MaybePromise<number>;
};

const modeGroups = (
  asyncGroups: ConformanceGroup<MigratorConformanceContext>[],
  syncGroups: {
    name: string;
    cases: { name: string; run: (context: SyncMigratorConformanceContext) => void }[];
  }[],
): ConformanceGroup<SqliteMigratorConformanceContext>[] =>
  asyncGroups.map((group, groupIndex) => ({
    name: group.name,
    cases: group.cases.map((asyncCase, caseIndex) => {
      const syncCase = syncGroups[groupIndex].cases[caseIndex];
      return {
        name: asyncCase.name,
        run: async (context: SqliteMigratorConformanceContext) => {
          if (isSyncAdapter(context)) {
            syncCase.run(context as SyncMigratorConformanceContext);
            return;
          }
          await asyncCase.run(context as MigratorConformanceContext);
        },
      };
    }),
  }));

export const sqliteMigratorConformanceGroups: ConformanceGroup<SqliteMigratorConformanceContext>[] =
  [
    ...modeGroups(migrationStoreBaseGroups, syncMigrationStoreBaseGroups),
    ...modeGroups(migrationStoreTransactionalDdlGroups, syncMigrationStoreTransactionalDdlGroups),
    ...migrationStoreLeaseGroups.map((group) => ({
      name: group.name,
      cases: group.cases.map((leaseCase) => ({
        name: leaseCase.name,
        mode: "async" as const,
        run: async (context: SqliteMigratorConformanceContext) =>
          leaseCase.run(context as MigratorConformanceContext),
      })),
    })),
  ];

const countRowsStatement = (table: string) => ({
  sql: `SELECT CAST(count(*) AS integer) AS count FROM ${table}`,
  params: [],
  paramTypes: {},
  columnTypes: { count: "number" as const },
  readOnly: true,
});

/**
 * Prepares the context the {@link sqliteMigratorConformanceCases} or
 * {@link syncSqliteMigratorConformanceCases} run against, with the store `createSqliteMigrator`
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
  stateProvider: AnySqliteStateProvider<any>;
}): SqliteMigratorConformanceContext => {
  const provider: ModeSqliteStateProvider<any> = stateProvider;
  const context: SqliteMigratorConformanceContext = {
    createMigrationStore: ({ migrationTableName, lockTableName }) =>
      createApplicationSqliteMigrationStore({
        stateProvider: provider,
        migrationTableName,
        lockTableName,
      }),
    executeSql: (sql, txCtx) =>
      andThen(
        provider.executeSql({
          txCtx,
          sql,
          params: [],
          paramTypes: {},
          columnTypes: {},
          readOnly: false,
        }),
        () => undefined,
      ),
    countRows: (table) =>
      andThen(
        provider.executeSql(countRowsStatement(table)),
        (rows) => (rows as { count: number }[])[0].count,
      ),
  };
  return isSyncAdapter(stateProvider) ? { sync: true, ...context } : context;
};

/**
 * Cases that check `createSqliteMigrator` over an asynchronous provider: its history,
 * transactional and non-transactional migrations, reverts and lease. Run them one per test in your
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
 *   stateProvider: createKyselySqliteStateProvider({ db }),
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
  toConformanceTestCases(sqliteMigratorConformanceGroups, "async");

/**
 * The {@link sqliteMigratorConformanceCases} for a `SyncSqliteStateProvider`. The
 * synchronous migrator takes no lease, so these cases leave out the lease checks.
 *
 * @experimental
 */
export const syncSqliteMigratorConformanceCases: ConformanceTestCase<SqliteMigratorConformanceContext>[] =
  toConformanceTestCases(sqliteMigratorConformanceGroups, "sync");
