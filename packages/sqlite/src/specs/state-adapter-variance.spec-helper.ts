import Database from "better-sqlite3";
import { type StateAdapter } from "queuert";
import { type TestAPI } from "vitest";

import { createAsyncSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.js";

export type VarianceFixtures = {
  db: Database.Database;
  stateAdapter: StateAdapter<{ $test: true }, string>;
  transactionConcurrency: "concurrent" | "serialized";
  tableNames: string[];
};

export const extendWithVarianceStateSqlite = <T>(
  api: TestAPI<T>,
  options: {
    tablePrefix: string;
    idType?: string;
    generateId?: () => string;
    validateId?: (id: string) => boolean;
    maxBlockersPerJob?: number;
    countCap?: number;
  },
): TestAPI<T & VarianceFixtures> => {
  return api.extend<VarianceFixtures>({
    db: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = new Database(":memory:");
        await use(db);
        db.close();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ db }, use) => {
        const stateProvider = createBetterSqlite3Provider({ db });
        const adapter = createAsyncSqliteStateAdapter({ stateProvider, ...options });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
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
    tableNames: [
      async ({ db, stateAdapter: _ }, use) => {
        const tables = db
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?`)
          .all(`${options.tablePrefix}%`) as { name: string }[];
        await use(tables.map((table) => table.name));
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithVarianceStateSqlite<T>>;
};
