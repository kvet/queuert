import { Pool, PoolClient } from "pg";
import { PgStateProvider } from "./state-provider.pg.js";

export type PgContext = { client: PoolClient };

export const createPgPoolProvider = ({ pool }: { pool: Pool }): PgStateProvider<PgContext> => {
  const inTransaction = new WeakSet<PoolClient>();

  return {
    provideContext: async (fn) => {
      const client = await pool.connect();
      try {
        return await fn({ client });
      } finally {
        client.release();
      }
    },
    executeSql: async ({ client }, sql, params) => {
      const result = await client.query(sql, params);
      return result.rows as any;
    },
    assertInTransaction: async ({ client }) => {
      if (!inTransaction.has(client)) {
        throw new Error("Expected to be in a transaction");
      }
    },
    runInTransaction: async ({ client }, fn) => {
      await client.query("BEGIN");
      inTransaction.add(client);
      try {
        const result = await fn({ client });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        inTransaction.delete(client);
      }
    },
  };
};

export type PgPoolProvider = PgStateProvider<{ client: PoolClient }>;
