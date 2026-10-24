import { Pool } from "pg";
import { type StateAdapter } from "queuert";
import { createFlakyBatchGenerator } from "queuert/testing";
import { type TestAPI, expect } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import {
  type PgPoolContext,
  type PgPoolProvider,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.js";

export type PgPoolStateAdapter = StateAdapter<PgPoolContext, string>;

export const extendWithStatePg = <
  T extends {
    postgresConnectionString: string;
  },
>(
  api: TestAPI<T>,
): TestAPI<
  T & {
    stateAdapter: StateAdapter<{ $test: true }, string>;
    transactionConcurrency: "concurrent" | "serialized";
    flakyStateAdapter: StateAdapter<{ $test: true }, string>;
    flakyDbStateAdapter: StateAdapter<{ $test: true }, string> | undefined;
    poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
    withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
    withSavepoint:
      | (<T>(txCtx: { $test: true }, fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>)
      | undefined;
  }
> => {
  return api.extend<{
    statePool: Pool;
    _dbMigrateToLatest: void;
    _dbCleanup: void;
    stateProvider: PgPoolProvider;
    flakyStateProvider: PgPoolProvider;
    flakyDbStateProvider: PgPoolProvider;
    stateAdapter: PgPoolStateAdapter;
    transactionConcurrency: "concurrent" | "serialized";
    flakyStateAdapter: PgPoolStateAdapter;
    flakyDbStateAdapter: PgPoolStateAdapter | undefined;
    poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
    withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
    withSavepoint:
      | (<T>(txCtx: { $test: true }, fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>)
      | undefined;
  }>({
    statePool: [
      async ({ postgresConnectionString }, use) => {
        const pool = new Pool({
          connectionString: postgresConnectionString,
          idleTimeoutMillis: 0,
        });

        await use(pool);

        await pool.end();
      },
      { scope: "worker" },
    ],
    _dbMigrateToLatest: [
      async ({ statePool }, use) => {
        const client = await statePool.connect();
        await client
          .query(
            `DROP TABLE IF EXISTS queuert_job_blocker, queuert_job, queuert_migration, queuert_migration_lock CASCADE; DROP TYPE IF EXISTS queuert_job_status CASCADE;`,
          )
          .catch(() => {
            // ignore
          });
        client.release();

        const stateProvider = createPgPoolProvider({
          pool: statePool,
        });
        const stateAdapter = await createPgStateAdapter({
          stateProvider,
        });

        await stateAdapter.migrateToLatest();

        await use();
      },
      { scope: "worker" },
    ],
    _dbCleanup: [
      async ({ statePool }, use) => {
        await use();

        const client = await statePool.connect();
        await client.query(`DELETE FROM queuert_job_blocker;`);
        await client.query(`DELETE FROM queuert_job;`);
        client.release();
      },
      { scope: "test" },
    ],
    stateProvider: [
      async ({ statePool, _dbMigrateToLatest, _dbCleanup }, use) => {
        // oxlint-disable-next-line no-unused-expressions
        _dbMigrateToLatest;
        // oxlint-disable-next-line no-unused-expressions
        _dbCleanup;

        return use(createPgPoolProvider({ pool: statePool }));
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
          executeSql: async ({ txCtx, sql, params, paramTypes, columnTypes, readOnly }) => {
            queryCount++;

            if (shouldError()) {
              errorCount++;
              const error = new Error("connection reset") as Error & { code: string };
              error.code = "ECONNRESET";
              throw error;
            }

            return originalExecuteSql({ txCtx, sql, params, paramTypes, columnTypes, readOnly });
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
    transactionConcurrency: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use("concurrent");
      },
      { scope: "test" },
    ],
    withSavepoint: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(async (txCtx, fn) => {
          const { poolClient } = txCtx as unknown as PgPoolContext;
          await poolClient.query("SAVEPOINT queuert_test");
          try {
            const result = await fn(txCtx);
            await poolClient.query("RELEASE SAVEPOINT queuert_test");
            return result;
          } catch (error) {
            await poolClient.query("ROLLBACK TO SAVEPOINT queuert_test");
            throw error;
          }
        });
      },
      { scope: "test" },
    ],
    poisonTransaction: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(async (txCtx: { $test: true }) => {
          const pgCtx = txCtx as unknown as PgPoolContext;
          await pgCtx.poolClient.query("SELECT 1 FROM nonexistent_table_queuert_poison_xyz");
        });
      },
      { scope: "test" },
    ],
    withNonTransactionContext: [
      async ({ statePool }, use) => {
        await use(async (fn) => {
          const poolClient = await statePool.connect();
          try {
            const pgCtx: PgPoolContext = { poolClient };
            return await fn(pgCtx as unknown as { $test: true });
          } finally {
            poolClient.release();
          }
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
          executeSql: async ({ txCtx, sql, params, paramTypes, columnTypes, readOnly }) => {
            queryCount++;

            if (enabled && shouldError()) {
              errorCount++;
              return originalExecuteSql({
                txCtx,
                sql: "SELECT 1 FROM nonexistent_table_queuert_poison_xyz",
                params: [],
                paramTypes: {},
                columnTypes: {},
                readOnly: true,
              });
            }

            return originalExecuteSql({ txCtx, sql, params, paramTypes, columnTypes, readOnly });
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
  }) as ReturnType<typeof extendWithStatePg<T>>;
};
