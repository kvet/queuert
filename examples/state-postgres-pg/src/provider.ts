import { type PgStateProvider } from "@queuert/postgres";
import { type Pool, type PoolClient } from "pg";

export type PgPoolContext = { poolClient: PoolClient };

export const createPgPoolStateProvider = ({
  pool,
}: {
  pool: Pool;
}): PgStateProvider<PgPoolContext> => {
  return {
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
    executeSql: async ({ txCtx, sql, params }) => {
      if (txCtx) {
        const result = await txCtx.poolClient.query(sql, params);
        return result.rows;
      }
      const poolClient = await pool.connect();
      try {
        const result = await poolClient.query(sql, params);
        return result.rows;
      } finally {
        poolClient.release();
      }
    },
  };
};
