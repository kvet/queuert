import { createAsyncRwLock } from "@queuert/helpers/async-rw-lock";
import { sleep } from "@queuert/helpers/sleep";
import { type MaybePromise, syncAsync, step, type Mode } from "@queuert/sync-async";
import type Database from "better-sqlite3";
import type { NotifyAdapter, StateAdapter } from "queuert";
import {
  type EndToEndFlakyDbContext,
  type EndToEndSavepointContext,
  createFlakyBatchGenerator,
  runInModeOf,
} from "queuert/conformance-internal";

import { createSqliteStateProviderConformanceContext } from "../conformance/state-provider-conformance.ts";
import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import { withBetterSqlite3Savepoint } from "../state-provider/state-provider.better-sqlite3.spec-helper.ts";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.ts";
import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";

const createFlakyStateAdapter = (
  mode: Mode,
  stateProvider: SqliteStateProvider<BetterSqlite3Context, Mode>,
  failStatement: (
    executeStatement: SqliteStateProvider<BetterSqlite3Context, Mode>["executeStatement"],
    options: Parameters<SqliteStateProvider<BetterSqlite3Context, Mode>["executeStatement"]>[0],
  ) => MaybePromise<unknown[]>,
): StateAdapter<any, any, any, Mode> => {
  const executeStatement = stateProvider.executeStatement.bind(stateProvider);
  const shouldError = createFlakyBatchGenerator();
  let enabled = true;
  let statementCount = 0;
  let errorCount = 0;

  const stateAdapter: StateAdapter<any, any, any, Mode> = createSqliteStateAdapter({
    stateProvider: {
      ...stateProvider,
      executeStatement: (options) => {
        statementCount++;
        if (enabled && shouldError()) {
          errorCount++;
          return failStatement(executeStatement, options);
        }
        return executeStatement(options);
      },
    },
  });

  const close = (): MaybePromise<void> =>
    runInModeOf(
      stateAdapter,
      syncAsync(function* () {
        enabled = false;
        if (mode === "async") yield* step(sleep(50));
        yield* step(stateAdapter.close());
        if (statementCount > 5 && errorCount === 0) {
          throw new Error(`the flaky provider failed none of its ${statementCount} statements`);
        }
      }),
    );
  const closeSync = (): void => {
    void close();
  };
  return stateAdapter.sync === true
    ? { ...stateAdapter, close: closeSync, [Symbol.dispose]: closeSync }
    : { ...stateAdapter, close: async () => close(), [Symbol.asyncDispose]: async () => close() };
};

export const createEndToEndContext = async (
  db: Database.Database,
  mode: Mode,
  createNotifyAdapter?: () => MaybePromise<NotifyAdapter<Mode>>,
): Promise<EndToEndSavepointContext & EndToEndFlakyDbContext> => {
  const lock = createAsyncRwLock();
  const withNonTransactionContext = <T>(fn: (txCtx: BetterSqlite3Context) => T): T =>
    fn({ db } as BetterSqlite3Context);
  return {
    ...(mode === "sync"
      ? createSqliteStateProviderConformanceContext({
          mode: "sync",
          createStateProvider: () => createBetterSqlite3Provider({ db, mode: "sync" }),
          withNonTransactionContext,
          withSavepoint: withBetterSqlite3Savepoint("sync"),
        })
      : createSqliteStateProviderConformanceContext({
          mode: "async",
          createStateProvider: async () => createBetterSqlite3Provider({ db, lock }),
          withNonTransactionContext,
          withSavepoint: withBetterSqlite3Savepoint("async"),
        })),
    withSavepoint: withBetterSqlite3Savepoint(mode),
    createNotifyAdapter,
    createFlakyDbStateAdapter: () =>
      createFlakyStateAdapter(
        mode,
        createBetterSqlite3Provider({ db, lock, mode }),
        (executeStatement, options) =>
          executeStatement({
            txCtx: options.txCtx,
            sql: "SELECT 1 FROM nonexistent_table_queuert_poison_xyz",
            params: [],
            paramTypes: {},
            columnTypes: { _: "number" },
            readOnly: true,
          }),
      ),
    createFlakyConnectionStateAdapter: () =>
      createFlakyStateAdapter(mode, createBetterSqlite3Provider({ db, lock, mode }), () => {
        const error = new Error("SQLITE_BUSY: database is locked") as Error & { code: string };
        error.code = "SQLITE_BUSY";
        if (mode === "sync") throw error;
        return Promise.reject(error);
      }),
  };
};
