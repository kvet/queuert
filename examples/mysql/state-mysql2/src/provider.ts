import type { MysqlStateProvider } from "@queuert/mysql";
import type { Pool, PoolConnection } from "mysql2/promise";
import { type TxHooks, withTxHooks } from "queuert";

export type Mysql2PoolContext = { connection: PoolConnection; txHooks: TxHooks };

export const createMysql2PoolStateProvider = ({
  pool,
}: {
  pool: Pool;
}): MysqlStateProvider<Mysql2PoolContext> => {
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
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) => {
        const connection = await pool.getConnection();
        const txCtx: Mysql2PoolContext = { connection, txHooks };
        try {
          await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
          await connection.query("START TRANSACTION");
          openTransactions.add(connection);
          const result = await cb(txCtx);
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
    isTransaction: (txCtx) => openTransactions.has(txCtx.connection),
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError: ({ error }) => {
      const driverError = error as { errno?: unknown; message?: unknown } | undefined;
      switch (driverError?.errno) {
        case 1146: {
          const tableName = /Table '([^']+)' doesn't exist/.exec(String(driverError.message))?.[1];
          return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
        }
        default:
          return undefined;
      }
    },
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
