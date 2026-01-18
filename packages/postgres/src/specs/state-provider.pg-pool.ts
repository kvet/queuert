import { Pool, PoolClient } from "pg";
import { PgStateProvider } from "../state-provider/state-provider.pg.js";

export type PgPoolContext = { poolClient: PoolClient };
export type PgPoolProvider = PgStateProvider<PgPoolContext>;

export const createPgPoolProvider = ({ pool }: { pool: Pool }): PgPoolProvider => {
  return {
    executeSql: async ({ txContext, sql, params }) => {
      if (txContext) {
        const result = await txContext.poolClient.query(sql, params);
        return result.rows as any;
      }
      const poolClient = await pool.connect();
      try {
        const result = await poolClient.query(sql, params);
        return result.rows as any;
      } finally {
        poolClient.release();
      }
    },
    runInTransaction: async (fn) => {
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
