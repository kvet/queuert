import type { Pool } from "pg";

import type { PgPoolContext } from "./state-provider.pg-pool.ts";

export const withPgPoolNonTransactionContext =
  (pool: Pool) =>
  async <T>(fn: (txCtx: PgPoolContext) => Promise<T>): Promise<T> => {
    const poolClient = await pool.connect();
    try {
      return await fn({ poolClient } as PgPoolContext);
    } finally {
      poolClient.release();
    }
  };

export const withPgPoolSavepoint = async <T>(
  txCtx: PgPoolContext,
  fn: (txCtx: PgPoolContext) => Promise<T>,
): Promise<T> => {
  await txCtx.poolClient.query("SAVEPOINT queuert_test");
  const txHooksSavepoint = txCtx.txHooks.createSavepoint();
  try {
    const result = await fn(txCtx);
    await txCtx.poolClient.query("RELEASE SAVEPOINT queuert_test");
    txHooksSavepoint.release();
    return result;
  } catch (error) {
    await txCtx.poolClient.query("ROLLBACK TO SAVEPOINT queuert_test");
    txHooksSavepoint.rollback();
    throw error;
  }
};
