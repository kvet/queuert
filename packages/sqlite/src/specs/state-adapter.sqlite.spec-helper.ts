import { type UUID } from "node:crypto";

import Database from "better-sqlite3";
import { type StateAdapter } from "queuert";
import { createFlakyBatchGenerator } from "queuert/testing";
import { type TestAPI, expect } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import {
  type BetterSqlite3Context,
  type BetterSqlite3Provider,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.js";

export type BetterSqlite3StateAdapter = StateAdapter<BetterSqlite3Context, UUID>;

export const extendWithStateSqlite = <T>(
  api: TestAPI<T>,
): TestAPI<
  T & {
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    transactionConcurrency: "concurrent" | "serialized";
    flakyStateAdapter: StateAdapter<{ $test: true }, string>;
    flakyDbStateAdapter: StateAdapter<{ $test: true }, string> | undefined;
    poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
    withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
    withSavepoint:
      | (<T>(txCtx: { $test: true }, fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>)
      | undefined;
  }
> => {
  return api.extend<{
    db: Database.Database;
    _dbMigrateToLatest: void;
    _dbCleanup: void;
    stateProvider: BetterSqlite3Provider;
    flakyStateProvider: BetterSqlite3Provider;
    flakyDbStateProvider: BetterSqlite3Provider;
    stateAdapter: BetterSqlite3StateAdapter;
    transactionConcurrency: "concurrent" | "serialized";
    flakyStateAdapter: BetterSqlite3StateAdapter;
    flakyDbStateAdapter: BetterSqlite3StateAdapter | undefined;
    poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
    withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
    withSavepoint:
      | (<T>(txCtx: { $test: true }, fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>)
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
        const stateAdapter = await createSqliteStateAdapter({ stateProvider });

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

        return use(createBetterSqlite3Provider({ db }));
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
          executeSql: async ({ txCtx, sql, params, paramTypes, columnTypes, readOnly }) => {
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
        return use(await createSqliteStateAdapter({ stateProvider }));
      },
      { scope: "test" },
    ],
    flakyStateAdapter: [
      async ({ flakyStateProvider }, use) => {
        return use(
          await createSqliteStateAdapter({
            stateProvider: flakyStateProvider,
          }),
        );
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
        await use(async (txCtx, fn) => {
          const { db } = txCtx as unknown as BetterSqlite3Context;
          db.exec("SAVEPOINT queuert_test");
          try {
            const result = await fn(txCtx);
            db.exec("RELEASE queuert_test");
            return result;
          } catch (error) {
            db.exec("ROLLBACK TO queuert_test");
            throw error;
          }
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
          executeSql: async ({ txCtx, sql, params, paramTypes, columnTypes, readOnly }) => {
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
        return use(
          await createSqliteStateAdapter({
            stateProvider: flakyDbStateProvider,
          }),
        );
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithStateSqlite<T>>;
};
