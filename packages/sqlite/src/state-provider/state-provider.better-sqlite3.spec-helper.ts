import type { BetterSqlite3Context } from "./state-provider.better-sqlite3.ts";

export const withBetterSqlite3Savepoint = async <T>(
  txCtx: BetterSqlite3Context,
  fn: (txCtx: BetterSqlite3Context) => Promise<T>,
): Promise<T> => {
  txCtx.db.exec("SAVEPOINT queuert_test");
  const txHooksSavepoint = txCtx.txHooks.createSavepoint();
  try {
    const result = await fn(txCtx);
    txCtx.db.exec("RELEASE queuert_test");
    txHooksSavepoint.release();
    return result;
  } catch (error) {
    txCtx.db.exec("ROLLBACK TO queuert_test");
    txHooksSavepoint.rollback();
    throw error;
  }
};
