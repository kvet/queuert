import { type UUID } from "node:crypto";

import { isThenable } from "@queuert/helpers";
import Database from "better-sqlite3";
import { type StateAdapter, type StateAdapterMode } from "queuert";
import { createFlakyBatchGenerator } from "queuert/testing";
import { type TestAPI, expect } from "vitest";

import {
  createAsyncSqliteStateAdapter,
  createSyncSqliteStateAdapter,
} from "../state-adapter/state-adapter.sqlite.js";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
  createBetterSqlite3SyncProvider,
} from "../state-provider/state-provider.better-sqlite3.js";
import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";

type AnyModeProvider = SqliteStateProvider<BetterSqlite3Context, StateAdapterMode>;

export type BetterSqlite3StateAdapter = StateAdapter<BetterSqlite3Context, UUID>;

export const extendWithStateSqlite = <T>(
  api: TestAPI<T>,
  { mode = "async" }: { mode?: StateAdapterMode } = {},
): TestAPI<
  T & {
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string, any>;
    transactionConcurrency: "concurrent" | "serialized";
    flakyStateAdapter: StateAdapter<{ $test: true }, string, any>;
    flakyDbStateAdapter: StateAdapter<{ $test: true }, string, any> | undefined;
    poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
    withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
    withSavepoint:
      | (<T>(txCtx: { $test: true }, fn: (txCtx: { $test: true }) => T) => T)
      | undefined;
  }
