import postgres from "postgres";
import { type StateAdapter } from "queuert";
import { createFlakyBatchGenerator } from "queuert/testing";
import { type TestAPI, expect } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import {
  type PostgresJsContext,
  type PostgresJsProvider,
  createPostgresJsProvider,
} from "../state-provider/state-provider.postgres-js.js";

export type PostgresJsStateAdapter = StateAdapter<PostgresJsContext, string>;

export const extendWithStatePostgresJs = <
  T extends {
    postgresConnectionString: string;
  },
>(
  api: TestAPI<T>,
): TestAPI<
  T & {
    stateAdapter: StateAdapter<{ $test: true }, string>;
    flakyStateAdapter: StateAdapter<{ $test: true }, string>;
    flakyDbStateAdapter: StateAdapter<{ $test: true }, string> | undefined;
    poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
    poisonExecute:
      | ((cb: (adapter: StateAdapter<{ $test: true }, string>) => Promise<void>) => Promise<void>)
      | undefined;
  }
> => {
  return api.extend<{
    sql: postgres.Sql;
    _dbMigrateToLatest: void;
    _dbCleanup: void;
    stateProvider: PostgresJsProvider;
    flakyStateProvider: PostgresJsProvider;
    flakyDbStateProvider: PostgresJsProvider;
    stateAdapter: PostgresJsStateAdapter;
    flakyStateAdapter: PostgresJsStateAdapter;
    flakyDbStateAdapter: PostgresJsStateAdapter | undefined;
    poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
    poisonExecute:
      | ((cb: (adapter: StateAdapter<{ $test: true }, string>) => Promise<void>) => Promise<void>)
      | undefined;
  }>({
    sql: [
      async ({ postgresConnectionString }, use) => {
        const sql = postgres(postgresConnectionString, { max: 10, onnotice: () => {} });
        await use(sql);
        await sql.end();
      },
      { scope: "worker" },
    ],
    _dbMigrateToLatest: [
      async ({ sql }, use) => {
        await sql.unsafe(
          `DROP TABLE IF EXISTS queuert_job_blocker, queuert_job, queuert_migration CASCADE; DROP TYPE IF EXISTS queuert_job_status CASCADE;`,
        );

        const stateProvider = createPostgresJsProvider({ sql });
        const stateAdapter = await createPgStateAdapter({ stateProvider });
        await stateAdapter.migrateToLatest();

        await use();
      },
      { scope: "worker" },
    ],
    _dbCleanup: [
      async ({ sql }, use) => {
        await use();
        await sql.unsafe(`DELETE FROM queuert_job_blocker;`);
        await sql.unsafe(`DELETE FROM queuert_job;`);
      },
      { scope: "test" },
    ],
    stateProvider: [
      async ({ sql, _dbMigrateToLatest, _dbCleanup }, use) => {
        // oxlint-disable-next-line no-unused-expressions
        _dbMigrateToLatest;
        // oxlint-disable-next-line no-unused-expressions
        _dbCleanup;

        return use(createPostgresJsProvider({ sql }));
      },
      { scope: "test" },
    ],
    flakyStateProvider: [
      async ({ stateProvider }, use) => {
        let queryCount = 0;
        let errorCount = 0;
        const shouldError = createFlakyBatchGenerator();

        const originalExecuteSql = stateProvider.executeSql.bind(stateProvider);
        const flakyStateProvider: typeof stateProvider = {
          ...stateProvider,
          executeSql: async ({ txCtx, sql, params, paramTypes, columnTypes }) => {
            queryCount++;

            if (shouldError()) {
              errorCount++;
              const error = new Error("connection reset") as Error & { code: string };
              error.code = "ECONNRESET";
              throw error;
            }

            return originalExecuteSql({ txCtx, sql, params, paramTypes, columnTypes });
          },
        };

        await use(flakyStateProvider);

        if (queryCount > 5) {
          expect(errorCount).toBeGreaterThan(0);
        }
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ stateProvider }, use) => {
        return use(await createPgStateAdapter({ stateProvider }));
      },
      { scope: "test" },
    ],
    flakyStateAdapter: [
      async ({ flakyStateProvider }, use) => {
        return use(
          await createPgStateAdapter({
            stateProvider: flakyStateProvider,
          }),
        );
      },
      { scope: "test" },
    ],
    poisonTransaction: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(async (txCtx: { $test: true }) => {
          const pgCtx = txCtx as unknown as PostgresJsContext;
          await pgCtx.sql.unsafe("SELECT 1 FROM nonexistent_table_queuert_poison_xyz");
        });
      },
      { scope: "test" },
    ],
    flakyDbStateProvider: [
      async ({ stateProvider }, use) => {
        let enabled = true;
        let queryCount = 0;
        let errorCount = 0;
        const shouldError = createFlakyBatchGenerator();

        const originalExecuteSql = stateProvider.executeSql.bind(stateProvider);
        const flakyDbProvider: typeof stateProvider = {
          ...stateProvider,
          executeSql: async ({ txCtx, sql, params, paramTypes, columnTypes }) => {
            queryCount++;
            const shouldFail = shouldError();
            if (enabled && !txCtx && shouldFail) {
              errorCount++;
              return originalExecuteSql({
                txCtx,
                sql: "SELECT 1 FROM nonexistent_table_queuert_poison_xyz",
                paramTypes: {},
                columnTypes: {},
              });
            }
            return originalExecuteSql({ txCtx, sql, params, paramTypes, columnTypes });
          },
        };

        await use(flakyDbProvider);

        enabled = false;
        await new Promise((resolve) => setTimeout(resolve, 50));

        if (queryCount > 5) {
          expect(errorCount).toBeGreaterThan(0);
        }
      },
      { scope: "test" },
    ],
    flakyDbStateAdapter: [
      async ({ flakyDbStateProvider }, use) => {
        return use(
          await createPgStateAdapter({
            stateProvider: flakyDbStateProvider,
          }),
        );
      },
      { scope: "test" },
    ],
    poisonExecute: [
      async ({ stateProvider }, use) => {
        let poisoned = false;

        const poisonableProvider: typeof stateProvider = {
          ...stateProvider,
          executeSql: async ({ txCtx, sql, params, paramTypes, columnTypes }) => {
            if (poisoned && !txCtx) {
              return stateProvider.executeSql({
                txCtx,
                sql: "SELECT 1 FROM nonexistent_table_queuert_poison_xyz",
                paramTypes: {},
                columnTypes: {},
              });
            }
            return stateProvider.executeSql({ txCtx, sql, params, paramTypes, columnTypes });
          },
        };

        const poisonedAdapter = await createPgStateAdapter({
          stateProvider: poisonableProvider,
        });

        await use(async (cb: (adapter: StateAdapter<{ $test: true }, string>) => Promise<void>) => {
          poisoned = true;
          try {
            await cb(poisonedAdapter as unknown as StateAdapter<{ $test: true }, string>);
          } finally {
            poisoned = false;
          }
        });
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithStatePostgresJs<T>>;
};
