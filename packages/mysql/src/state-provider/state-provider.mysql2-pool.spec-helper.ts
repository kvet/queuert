import { type Pool, type PoolOptions, createPool } from "mysql2/promise";

import type { Mysql2PoolContext } from "./state-provider.mysql2-pool.ts";

export const withMysql2PoolNonTransactionContext =
  (pool: Pool) =>
  async <T>(fn: (txCtx: Mysql2PoolContext) => Promise<T>): Promise<T> => {
    const connection = await pool.getConnection();
    try {
      return await fn({ connection } as Mysql2PoolContext);
    } finally {
      connection.release();
    }
  };

export const withMysql2PoolSavepoint = async <T>(
  txCtx: Mysql2PoolContext,
  fn: (txCtx: Mysql2PoolContext) => Promise<T>,
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

export const createMysql2PoolAtLevel = (
  options: PoolOptions,
  level: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE",
  snapshotIsolation?: boolean,
): Pool => {
  const pool = createPool(options);
  pool.on("connection", (connection) => {
    void connection.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${level}`);
    if (snapshotIsolation !== undefined) {
      void connection.query(
        `SET SESSION innodb_snapshot_isolation = ${snapshotIsolation ? "ON" : "OFF"}`,
      );
    }
  });
  return pool;
};
