import Database from "better-sqlite3";
import { UUID } from "crypto";
import { type StateAdapter } from "queuert";
import { createFlakyBatchGenerator } from "queuert/testing";
import { type TestAPI } from "vitest";
import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import {
  BetterSqlite3Provider,
  createBetterSqlite3Provider,
  SqliteContext,
} from "./state-provider.better-sqlite3.js";

export type SqliteStateAdapter = StateAdapter<SqliteContext, UUID>;

export const extendWithStateSqlite = <T>(
  api: TestAPI<T>,
): TestAPI<
  T & {
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    flakyStateAdapter: StateAdapter<{ $test: true }, string>;
  }
> => {
  return api.extend<{
    db: Database.Database;
    _dbMigrateToLatest: void;
    _dbCleanup: void;
    stateProvider: BetterSqlite3Provider;
    flakyStateProvider: BetterSqlite3Provider;
    stateAdapter: SqliteStateAdapter;
    flakyStateAdapter: SqliteStateAdapter;
  }>({
    db: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = new Database(":memory:");
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");

        await use(db);

        db.close();
      },
      { scope: "worker" },
    ],
    _dbMigrateToLatest: [
      async ({ db }, use) => {
        const stateProvider = createBetterSqlite3Provider({ db: db });
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
      async ({ stateProvider, expect }, use) => {
        let queryCount = 0;
        let errorCount = 0;
        const shouldError = createFlakyBatchGenerator();

        const originalExecuteSql = stateProvider.executeSql.bind(stateProvider);
        const flakyStateProvider: typeof stateProvider = {
          ...stateProvider,
          executeSql: async ({ txContext, sql, params, returns }) => {
            queryCount++;

            if (shouldError()) {
              errorCount++;
              const error = new Error("SQLITE_BUSY: database is locked") as Error & {
                code: string;
              };
              error.code = "SQLITE_BUSY";
              throw error;
            }

            return originalExecuteSql({ txContext, sql, params, returns });
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
            connectionRetryConfig: {
              maxAttempts: 3,
              initialDelayMs: 1,
              multiplier: 1,
              maxDelayMs: 1,
            },
          }),
        );
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithStateSqlite<T>>;
};
