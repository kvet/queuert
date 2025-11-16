import { Pool, PoolClient } from "pg";
import { QueuertDbProvider } from "./db-provider.js";

export const createPgPoolProvider = ({
  pool,
}: {
  pool: Pool;
}): QueuertDbProvider<{ client: PoolClient }> => ({
  provideContext: async (fn) => {
    const client = await pool.connect();
    try {
      return await fn({ client });
    } finally {
      client.release();
    }
  },
  executeSql: async ({ client }, sql, params) => {
    // console.log("Executing SQL:", sql, "with params:", params);
    const result = await client.query(sql, params);
    return result.rows as any;
  },
  assertInTransaction: async () => {
    // No-op for pg PoolClient as it doesn't expose transaction state
  },
  runInTransaction: async ({ client }, fn) => {
    await client.query("BEGIN");
    try {
      const result = await fn({ client });
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  },
});
export type PgPoolProvider = QueuertDbProvider<{ client: PoolClient }>;
