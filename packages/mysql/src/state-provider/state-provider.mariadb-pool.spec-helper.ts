import type { Pool, PoolConnection, Prepare } from "mariadb";
import { type TxHooks, withTxHooks } from "queuert";

import type { MysqlStateProvider } from "./state-provider.mysql.ts";
import { classifyMysqlError } from "./state-provider.mysql2-pool.ts";

export type MariadbPoolContext = { connection: PoolConnection; txHooks: TxHooks };

export type MariadbPoolProvider = MysqlStateProvider<MariadbPoolContext>;

type Statement = Parameters<MariadbPoolProvider["executeStatements"]>[0]["statements"][number];

const toRows = (rows: unknown): unknown[] => (Array.isArray(rows) ? (rows as unknown[]) : []);

const throwFirstRejection = (settled: PromiseSettledResult<unknown[]>[]): unknown[][] => {
  const rejected = settled.find((result) => result.status === "rejected");
  if (rejected !== undefined) throw rejected.reason;
  return settled.map((result) => (result as PromiseFulfilledResult<unknown[]>).value);
};

const pipelineOnMariadb = async (
  connection: PoolConnection,
  statements: Statement[],
): Promise<unknown[][]> =>
  throwFirstRejection(
    await Promise.allSettled(
      statements.map(async ({ id, sql, params }) =>
        toRows(
          id !== undefined
            ? await connection.execute(sql, params)
            : await connection.query(sql, params),
        ),
      ),
    ),
  );

const pipelineOnMysql = async (
  connection: PoolConnection,
  statements: Statement[],
): Promise<unknown[][]> => {
  const prepares = await Promise.allSettled(
    statements.map(async ({ id, sql }) => (id !== undefined ? connection.prepare(sql) : undefined)),
  );
  try {
    const failedPrepareIndex = prepares.findIndex((result) => result.status === "rejected");
    const runnable =
      failedPrepareIndex === -1 ? statements : statements.slice(0, failedPrepareIndex);
    const results = throwFirstRejection(
      await Promise.allSettled(
        runnable.map(async ({ sql, params }, index) => {
          const prepare = (prepares[index] as PromiseFulfilledResult<Prepare | undefined>).value;
          return toRows(
            prepare !== undefined
              ? await prepare.execute(params)
              : await connection.query(sql, params),
          );
        }),
      ),
    );
    if (failedPrepareIndex !== -1) {
      throw (prepares[failedPrepareIndex] as PromiseRejectedResult).reason;
    }
    return results;
  } finally {
    for (const result of prepares) {
      if (result.status === "fulfilled") result.value?.close();
    }
  }
};

const pipeline = async (
  connection: PoolConnection,
  statements: Statement[],
): Promise<unknown[][]> =>
  connection.info?.isMariaDB() === true
    ? pipelineOnMariadb(connection, statements)
    : pipelineOnMysql(connection, statements);

const textStatement = (sql: string): Statement => ({
  sql,
  params: [],
  paramTypes: {},
  columnTypes: {},
  readOnly: false,
});

export const createMariadbPoolProvider = ({ pool }: { pool: Pool }): MariadbPoolProvider => {
  const openTransactions = new WeakSet<PoolConnection>();

  const finish = async (connection: PoolConnection, statement: "COMMIT" | "ROLLBACK") => {
    await pipeline(connection, [textStatement(statement), textStatement("SET autocommit = 1")]);
  };

  return {
    withTransaction: async (fn) =>
      withTxHooks(async (txHooks) => {
        const connection = await pool.getConnection();
        const txCtx: MariadbPoolContext = { connection, txHooks };
        try {
          await pipeline(connection, [
            textStatement("SET TRANSACTION ISOLATION LEVEL READ COMMITTED"),
            textStatement("SET autocommit = 0"),
          ]);
          openTransactions.add(connection);
          const result = await fn(txCtx);
          await finish(connection, "COMMIT");
          openTransactions.delete(connection);
          await connection.release();
          return result;
        } catch (error) {
          openTransactions.delete(connection);
          await finish(connection, "ROLLBACK").then(
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
    classifyError: classifyMysqlError,
    executeStatements: async ({ txCtx, statements }) => {
      if (statements.length === 0) return [];
      if (txCtx) return pipeline(txCtx.connection, statements);
      const connection = await pool.getConnection();
      try {
        return await pipeline(connection, statements);
      } finally {
        await connection.release();
      }
    },
  };
};

export const withMariadbPoolNonTransactionContext =
  (pool: Pool) =>
  async <T>(fn: (txCtx: MariadbPoolContext) => Promise<T>): Promise<T> => {
    const connection = await pool.getConnection();
    try {
      return await fn({ connection } as MariadbPoolContext);
    } finally {
      await connection.release();
    }
  };

export const withMariadbPoolSavepoint = async <T>(
  txCtx: MariadbPoolContext,
  fn: (txCtx: MariadbPoolContext) => Promise<T>,
): Promise<T> => {
  await txCtx.connection.query("SAVEPOINT queuert_test");
  const txHooksSavepoint = txCtx.txHooks.createSavepoint();
  try {
    const result = await fn(txCtx);
    await txCtx.connection.query("RELEASE SAVEPOINT queuert_test");
    txHooksSavepoint.release();
    return result;
  } catch (error) {
    await txCtx.connection.query("ROLLBACK TO SAVEPOINT queuert_test");
    txHooksSavepoint.rollback();
    throw error;
  }
};
