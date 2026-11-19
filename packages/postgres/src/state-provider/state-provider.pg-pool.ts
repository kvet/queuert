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
  const runStatements = async (
    poolClient: PoolClient,
    statements: Parameters<PgPoolProvider["executeStatements"]>[0]["statements"],
  ): Promise<unknown[][]> => {
    const settled = await Promise.allSettled(
      statements.map(async ({ id, sql, params }) => {
        const result =
          id === undefined
            ? await poolClient.query(sql, params)
            : await poolClient.query({ name: id, text: sql, values: params });
        return result.rows as unknown[];
      }),
    );
    return settled.map((outcome) => {
      if (outcome.status === "rejected") throw outcome.reason;
      return outcome.value;
    });
  };

  return {
    withTransaction: async (fn) =>
      withTxHooks(async (txHooks) => {
        const poolClient = await pool.connect();
        try {
          await poolClient.query("BEGIN ISOLATION LEVEL READ COMMITTED");
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
    executeStatements: async ({ txCtx, statements }) => {
      if (statements.length === 0) return [];
      if (txCtx) return runStatements(txCtx.poolClient, statements);
      const poolClient = await pool.connect();
      try {
        return await runStatements(poolClient, statements);
      } finally {
        poolClient.release();
      }
    },
  };
};
