import { type UUID } from "node:crypto";

import Database from "better-sqlite3";
import { type StateAdapter } from "queuert";
import { createFlakyBatchGenerator } from "queuert/testing";
import { type TestAPI, expect } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import {
  type BetterSqlite3Provider,
  type SqliteContext,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.js";

export type SqliteStateAdapter = StateAdapter<SqliteContext, UUID>;

export const extendWithStateSqlite = <T>(
  api: TestAPI<T>,
): TestAPI<
  T & {
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    flakyStateAdapter: StateAdapter<{ $test: true }, string>;
    flakyDbStateAdapter: StateAdapter<{ $test: true }, string> | undefined;
    poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
    poisonExecute:
      | ((cb: (adapter: StateAdapter<{ $test: true }, string>) => Promise<void>) => Promise<void>)
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
    stateAdapter: SqliteStateAdapter;
    flakyStateAdapter: SqliteStateAdapter;
    flakyDbStateAdapter: SqliteStateAdapter | undefined;
    poisonTransaction: ((txCtx: { $test: true }) => Promise<void>) | undefined;
    poisonExecute:
      | ((cb: (adapter: StateAdapter<{ $test: true }, string>) => Promise<void>) => Promise<void>)
      | undefined;
  }>({
    db: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = new Database(":memory:");
        db.pragma("journal_mode = WAL");
        db.pragma("auto_vacuum = INCREMENTAL");
        db.pragma("foreign_keys = ON");

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
    poisonTransaction: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(undefined);
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
            const shouldFail = shouldError();
            if (enabled && !txCtx && shouldFail) {
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
    poisonExecute: [
      async ({ stateProvider }, use) => {
        let poisoned = false;

        const poisonableProvider: typeof stateProvider = {
          ...stateProvider,
          executeSql: async ({ txCtx, sql, params, paramTypes, columnTypes, readOnly }) => {
            if (poisoned && !txCtx) {
              return stateProvider.executeSql({
                txCtx,
                sql: "SELECT 1 FROM nonexistent_table_queuert_poison_xyz",
                params: [],
                paramTypes: {},
                columnTypes: { _: "number" },
                readOnly: true,
              });
            }
            return stateProvider.executeSql({
              txCtx,
              sql,
              params,
              paramTypes,
              columnTypes,
              readOnly,
            });
          },
        };

        const poisonedAdapter = await createSqliteStateAdapter({
          stateProvider: poisonableProvider,
        });

        await use(async (cb: (adapter: StateAdapter<{ $test: true }, string>) => Promise<void>) => {
          poisoned = true;
          try {
            await cb(poisonedAdapter as unknown as StateAdapter<{ $test: true }, string>);
          } finally {
            poisoned = false;
          }
        });
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithStateSqlite<T>>;
};