> => {
  const createStateAdapter = async (
    stateProvider: AnyModeProvider,
  ): Promise<StateAdapter<BetterSqlite3Context, UUID, StateAdapterMode>> =>
    mode === "sync"
      ? createSyncSqliteStateAdapter({
          stateProvider: stateProvider as SqliteStateProvider<BetterSqlite3Context, "sync">,
        })
      : createAsyncSqliteStateAdapter({
          stateProvider: stateProvider as SqliteStateProvider<BetterSqlite3Context>,
        });

  return api.extend<{
    db: Database.Database;
    _dbMigrateToLatest: void;
    _dbCleanup: void;
    stateProvider: AnyModeProvider;
    flakyStateProvider: AnyModeProvider;
    flakyDbStateProvider: AnyModeProvider;
    stateAdapter: StateAdapter<BetterSqlite3Context, UUID, StateAdapterMode>;
    transactionConcurrency: "concurrent" | "serialized";
    flakyStateAdapter: StateAdapter<BetterSqlite3Context, UUID, StateAdapterMode>;
    flakyDbStateAdapter: StateAdapter<BetterSqlite3Context, UUID, StateAdapterMode> | undefined;
    poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
    withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
    withSavepoint:
      | (<T>(txCtx: { $test: true }, fn: (txCtx: { $test: true }) => T) => T)
      | undefined;
  }>({
    db: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = new Database(":memory:");
        await use(db);
        db.close();
      },
      { scope: "worker" },
    ],
    _dbMigrateToLatest: [
      async ({ db }, use) => {
        const stateProvider = createBetterSqlite3Provider({ db });
        const stateAdapter = createAsyncSqliteStateAdapter({ stateProvider });

        await stateAdapter.migrateToLatest();

        await use();
      },
      { scope: "worker" },
    ],
    _dbCleanup: [
      async ({ db }, use) => {
        await use();

        db.exec("DELETE FROM queuert_job_blocker;");
        db.exec("DELETE FROM queuert_job;");
      },
      { scope: "test" },
    ],
    stateProvider: [
      async ({ db, _dbMigrateToLatest, _dbCleanup }, use) => {
        // oxlint-disable-next-line no-unused-expressions
        _dbMigrateToLatest;
        // oxlint-disable-next-line no-unused-expressions
        _dbCleanup;

        return use(
          mode === "sync"
            ? createBetterSqlite3SyncProvider({ db })
            : createBetterSqlite3Provider({ db }),
        );
      },
      { scope: "test" },
    ],
    flakyStateProvider: [
      async ({ stateProvider }, use) => {
        let queryCount = 0;
        let errorCount = 0;
        const shouldError = createFlakyBatchGenerator();

        const originalExecuteSql = stateProvider.executeSql.bind(stateProvider);
        const flakyStateProvider: typeof stateProvider = {
          ...stateProvider,
          executeSql: ({ txCtx, sql, params, paramTypes, columnTypes, readOnly }) => {
            queryCount++;

            if (shouldError()) {
              errorCount++;
              const error = new Error("SQLITE_BUSY: database is locked") as Error & {
                code: string;
              };
              error.code = "SQLITE_BUSY";
              throw error;
            }

            return originalExecuteSql({ txCtx, sql, params, paramTypes, columnTypes, readOnly });
          },
        };

        await use(flakyStateProvider);

        if (queryCount > 5) {
          expect(errorCount).toBeGreaterThan(0);
        }
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ stateProvider }, use) => {
        return use(await createStateAdapter(stateProvider));
      },
      { scope: "test" },
    ],
    flakyStateAdapter: [
      async ({ flakyStateProvider }, use) => {
        return use(await createStateAdapter(flakyStateProvider));
      },
      { scope: "test" },
    ],
    transactionConcurrency: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use("serialized");
      },
      { scope: "test" },
    ],
    withSavepoint: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(<R>(txCtx: { $test: true }, fn: (txCtx: { $test: true }) => R): R => {
          const { db } = txCtx as unknown as BetterSqlite3Context;
          db.exec("SAVEPOINT queuert_test");
          const release = () => db.exec("RELEASE queuert_test");
          const rollback = () => db.exec("ROLLBACK TO queuert_test");
          let result: R;
          try {
            result = fn(txCtx);
          } catch (error) {
            rollback();
            throw error;
          }
          if (!isThenable(result)) {
            release();
            return result;
          }
          return Promise.resolve(result).then(
            (value) => {
              release();
              return value;
            },
            (error: unknown) => {
              rollback();
              throw error;
            },
          ) as R;
        });
      },
      { scope: "test" },
    ],
    poisonTransaction: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(undefined);
      },
      { scope: "test" },
    ],
    withNonTransactionContext: [
      async ({ db }, use) => {
        await use(async (fn) => {
          const sqliteCtx: BetterSqlite3Context = { db };
          return fn(sqliteCtx as unknown as { $test: true });
        });
      },
      { scope: "test" },
    ],
    flakyDbStateProvider: [
      async ({ stateProvider }, use) => {
        let enabled = true;
        let queryCount = 0;
        let errorCount = 0;
        const shouldError = createFlakyBatchGenerator();

        const originalExecuteSql = stateProvider.executeSql.bind(stateProvider);
        const flakyDbProvider: typeof stateProvider = {
          ...stateProvider,
          executeSql: ({ txCtx, sql, params, paramTypes, columnTypes, readOnly }) => {
            queryCount++;

            if (enabled && shouldError()) {
              errorCount++;
              return originalExecuteSql({
                txCtx,
                sql: "SELECT 1 FROM nonexistent_table_queuert_poison_xyz",
                params: [],
                paramTypes: {},
                columnTypes: { _: "number" },
                readOnly: true,
              });
            }

            return originalExecuteSql({ txCtx, sql, params, paramTypes, columnTypes, readOnly });
          },
        };

        await use(flakyDbProvider);

        enabled = false;
        await new Promise((resolve) => setTimeout(resolve, 50));

        if (queryCount > 5) {
          expect(errorCount).toBeGreaterThan(0);
        }
      },
      { scope: "test" },
    ],
    flakyDbStateAdapter: [
      async ({ flakyDbStateProvider }, use) => {
        return use(await createStateAdapter(flakyDbStateProvider));
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithStateSqlite<T>>;
};
