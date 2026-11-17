import {
  type MigratorConformanceContext,
  migrationStoreBaseGroups,
  migrationStoreLeaseGroups,
  migrationStoreTransactionalDdlGroups,
} from "@queuert/typed-sql";
import type { ConformanceTestCase } from "queuert/conformance";
import { type ConformanceGroup, toConformanceTestCases } from "queuert/conformance-internal";

import { createPgMigratorStore } from "../migration-store/migration-store.pg.ts";
import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";

/**
 * The context the cases from {@link createPgMigratorConformanceContext} run against. Pass it
 * to every case unchanged.
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
 * Prepares the cases that check `createPgMigrator` over a provider (its history, transactional and
 * non-transactional migrations, reverts and lease) and the context they run against, with the
 * store `createPgMigrator` uses over the provider. The cases create tables named
 * `conformance_<random>_*`, the history and lease tables in `public` and the others in the
 * provider's default schema, and drop them when they end.
 *
 * @experimental
 * @param options - Context configuration.
 *
 * @example
 * ```ts
 * import { afterAll, beforeAll, test } from "vitest";
 *
 * let pool: Pool;
 * const { context, cases } = createPgMigratorConformanceContext({
 *   createStateProvider: () => createPgPoolStateProvider({ pool }),
 * });
 * beforeAll(() => {
 *   pool = new Pool({ connectionString });
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
export const createPgMigratorConformanceContext = ({
  createStateProvider,
}: {
  /**
   * Creates the provider under test, over a database the cases may create tables in. Called once,
   * when the first case runs.
   */
  createStateProvider: () => PgStateProvider<any>;
}): {
  context: PgMigratorConformanceContext;
  cases: ConformanceTestCase<PgMigratorConformanceContext>[];
} => {
  let stateProvider: PgStateProvider<any> | undefined;
  const provider = (): PgStateProvider<any> => (stateProvider ??= createStateProvider());
  return {
    context: {
      createMigrationStore: ({ migrationTableName, lockTableName }) =>
        createPgMigratorStore({ stateProvider: provider(), migrationTableName, lockTableName }),
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
          sql: `SELECT CAST(count(*) AS integer) AS count FROM ${table}`,
          params: [],
          paramTypes: {},
          columnTypes: { count: "number" },
          readOnly: true,
        })) as { count: number }[];
        return row.count;
      },
    },
    cases: toConformanceTestCases(pgMigratorConformanceGroups),
  };
};
