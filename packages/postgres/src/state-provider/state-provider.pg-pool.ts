import type { Pool, PoolClient } from "pg";
import { type TxHooks, withTxHooks } from "queuert";

import type { PgStateProvider } from "./state-provider.pg.ts";

/**
 * Transaction context of {@link createPgPoolProvider}: a `pg` pool client and the `txHooks` its commit and rollback
 * callbacks register on. `withTransaction` creates both; a transaction you open yourself passes
 * `txHooks` from `withTxHooks` wrapped around it.
 */
export type PgPoolContext = { poolClient: PoolClient; txHooks: TxHooks };

const requireTxHooks = (txCtx: Partial<PgPoolContext>): TxHooks => {
  if (txCtx.txHooks === undefined) {
    throw new Error(
      "The transaction context has no txHooks: open the transaction with the provider's withTransaction, or create txHooks with withTxHooks and pass them in the context",
    );
  }
  return txCtx.txHooks;
};
export type PgPoolProvider = PgStateProvider<PgPoolContext>;

/** A PostgreSQL state provider over a `pg` pool; each transaction holds one pool client. */
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
    withTransaction: async (fn) =>
      withTxHooks(async (txHooks) => {
        const poolClient = await pool.connect();
        try {
          await poolClient.query("BEGIN");
          const result = await fn({ poolClient, txHooks });
          await poolClient.query("COMMIT");
          return result;
        } catch (error) {
          await poolClient.query("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          poolClient.release();
        }
      }),
    onTransactionCommit: (txCtx, callback) => {
      requireTxHooks(txCtx).onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      requireTxHooks(txCtx).onRollback(callback);
    },
    isTransaction: (txCtx) => {
      const status = txCtx.poolClient.getTransactionStatus();
      return status === "T" || status === "E";
    },
    classifyError: ({ error }) => {
      const driverError = error as { code?: unknown; message?: unknown } | undefined;
      if (driverError?.code !== "42P01") return undefined;
      const tableName = /relation "([^"]+)" does not exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
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
