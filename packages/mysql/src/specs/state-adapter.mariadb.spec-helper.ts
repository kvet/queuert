import mysql from "mysql2/promise";
import { type StateAdapter } from "queuert";
import { createFlakyBatchGenerator } from "queuert/testing";
import { type TestAPI } from "vitest";
import { createMysqlStateAdapter } from "../state-adapter/state-adapter.mysql.js";
import {
  type MysqlPoolContext,
  type MysqlPoolProvider,
  createMysqlPoolProvider,
} from "./state-provider.mysql2-pool.js";

export type MariadbStateAdapter = StateAdapter<MysqlPoolContext, string>;

export const extendWithStateMariadb = <
  T extends {
    mariadbConnectionString: string;
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
    statePool: mysql.Pool;
    _dbMigrateToLatest: void;
    _dbCleanup: void;
    stateProvider: MysqlPoolProvider;
    flakyStateProvider: MysqlPoolProvider;
    stateAdapter: MariadbStateAdapter;
    flakyStateAdapter: MariadbStateAdapter;
  }>({
    statePool: [
      async ({ mariadbConnectionString }, use) => {
        const pool = mysql.createPool({
          uri: mariadbConnectionString,
          waitForConnections: true,
          connectionLimit: 10,
          timezone: "Z", // Use UTC timezone for consistent date handling
        });

        await use(pool);

        await pool.end();
      },
      { scope: "worker" },
    ],
    _dbMigrateToLatest: [
      async ({ statePool }, use) => {
        const connection = await statePool.getConnection();
        try {
          await connection.query(`DROP TABLE IF EXISTS queuert_job_blocker`);
          await connection.query(`DROP TABLE IF EXISTS queuert_job`);
        } finally {
          connection.release();
        }

        const stateProvider = createMysqlPoolProvider({
          pool: statePool,
        });
        const stateAdapter = await createMysqlStateAdapter({
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

        const connection = await statePool.getConnection();
        try {
          await connection.query(`DELETE FROM queuert_job_blocker`);
          await connection.query(`DELETE FROM queuert_job`);
        } finally {
          connection.release();
        }
      },
      { scope: "test" },
    ],
    stateProvider: [
      async ({ statePool, _dbMigrateToLatest, _dbCleanup }, use) => {
        // oxlint-disable-next-line no-unused-expressions
        _dbMigrateToLatest;
        // oxlint-disable-next-line no-unused-expressions
        _dbCleanup;

        return use(createMysqlPoolProvider({ pool: statePool }));
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
        return use(await createMysqlStateAdapter({ stateProvider }));
      },
      { scope: "test" },
    ],
    flakyStateAdapter: [
      async ({ flakyStateProvider }, use) => {
        return use(
          await createMysqlStateAdapter({
            stateProvider: flakyStateProvider,
            // MySQL requires 2 queries per operation (UPDATE + SELECT) due to lack of RETURNING,
            // so we need significantly more retry attempts than PostgreSQL to handle flaky connections.
            // The flaky generator produces error batches of up to 20 consecutive errors.
            connectionRetryConfig: {
              maxAttempts: 25,
              initialDelayMs: 1,
              multiplier: 1,
              maxDelayMs: 1,
            },
          }),
        );
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithStateMariadb<T>>;
};
