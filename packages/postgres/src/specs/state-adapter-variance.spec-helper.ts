import { Pool } from "pg";
import type { SchemaFenceConformanceContext } from "queuert/conformance-internal";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import { withPgPoolNonTransactionContext } from "../state-provider/state-provider.pg-pool.spec-helper.ts";
import { createPgPoolProvider } from "../state-provider/state-provider.pg-pool.ts";

type VarianceOptions = {
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
};

const tablePrefixed = (options: VarianceOptions, name: string): string =>
  `${options.schema}.${options.tablePrefix ?? "queuert_"}${name}`;

export const variancePool =
  (connectionString: string) =>
  async (
    // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
    {}: object,
    { onCleanup }: { onCleanup: (cleanup: () => Promise<void>) => void },
  ): Promise<Pool> => {
    const pool = new Pool({ connectionString, idleTimeoutMillis: 0 });
    onCleanup(async () => pool.end());
    return pool;
  };

export const varianceConformance =
  (options: VarianceOptions) =>
  async ({ pool }: { pool: Pool }): Promise<SchemaFenceConformanceContext> => {
    await pool.query(`DROP SCHEMA IF EXISTS ${options.schema} CASCADE`);
    await pool.query(`CREATE SCHEMA ${options.schema}`);
    {
      await using stateAdapter = createPgStateAdapter({
        stateProvider: createPgPoolProvider({ pool }),
        ...options,
      });
      await stateAdapter.migrateToLatest();
    }
    const fenceTable = tablePrefixed(options, "schema_fence_v1");
    return {
      createStateAdapter: async () => {
        await pool.query(
          `TRUNCATE ${tablePrefixed(options, "job_blocker")}, ${tablePrefixed(options, "job")}, ${tablePrefixed(options, "worker")} CASCADE`,
        );
        return createPgStateAdapter({ stateProvider: createPgPoolProvider({ pool }), ...options });
      },
      withNonTransactionContext: withPgPoolNonTransactionContext(pool),
      withWritesFenced: async (fn) => {
        await pool.query(`DROP TABLE ${fenceTable}`);
        try {
          return await fn();
        } finally {
          await pool.query(`CREATE TABLE ${fenceTable} (id integer PRIMARY KEY)`);
        }
      },
    };
  };

export const varianceTableNames =
  (options: VarianceOptions) =>
  async ({ pool, conformance: _ }: { pool: Pool; conformance: unknown }): Promise<string[]> => {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [options.schema],
    );
    return result.rows.map((row) => row.table_name);
  };
