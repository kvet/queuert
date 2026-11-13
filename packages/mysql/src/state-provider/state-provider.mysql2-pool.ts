import type { Pool, PoolConnection } from "mysql2/promise";
import { type TxHooks, withTxHooks } from "queuert";

import type { MysqlStateProvider, MysqlStateProviderError } from "./state-provider.mysql.ts";

export type Mysql2PoolContext = { connection: PoolConnection; txHooks: TxHooks };

export type Mysql2PoolProvider = MysqlStateProvider<Mysql2PoolContext>;

const requireTxHooks = (txCtx: Partial<Mysql2PoolContext>): TxHooks => {
  if (txCtx.txHooks === undefined) {
    throw new Error(
      "The transaction context has no txHooks: open the transaction with the provider's withTransaction, or create txHooks with withTxHooks and pass them in the context",
    );
  }
  return txCtx.txHooks;
};

export const classifyMysqlError = ({
  error,
}: {
  error: unknown;
}): MysqlStateProviderError | undefined => {
  const driverError = error as { errno?: unknown; message?: unknown } | undefined;
  switch (driverError?.errno) {
    case 1146: {
      const tableName = /Table '([^']+)' doesn't exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    }
    default:
      return undefined;
  }
};

export const createMysql2PoolProvider = ({ pool }: { pool: Pool }): Mysql2PoolProvider => {
  const openTransactions = new WeakSet<PoolConnection>();

  const exec = async (
    connection: PoolConnection,
    id: string | undefined,
    sql: string,
    params: unknown[],
  ): Promise<unknown[]> => {
    const [rows] =
      id !== undefined
        ? await connection.execute(sql, params as never[])
        : await connection.query(sql, params);
    return Array.isArray(rows) ? rows : [];
  };

  return {
    withTransaction: async (fn) =>
      withTxHooks(async (txHooks) => {
        const connection = await pool.getConnection();
        const txCtx: Mysql2PoolContext = { connection, txHooks };
        try {
          await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
          await connection.query("START TRANSACTION");
          openTransactions.add(connection);
          const result = await fn(txCtx);
          await connection.query("COMMIT");
          openTransactions.delete(connection);
          connection.release();
          return result;
        } catch (error) {
          openTransactions.delete(connection);
          await connection.query("ROLLBACK").then(
            () => {
              connection.release();
            },
            () => {
              connection.destroy();
            },
          );
          throw error;
        }
      }),
    onTransactionCommit: (txCtx, callback) => {
      requireTxHooks(txCtx).onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      requireTxHooks(txCtx).onRollback(callback);
    },
    isTransaction: (txCtx) => openTransactions.has(txCtx.connection),
    classifyError: classifyMysqlError,
    executeSql: async ({ txCtx, id, sql, params }) => {
      if (txCtx) return exec(txCtx.connection, id, sql, params);
      const connection = await pool.getConnection();
      try {
        return await exec(connection, id, sql, params);
      } finally {
        connection.release();
      }
    },
  };
};
