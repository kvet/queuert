import { Pool } from "pg";
import type { SchemaFenceConformanceContext } from "queuert/conformance-internal";
import type { ConformanceFixtures } from "queuert/testing";
import type { TestAPI } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.ts";

export type VarianceFixtures = ConformanceFixtures<SchemaFenceConformanceContext> & {
  pool: Pool;
  tableNames: string[];
};

export const extendWithVarianceStatePg = <T extends { postgresConnectionString: string }>(
  api: TestAPI<T>,
  options: {
    schema: string;
    tablePrefix?: string;
    jobIdType?: string;
    workerIdType?: string;
    generateJobId?: () => string;
    validateJobId?: (id: string) => boolean;
    generateWorkerId?: () => string;
    validateWorkerId?: (id: string) => boolean;
    maxBlockersPerJob?: number;
    countCap?: number;
  },
): TestAPI<T & VarianceFixtures> => {
  return api.extend<VarianceFixtures>({
    pool: [
      async ({ postgresConnectionString }, use) => {
        const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
        await use(pool);
        await pool.end();
      },
      { scope: "file" },
    ],
    conformance: [
      async ({ pool }, use) => {
        await pool.query(`DROP SCHEMA IF EXISTS ${options.schema} CASCADE`);
        await pool.query(`CREATE SCHEMA ${options.schema}`);
        const createStateAdapter = async () =>
          createPgStateAdapter({ stateProvider: createPgPoolProvider({ pool }), ...options });
        {
          await using stateAdapter = await createStateAdapter();
          await stateAdapter.migrateToLatest();
        }
        const tablePrefixed = (name: string): string =>
          `${options.schema}.${options.tablePrefix ?? "queuert_"}${name}`;
        const fenceTable = tablePrefixed("schema_fence_v1");
        await use({
          createStateAdapter,
          withNonTransactionContext: async (fn) => {
            const poolClient = await pool.connect();
            try {
              const pgCtx: PgPoolContext = { poolClient };
              return await fn(pgCtx);
            } finally {
              poolClient.release();
            }
          },
          withWritesFenced: async (fn) => {
            await pool.query(`DROP TABLE ${fenceTable}`);
            try {
              return await fn();
            } finally {
              await pool.query(`CREATE TABLE ${fenceTable} (id integer PRIMARY KEY)`);
            }
          },
          reset: async () => {
            await pool.query(
              `TRUNCATE ${tablePrefixed("job_blocker")}, ${tablePrefixed("job")}, ${tablePrefixed("worker")} CASCADE`,
            );
          },
        });
      },
      { scope: "file" },
    ],
    tableNames: [
      async ({ pool, conformance: _ }, use) => {
        const result = await pool.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
          [options.schema],
        );
        await use(result.rows.map((row) => row.table_name));
      },
      { scope: "file" },
    ],
  }) as ReturnType<typeof extendWithVarianceStatePg<T>>;
};
