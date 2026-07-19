import { Pool } from "pg";
import { type StateAdapter } from "queuert";
import { type TestAPI } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.js";

export const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VarianceFixtures = {
  pool: Pool;
  stateAdapter: StateAdapter<{ $test: true }, string>;
  poisonTransaction: (txCtx: { $test: true }) => Promise<void>;
  tableNames: string[];
};

export const extendWithVarianceStatePg = <T extends { postgresConnectionString: string }>(
  api: TestAPI<T>,
  options: {
    schema: string;
    tablePrefix?: string;
    idType?: string;
    generateId?: () => string;
  },
): TestAPI<T & VarianceFixtures> => {
  return api.extend<VarianceFixtures>({
    pool: [
      async ({ postgresConnectionString }, use) => {
        const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
        await use(pool);
        await pool.end();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ pool }, use) => {
        const client = await pool.connect();
        await client.query(`DROP SCHEMA IF EXISTS ${options.schema} CASCADE`).catch(() => {});
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${options.schema}`);
        client.release();

        const stateProvider = createPgPoolProvider({ pool });
        const adapter = await createPgStateAdapter({ stateProvider, ...options });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
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
    tableNames: [
      async ({ pool, stateAdapter: _ }, use) => {
        const result = await pool.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
          [options.schema],
        );
        await use(result.rows.map((row) => row.table_name));
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithVarianceStatePg<T>>;
};
