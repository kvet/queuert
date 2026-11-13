import { createAsyncRwLock } from "@queuert/helpers/async-rw-lock";
import { type MaybePromise, andThen } from "@queuert/helpers/maybe-promise";
import { sleep } from "@queuert/helpers/sleep";
import type Database from "better-sqlite3";
import type { AdapterMode } from "queuert";
import type { ConformanceNotifyAdapter, ConformanceStateAdapter } from "queuert/conformance";
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
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.ts";
import type {
  AnySqliteStateProvider,
  ModeSqliteStateProvider,
} from "../state-provider/state-provider.sqlite.ts";

type StatementOptions = Parameters<ModeSqliteStateProvider<BetterSqlite3Context>["executeSql"]>[0];

type FailStatement = (
  executeSql: ModeSqliteStateProvider<BetterSqlite3Context>["executeSql"],
  options: StatementOptions,
) => MaybePromise<unknown[]>;

const createFlakyStateAdapter = (
  mode: AdapterMode,
  createStateProvider: () => AnySqliteStateProvider<BetterSqlite3Context>,
  failStatement: FailStatement,
): ConformanceStateAdapter => {
  const stateProvider: ModeSqliteStateProvider<BetterSqlite3Context> = createStateProvider();
  const executeSql = stateProvider.executeSql.bind(stateProvider);
  const shouldError = createFlakyBatchGenerator();
  let enabled = true;
  let statementCount = 0;
  let errorCount = 0;

  const stateAdapter: ConformanceStateAdapter = createSqliteStateAdapter({
    stateProvider: {
      ...stateProvider,
      executeSql: (options: StatementOptions) => {
        statementCount++;
        if (enabled && shouldError()) {
          errorCount++;
          return failStatement(executeSql, options);
        }
        return executeSql(options);
      },
    } as AnySqliteStateProvider<BetterSqlite3Context>,
  });

  const close = (): MaybePromise<void> => {
    enabled = false;
    return andThen(mode === "sync" ? undefined : sleep(50), () =>
      andThen(stateAdapter.close(), () => {
        if (statementCount > 5 && errorCount === 0) {
          throw new Error(`the flaky provider failed none of its ${statementCount} statements`);
        }
      }),
    );
  };
  return mode === "sync"
    ? {
        ...stateAdapter,
        close,
        [Symbol.dispose]: (): void => {
          void close();
        },
      }
    : { ...stateAdapter, close, [Symbol.asyncDispose]: async () => close() };
};

const failWithDatabaseError: FailStatement = (executeSql, options) =>
  executeSql({
    txCtx: options.txCtx,
    sql: "SELECT 1 FROM nonexistent_table_queuert_poison_xyz",
    params: [],
    paramTypes: {},
    columnTypes: { _: "number" },
    readOnly: true,
  });

const failWithConnectionError =
  (mode: AdapterMode): FailStatement =>
  () => {
    const error = new Error("SQLITE_BUSY: database is locked") as Error & { code: string };
    error.code = "SQLITE_BUSY";
    if (mode === "sync") throw error;
    return Promise.reject(error);
  };

export const createSqliteEndToEndContext = async ({
  db,
  mode,
  createNotifyAdapter,
}: {
  db: Database.Database;
  mode: AdapterMode;
  createNotifyAdapter?: () => MaybePromise<ConformanceNotifyAdapter>;
}): Promise<EndToEndSavepointContext & EndToEndFlakyDbContext> => {
  const lock = createAsyncRwLock();
  const createStateProvider = (): AnySqliteStateProvider<BetterSqlite3Context> =>
    createBetterSqlite3Provider({ db, lock, mode });
  const withNonTransactionContext = <T>(fn: (txCtx: BetterSqlite3Context) => T): T =>
    fn({ db } as BetterSqlite3Context);
  return {
    ...(mode === "sync"
      ? createSqliteStateProviderConformanceContext({
          createStateProvider: () => createBetterSqlite3Provider({ db, mode }),
          withNonTransactionContext,
          withSavepoint: withBetterSqlite3Savepoint,
        })
      : await createSqliteStateProviderConformanceContext({
          createStateProvider: async () => createBetterSqlite3Provider({ db, lock }),
          withNonTransactionContext,
          withSavepoint: withBetterSqlite3Savepoint,
        })),
    withSavepoint: withBetterSqlite3Savepoint,
    createNotifyAdapter,
    createFlakyDbStateAdapter: () =>
      createFlakyStateAdapter(mode, createStateProvider, failWithDatabaseError),
    createFlakyConnectionStateAdapter: () =>
      createFlakyStateAdapter(mode, createStateProvider, failWithConnectionError(mode)),
  };
};
