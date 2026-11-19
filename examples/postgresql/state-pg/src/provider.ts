import type { PgStateProvider } from "@queuert/postgres";
import type { Pool, PoolClient } from "pg";
import { type TxHooks, withTxHooks } from "queuert";

export type PgPoolContext = { poolClient: PoolClient; txHooks: TxHooks };

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
  const execute = async (
    client: PoolClient,
    { id, sql, params }: { id?: string; sql: string; params: unknown[] },
  ): Promise<unknown[]> => {
    const result =
      id !== undefined && prepareStatements
        ? await client.query({ name: id, text: sql, values: params })
        : await client.query(sql, params);
    return result.rows;
  };

  const executeBatch = async (
    client: PoolClient,
    statements: { id?: string; sql: string; params: unknown[] }[],
  ): Promise<unknown[][]> => {
    const results = await Promise.allSettled(
      statements.map(async (statement) => execute(client, statement)),
    );
    return results.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
  };

  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) => {
        const poolClient = await pool.connect();
        try {
          await poolClient.query("BEGIN ISOLATION LEVEL READ COMMITTED");
          const result = await cb({ poolClient, txHooks });
          await poolClient.query("COMMIT");
          return result;
        } catch (error) {
          await poolClient.query("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          poolClient.release();
        }
      }),
    isTransaction: (txCtx) => {
      const status = txCtx.poolClient.getTransactionStatus();
      return status === "T" || status === "E";
    },
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError: ({ error }) => {
      const driverError = error as { code?: unknown; message?: unknown } | undefined;
      if (driverError?.code !== "42P01") return undefined;
      const tableName = /relation "([^"]+)" does not exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeStatements: async ({ txCtx, statements }) => {
      if (txCtx) return executeBatch(txCtx.poolClient, statements);
      const poolClient = await pool.connect();
      try {
        return await executeBatch(poolClient, statements);
      } finally {
        poolClient.release();
      }
    },
  };
};
