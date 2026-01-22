import { Pool } from "pg";
import { type StateAdapter } from "queuert";
import { createFlakyBatchGenerator } from "queuert/testing";
import { type TestAPI } from "vitest";
import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import { createPgPoolProvider, PgPoolContext, PgPoolProvider } from "./state-provider.pg-pool.js";

export type PgStateAdapter = StateAdapter<PgPoolContext, string>;

export const extendWithStatePostgres = <
  T extends {
    postgresConnectionString: string;
  },
>(
  api: TestAPI<T>,
): TestAPI<
  T & {
    stateAdapter: StateAdapter<{ $test: true }, string>;
    flakyStateAdapter: StateAdapter<{ $test: true }, string>;
  }
> => {
  return api.extend<{
    statePool: Pool;
    _dbMigrateToLatest: void;
    _dbCleanup: void;
    stateProvider: PgPoolProvider;
    flakyStateProvider: PgPoolProvider;
    stateAdapter: PgStateAdapter;
    flakyStateAdapter: PgStateAdapter;
  }>({
    statePool: [
      async ({ postgresConnectionString }, use) => {
        const pool = new Pool({
          connectionString: postgresConnectionString,
          allowExitOnIdle: true, // Unref idle timeout timers to prevent resource leak detection
        });

        await use(pool);

        await pool.end();
      },
      { scope: "worker" },
    ],
    _dbMigrateToLatest: [
      async ({ statePool }, use) => {
        const client = await statePool.connect();
        await client.query(`DROP SCHEMA IF EXISTS queuert CASCADE;`).catch(() => {
          // ignore
        });
        client.release();

        const stateProvider = createPgPoolProvider({
          pool: statePool,
        });
        const stateAdapter = await createPgStateAdapter({
          stateProvider,
        });

        // Run schema setup without context (will manage its own connection)
        await stateProvider.executeSql({
          sql: `
            CREATE SCHEMA IF NOT EXISTS queuert;
            GRANT USAGE ON SCHEMA queuert TO test;
          `,
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
        await client.query(`DELETE FROM queuert.job_blocker;`);
        await client.query(`DELETE FROM queuert.job;`);
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
      async ({ stateProvider, expect }, use) => {
        let queryCount = 0;
        let errorCount = 0;
        const shouldError = createFlakyBatchGenerator();

        const originalExecuteSql = stateProvider.executeSql.bind(stateProvider);
        const flakyStateProvider: typeof stateProvider = {
          ...stateProvider,
          executeSql: async ({ txContext, sql, params }) => {
            queryCount++;

            if (shouldError()) {
              errorCount++;
              const error = new Error("connection reset") as Error & { code: string };
              error.code = "ECONNRESET";
              throw error;
            }

            return originalExecuteSql({ txContext, sql, params });
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
            connectionRetryConfig: {
              maxAttempts: 3,
              initialDelayMs: 1,
              multiplier: 1,
              maxDelayMs: 1,
            },
          }),
        );
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithStatePostgres<T>>;
};
