import { type Mode, step, syncAsync } from "@queuert/sync-async";

import type { BetterSqlite3Context } from "./state-provider.better-sqlite3.ts";

const savepoint = syncAsync(function* (
  txCtx: BetterSqlite3Context,
  fn: (txCtx: BetterSqlite3Context) => unknown,
) {
  txCtx.db.exec("SAVEPOINT queuert_test");
  const txHooksSavepoint = txCtx.txHooks.createSavepoint();
  try {
    const result = yield* step(fn(txCtx));
    txCtx.db.exec("RELEASE queuert_test");
    txHooksSavepoint.release();
    return result;
  } catch (error) {
    txCtx.db.exec("ROLLBACK TO queuert_test");
    txHooksSavepoint.rollback();
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
    throw error;
  }
});

export const withBetterSqlite3Savepoint =
  (mode: Mode) =>
  <T>(txCtx: BetterSqlite3Context, fn: (txCtx: BetterSqlite3Context) => T): T =>
    (mode === "sync" ? savepoint.sync(txCtx, fn) : savepoint.async(txCtx, fn)) as T;
