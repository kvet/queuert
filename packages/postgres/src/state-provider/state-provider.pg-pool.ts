import { type Pool, type PoolClient } from "pg";

import { type PgStateProvider } from "./state-provider.pg.js";

export type PgPoolContext = { poolClient: PoolClient };
export type PgPoolProvider = PgStateProvider<PgPoolContext>;

export const createPgPoolProvider = ({ pool }: { pool: Pool }): PgPoolProvider => {
  const exec = async (
    client: PoolClient,
    id: string | undefined,
    sql: string,
    params: unknown[],
  ): Promise<unknown[]> => {
    if (id !== undefined) {
      const result = await client.query({ name: id, text: sql, values: params });
      return result.rows;
    }
    const result = await client.query(sql, params);
    return result.rows;
  };

  return {
    transactionConcurrency: "concurrent",
    executeSql: async ({ txCtx, id, sql, params }) => {
      if (txCtx) return exec(txCtx.poolClient, id, sql, params) as any;
      const poolClient = await pool.connect();
      try {
        return (await exec(poolClient, id, sql, params)) as any;
      } finally {
        poolClient.release();
      }
    },
    withTransaction: async (fn) => {
      const poolClient = await pool.connect();
      try {
        await poolClient.query("BEGIN");
        const result = await fn({ poolClient });
        await poolClient.query("COMMIT");
        return result;
      } catch (error) {
        await poolClient.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        poolClient.release();
      }
    },
  };
};
