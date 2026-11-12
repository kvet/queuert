import { sleep } from "@queuert/helpers/sleep";
import type Database from "better-sqlite3";
import type { NotifyAdapter, StateAdapter } from "queuert";
import {
  type EndToEndFlakyDbContext,
  type EndToEndSavepointContext,
  createFlakyBatchGenerator,
} from "queuert/conformance-internal";

import { createSqliteStateProviderConformanceContext } from "../conformance/state-provider-conformance.ts";
import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import { withBetterSqlite3Savepoint } from "../state-provider/state-provider.better-sqlite3.spec-helper.ts";
import {
  type BetterSqlite3Context,
  type BetterSqlite3Provider,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.ts";

const createFlakyStateAdapter = (
  db: Database.Database,
  failStatement: (
    executeSql: BetterSqlite3Provider["executeSql"],
    options: Parameters<BetterSqlite3Provider["executeSql"]>[0],
  ) => ReturnType<BetterSqlite3Provider["executeSql"]>,
): StateAdapter<any, any, any> => {
  const stateProvider = createBetterSqlite3Provider({ db });
  const executeSql = stateProvider.executeSql.bind(stateProvider);
  const shouldError = createFlakyBatchGenerator();
  let enabled = true;
  let statementCount = 0;
  let errorCount = 0;

  const stateAdapter = createSqliteStateAdapter({
    stateProvider: {
      ...stateProvider,
      executeSql: async (options) => {
        statementCount++;
        if (enabled && shouldError()) {
          errorCount++;
          return failStatement(executeSql, options);
        }
        return executeSql(options);
      },
    },
  });

  const close = async (): Promise<void> => {
    enabled = false;
    await sleep(50);
    await stateAdapter.close();
    if (statementCount > 5 && errorCount === 0) {
      throw new Error(`the flaky provider failed none of its ${statementCount} statements`);
    }
  };
  return { ...stateAdapter, close, [Symbol.asyncDispose]: close };
};

const failWithDatabaseError = async (
  executeSql: BetterSqlite3Provider["executeSql"],
  options: Parameters<BetterSqlite3Provider["executeSql"]>[0],
): ReturnType<BetterSqlite3Provider["executeSql"]> =>
  executeSql({
    txCtx: options.txCtx,
    sql: "SELECT 1 FROM nonexistent_table_queuert_poison_xyz",
    params: [],
    paramTypes: {},
    columnTypes: { _: "number" },
    readOnly: true,
  });

const failWithConnectionError = async (): Promise<never> => {
  const error = new Error("SQLITE_BUSY: database is locked") as Error & { code: string };
  error.code = "SQLITE_BUSY";
  throw error;
};

export const createSqliteEndToEndContext = async ({
  db,
  createNotifyAdapter,
}: {
  db: Database.Database;
  createNotifyAdapter?: () => Promise<NotifyAdapter>;
}): Promise<EndToEndSavepointContext & EndToEndFlakyDbContext> => ({
  ...(await createSqliteStateProviderConformanceContext({
    createStateProvider: async () => createBetterSqlite3Provider({ db }),
    withNonTransactionContext: async (fn) => {
      const sqliteCtx = { db } as BetterSqlite3Context;
      return fn(sqliteCtx);
    },
    withSavepoint: withBetterSqlite3Savepoint,
  })),
  withSavepoint: withBetterSqlite3Savepoint,
  createNotifyAdapter,
  createFlakyDbStateAdapter: async () => createFlakyStateAdapter(db, failWithDatabaseError),
  createFlakyConnectionStateAdapter: async () =>
    createFlakyStateAdapter(db, failWithConnectionError),
});
