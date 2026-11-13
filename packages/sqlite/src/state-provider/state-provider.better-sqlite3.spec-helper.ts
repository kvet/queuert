import { andThen, tryCatch } from "@queuert/helpers/maybe-promise";

import type { BetterSqlite3Context } from "./state-provider.better-sqlite3.ts";

export const withBetterSqlite3Savepoint = <T>(
  txCtx: BetterSqlite3Context,
  fn: (txCtx: BetterSqlite3Context) => T,
): T => {
  txCtx.db.exec("SAVEPOINT queuert_test");
  const txHooksSavepoint = txCtx.txHooks.createSavepoint();
  return tryCatch(
    () =>
      andThen(fn(txCtx), (result) => {
        txCtx.db.exec("RELEASE queuert_test");
        txHooksSavepoint.release();
        return result;
      }),
    (error) => {
      txCtx.db.exec("ROLLBACK TO queuert_test");
      txHooksSavepoint.rollback();
      throw error;
    },
  ) as T;
};
