import { createHash } from "node:crypto";

import { type Pool, type PoolClient } from "pg";

import { type PgStateProvider } from "./state-provider.pg.js";

export type PgPoolContext = { poolClient: PoolClient };
export type PgPoolProvider = PgStateProvider<PgPoolContext>;

export const createPgPoolProvider = ({ pool }: { pool: Pool }): PgPoolProvider => {
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
    if (id !== undefined) {
      const result = await client.query({ name: nameFor(id, sql), text: sql, values: params });
      return result.rows;
    }
    const result = await client.query(sql, params);
    return result.rows;
  };

  return {
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
