import { Pool, PoolClient } from "pg";
import { PgStateProvider } from "./state-provider.pg.js";

export type PgPoolContext = { poolClient: PoolClient };
export type PgPoolProvider = PgStateProvider<PgPoolContext>;

export const createPgPoolProvider = ({ pool }: { pool: Pool }): PgPoolProvider => {
  return {
    provideContext: async (fn) => {
      const poolClient = await pool.connect();
      try {
        return await fn({ poolClient });
      } finally {
        poolClient.release();
      }
    },
    executeSql: async ({ poolClient }, sql, params) => {
      const result = await poolClient.query(sql, params);
      return result.rows as any;
    },
    assertInTransaction: async () => {
      // NOTE: pg PoolClient does not expose transaction state,
      // so we cannot assert whether we are in a transaction or not.
    },
    runInTransaction: async ({ poolClient }, fn) => {
      await poolClient.query("BEGIN");
      try {
        const result = await fn({ poolClient });
        await poolClient.query("COMMIT");
        return result;
      } catch (error) {
        await poolClient.query("ROLLBACK").catch(() => {});
        throw error;
      }
    },
  };
};
