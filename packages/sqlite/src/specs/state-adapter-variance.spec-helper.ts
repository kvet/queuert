import Database from "better-sqlite3";
import { type StateAdapter } from "queuert";
import { type TestAPI } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.js";

export const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VarianceFixtures = {
  db: Database.Database;
  stateAdapter: StateAdapter<{ $test: true }, string>;
  tableNames: string[];
};

export const extendWithVarianceStateSqlite = <T>(
  api: TestAPI<T>,
  options: { tablePrefix: string; idType?: string; generateId?: () => string },
): TestAPI<T & VarianceFixtures> => {
  return api.extend<VarianceFixtures>({
    db: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = new Database(":memory:");
        db.pragma("journal_mode = WAL");
        db.pragma("auto_vacuum = INCREMENTAL");
        db.pragma("foreign_keys = ON");
        await use(db);
        db.close();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ db }, use) => {
        const stateProvider = createBetterSqlite3Provider({ db });
        const adapter = await createSqliteStateAdapter({ stateProvider, ...options });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
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
