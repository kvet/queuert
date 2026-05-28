import { type PgStateProvider } from "@queuert/postgres";
import { type Pool, type PoolClient } from "pg";

export type PgPoolContext = { poolClient: PoolClient };

export const createPgPoolStateProvider = ({
  pool,
  prepareStatements = true,
}: {
  pool: Pool;
  /**
   * When true (default), queries that arrive with an `id` are sent as named
   * prepared statements (`name = id`), letting pg cache the parsed plan per
   * connection. The adapter folds template variants into `id`, so it uniquely
   * identifies the resolved SQL. Set to `false` for transaction-mode poolers
   * (PgBouncer, Supavisor) where named statements break across pooled sessions.
   */
  prepareStatements?: boolean;
}): PgStateProvider<PgPoolContext> => {
  const exec = async (
    client: PoolClient,
    id: string | undefined,
    sql: string,
    params: unknown[],
  ): Promise<unknown[]> => {
    if (id !== undefined && prepareStatements) {
      const result = await client.query({ name: id, text: sql, values: params });
      return result.rows;
    }
    const result = await client.query(sql, params);
    return result.rows;
  };

  return {
    transactionConcurrency: "concurrent",
    withTransaction: async (cb) => {
      const poolClient = await pool.connect();
      try {
        await poolClient.query("BEGIN");
        const result = await cb({ poolClient });
        await poolClient.query("COMMIT");
        return result;
      } catch (error) {
        await poolClient.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        poolClient.release();
      }
    },
    executeSql: async ({ txCtx, id, sql, params }) => {
      if (txCtx) return exec(txCtx.poolClient, id, sql, params);
      const poolClient = await pool.connect();
      try {
        return await exec(poolClient, id, sql, params);
      } finally {
        poolClient.release();
      }
    },
  };
};
