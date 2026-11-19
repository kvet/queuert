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

export type PgMigratorConformanceContext = MigratorConformanceContext;

export const pgMigratorConformanceGroups: ConformanceGroup<PgMigratorConformanceContext>[] = [
  ...migrationStoreBaseGroups,
  ...migrationStoreTransactionalDdlGroups,
  ...migrationStoreLeaseGroups,
];

export const createPgMigratorConformanceContext = ({
  createStateProvider,
}: Parameters<typeof createPgMigratorConformanceCases>[0]): PgMigratorConformanceContext => {
  let stateProvider: PgStateProvider<any> | undefined;
  const provider = (): PgStateProvider<any> => (stateProvider ??= createStateProvider());
  return {
    createMigrationStore: ({ migrationTableName, lockTableName }) =>
      createPgMigratorStore({ stateProvider: provider(), migrationTableName, lockTableName }),
    executeSql: async (sql, txCtx) => {
      await provider().executeStatements({
        txCtx,
        statements: [{ sql, params: [], paramTypes: {}, columnTypes: {}, readOnly: false }],
      });
    },
    countRows: async (table) => {
      const [[row]] = (await provider().executeStatements({
        statements: [
          {
            sql: `SELECT CAST(count(*) AS integer) AS count FROM ${table}`,
            params: [],
            paramTypes: {},
            columnTypes: { count: "number" },
            readOnly: true,
          },
        ],
      })) as { count: number }[][];
      return row.count;
    },
  };
};

/**
 * Prepares the cases that check `createPgMigrator` over a provider (its history, transactional and
 * non-transactional migrations, reverts and lease), ready to run with the store `createPgMigrator`
 * uses over the provider. The cases create tables named `conformance_<random>_*`, the history and
 * lease tables in `public` and the others in the provider's default schema, and drop them when they
 * end.
 *
 * @experimental
 * @param options - Suite configuration.
 *
 * @example
 * ```ts
 * import { afterAll, beforeAll, test } from "vitest";
 *
 * let pool: Pool;
 * const cases = createPgMigratorConformanceCases({
 *   createStateProvider: () => createPgPoolStateProvider({ pool }),
 * });
 * beforeAll(() => {
 *   pool = new Pool({ connectionString });
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
export const createPgMigratorConformanceCases = (options: {
  /**
   * Creates the provider under test, over a database the cases may create tables in. Called once,
   * when the first case runs.
   */
  createStateProvider: () => PgStateProvider<any>;
}): ConformanceTestCase[] =>
  toConformanceTestCases(pgMigratorConformanceGroups, createPgMigratorConformanceContext(options));
