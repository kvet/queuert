import { type StateAdapter } from "@queuert/core";
import { Pool } from "pg";
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
    pool: Pool;
    stateAdapter: PgStateAdapter;
    flakyStateAdapter: PgStateAdapter;
  }
> => {
  return api.extend<{
    pool: Pool;
    _dbMigrateToLatest: void;
    _dbCleanup: void;
    stateProvider: PgPoolProvider;
    flakyStateProvider: PgPoolProvider;
    stateAdapter: PgStateAdapter;
    flakyStateAdapter: PgStateAdapter;
  }>({
    pool: [
      async ({ postgresConnectionString }, use) => {
        const pool = new Pool({
          connectionString: postgresConnectionString,
        });

        await use(pool);

        await pool.end();
      },
      { scope: "worker" },
    ],
    _dbMigrateToLatest: [
      async ({ pool: pood }, use) => {
        const client = await pood.connect();
        await client.query(`DROP SCHEMA IF EXISTS queuert CASCADE;`).catch(() => {
          // ignore
        });

        const stateProvider = createPgPoolProvider({
          pool: pood,
        });
        const stateAdapter = createPgStateAdapter({
          stateProvider,
        });

        await stateAdapter.provideContext(async ({ poolClient: client }) =>
          client.query(`
            CREATE SCHEMA IF NOT EXISTS queuert;
            GRANT USAGE ON SCHEMA queuert TO test;
          `),
        );
        await stateAdapter.migrateToLatest({ poolClient: client });

        client.release();

        await use();
      },
      { scope: "worker" },
    ],
    _dbCleanup: [
      async ({ pool: pood }, use) => {
        await use();

        const client = await pood.connect();
        await client.query(`DELETE FROM queuert.job_blocker;`);
        await client.query(`DELETE FROM queuert.job;`);
        client.release();
      },
      { scope: "test" },
    ],
    stateProvider: [
      async ({ pool, _dbMigrateToLatest, _dbCleanup }, use) => {
        // oxlint-disable-next-line no-unused-expressions
        _dbMigrateToLatest;
        // oxlint-disable-next-line no-unused-expressions
        _dbCleanup;

        return use(createPgPoolProvider({ pool }));
      },
      { scope: "test" },
    ],
    flakyStateProvider: [
      async ({ stateProvider, expect }, use) => {
        let queryCount = 0;
        let errorCount = 0;

        // Seeded PRNG (mulberry32) for reproducible randomness
        const seed = 12345;
        let state = seed;
        const random = () => {
          state = (state + 0x6d2b79f5) | 0;
          let t = Math.imul(state ^ (state >>> 15), 1 | state);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };

        // Generate batch sizes: alternate between success (5-15) and error (1-20) batches
        let inErrorBatch = false;
        let batchRemaining = Math.floor(random() * 11) + 5; // First success batch: 5-15

        const originalExecuteSql = stateProvider.executeSql.bind(stateProvider);
        const flakyStateProvider: typeof stateProvider = {
          ...stateProvider,
          executeSql: async (context, sql, params) => {
            queryCount++;
            batchRemaining--;

            if (batchRemaining <= 0) {
              inErrorBatch = !inErrorBatch;
              batchRemaining = inErrorBatch
                ? Math.floor(random() * 20) + 1 // Error batch: 1-20
                : Math.floor(random() * 11) + 5; // Success batch: 5-15
            }

            if (inErrorBatch) {
              errorCount++;
              const error = new Error("connection reset") as Error & { code: string };
              error.code = "ECONNRESET";
              throw error;
            }

            return originalExecuteSql(context, sql, params);
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
        return use(createPgStateAdapter({ stateProvider }));
      },
      { scope: "test" },
    ],
    flakyStateAdapter: [
      async ({ flakyStateProvider }, use) => {
        return use(
          createPgStateAdapter({
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
