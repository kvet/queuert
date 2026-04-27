import { createHash } from "node:crypto";

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
   * prepared statements (`name = "q_" + hash(id+sql).slice(0, 12)`), letting
   * pg cache the parsed plan per connection. Set to `false` for transaction-mode
   * poolers (PgBouncer, Supavisor) where named statements break across pooled
   * sessions.
   */
  prepareStatements?: boolean;
}): PgStateProvider<PgPoolContext> => {
  const nameCache = new Map<string, string>();
  const nameFor = (id: string, sql: string): string => {
    let name = nameCache.get(sql);
    if (name === undefined) {
      name = "q_" + createHash("sha1").update(id).update(sql).digest("hex").slice(0, 12);
      nameCache.set(sql, name);
    }
    return name;
  };

  const exec = async (
    client: PoolClient,
    id: string | undefined,
    sql: string,
    params: unknown[],
  ): Promise<unknown[]> => {
    if (id !== undefined && prepareStatements) {
      const result = await client.query({ name: nameFor(id, sql), text: sql, values: params });
      return result.rows;
    }
    const result = await client.query(sql, params);
    return result.rows;
  };

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
    executeSql: async ({ txCtx, id, sql, params }) => {
      if (txCtx) return exec(txCtx.poolClient, id, sql, params);
      const poolClient = await pool.connect();
      try {
        return await exec(poolClient, id, sql, params);
      } finally {
        poolClient.release();
      }
    },
    close: async () => {
      nameCache.clear();
    },
  };
};
