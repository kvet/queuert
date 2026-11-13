import {
  type MigratorConformanceContext,
  migrationStoreBaseGroups,
  migrationStoreLeaseGroups,
  migrationStoreTransactionalDdlGroups,
} from "@queuert/typed-sql";
import type { ConformanceTestCase } from "queuert/conformance";
import { type ConformanceGroup, toConformanceTestCases } from "queuert/conformance-internal";

import { createApplicationPgMigrationStore } from "../migration-store/migration-store.pg.ts";
import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";

/**
 * The context the {@link pgMigratorConformanceCases} run against. Get it from
 * {@link createPgMigratorConformanceContext} and pass it to every case unchanged.
 *
 * @experimental
 */
export type PgMigratorConformanceContext = MigratorConformanceContext;

export const pgMigratorConformanceGroups: ConformanceGroup<PgMigratorConformanceContext>[] = [
  ...migrationStoreBaseGroups,
  ...migrationStoreTransactionalDdlGroups,
  ...migrationStoreLeaseGroups,
];

/**
 * Prepares the context the {@link pgMigratorConformanceCases} run against, with
 * the store `createPgMigrator` uses over `stateProvider`. The cases create tables named
 * `conformance_<random>_*`, the history and lease tables in `public` and the others in the
 * provider's default schema, and drop them when they end.
 *
 * @experimental
 * @param options - Context configuration.
 */
export const createPgMigratorConformanceContext = ({
  stateProvider,
}: {
  /** The provider under test, over a database the cases may create tables in. */
  stateProvider: PgStateProvider<any>;
}): PgMigratorConformanceContext => ({
  createMigrationStore: ({ migrationTableName, lockTableName }) =>
    createApplicationPgMigrationStore({ stateProvider, migrationTableName, lockTableName }),
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
 * Cases that check `createPgMigrator` over a provider: its history, transactional and
 * non-transactional migrations, reverts and lease. Run them one per test in your own test file
 * against a context from {@link createPgMigratorConformanceContext}. Works with any test runner.
 *
 * @experimental
 *
 * @example
 * ```ts
 * import { afterAll, test } from "vitest";
 *
 * const pool = new Pool({ connectionString });
 * const context = createPgMigratorConformanceContext({
 *   stateProvider: createPgPoolStateProvider({ pool }),
 * });
 * afterAll(async () => pool.end());
 *
 * for (const conformanceCase of pgMigratorConformanceCases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run(context);
 *   });
 * }
 * ```
 */
export const pgMigratorConformanceCases: ConformanceTestCase<PgMigratorConformanceContext>[] =
  toConformanceTestCases(pgMigratorConformanceGroups);
