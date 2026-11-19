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

  const settle = async (pending: Promise<unknown>[]): Promise<unknown[][]> => {
    const results = await Promise.allSettled(pending);
    return results.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return Array.isArray(result.value) ? result.value : [];
    });
  };

  const executeBatch = async (
    connection: PoolConnection,
    statements: { id?: string; sql: string; params: unknown[] }[],
  ): Promise<unknown[][]> =>
    settle(
      statements.map(async ({ id, sql, params }) =>
        id !== undefined ? connection.execute(sql, params) : connection.query(sql, params),
      ),
    );

  const finishTransaction = async (
    connection: PoolConnection,
    statement: "COMMIT" | "ROLLBACK",
  ): Promise<void> => {
    await settle([connection.query(statement), connection.query("SET autocommit = 1")]);
  };

  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) => {
        const connection = await pool.getConnection();
        const txCtx: MariadbPoolContext = { connection, txHooks };
        try {
          await settle([
            connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED"),
            connection.query("SET autocommit = 0"),
          ]);
          openTransactions.add(connection);
          const result = await cb(txCtx);
          await finishTransaction(connection, "COMMIT");
          openTransactions.delete(connection);
          await connection.release();
          return result;
        } catch (error) {
          openTransactions.delete(connection);
          await finishTransaction(connection, "ROLLBACK").then(
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
        default:
          return undefined;
      }
    },
    executeStatements: async ({ txCtx, statements }) => {
      if (txCtx) return executeBatch(txCtx.connection, statements);
      const connection = await pool.getConnection();
      try {
        return await executeBatch(connection, statements);
      } finally {
        await connection.release();
      }
    },
  };
};
