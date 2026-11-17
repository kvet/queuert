import type { MysqlStateProvider } from "@queuert/mysql";
import type { Pool, PoolConnection } from "mariadb";
import { type TxHooks, withTxHooks } from "queuert";

export type MariadbPoolContext = { connection: PoolConnection; txHooks: TxHooks };

export const createMariadbPoolStateProvider = ({
  pool,
}: {
  pool: Pool;
}): MysqlStateProvider<MariadbPoolContext> => {
  const openTransactions = new WeakSet<PoolConnection>();

  const exec = async (
    connection: PoolConnection,
    id: string | undefined,
    sql: string,
    params: unknown[],
  ): Promise<unknown[]> => {
    const rows: unknown =
      id !== undefined
        ? await connection.execute(sql, params)
        : await connection.query(sql, params);
    return Array.isArray(rows) ? rows : [];
  };

  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) => {
        const connection = await pool.getConnection();
        const txCtx: MariadbPoolContext = { connection, txHooks };
        try {
          await connection.beginTransaction();
          openTransactions.add(connection);
          const result = await cb(txCtx);
          await connection.commit();
          openTransactions.delete(connection);
          await connection.release();
          return result;
        } catch (error) {
          openTransactions.delete(connection);
          await connection.rollback().then(
            async () => connection.release(),
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
        case 1020:
        case 1213:
          return { kind: "transaction_conflict" };
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
        await connection.release();
      }
    },
  };
};
