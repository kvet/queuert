import Database from "better-sqlite3";
import type { SchemaFenceConformanceFixture } from "queuert/conformance-internal";
import type { ConformanceFixtures } from "queuert/testing";
import type { TestAPI } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.ts";

export type VarianceFixtures = ConformanceFixtures<SchemaFenceConformanceFixture> & {
  db: Database.Database;
  tableNames: string[];
};

export const extendWithVarianceStateSqlite = <T>(
  api: TestAPI<T>,
  options: {
    tablePrefix: string;
    jobIdType?: string;
    workerIdType?: string;
    generateJobId?: () => string;
    validateJobId?: (id: string) => boolean;
    generateWorkerId?: () => string;
    validateWorkerId?: (id: string) => boolean;
    maxBlockersPerJob?: number;
    countCap?: number;
  },
): TestAPI<T & VarianceFixtures> => {
  return api.extend<VarianceFixtures>({
    db: [
      // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
      async ({}, use) => {
        const db = new Database(":memory:");
        await use(db);
        db.close();
      },
      { scope: "file" },
    ],
    conformance: [
      async ({ db }, use) => {
        const stateAdapter = createSqliteStateAdapter({
          stateProvider: createBetterSqlite3Provider({ db }),
          ...options,
        });
        await stateAdapter.migrateToLatest();
        const fenceTable = `${options.tablePrefix}schema_fence_v1`;
        await use({
          stateAdapter,
          withWritesFenced: async (fn) => {
            db.exec(`DROP TABLE ${fenceTable}`);
            try {
              return await fn();
            } finally {
              db.exec(`CREATE TABLE ${fenceTable} (id INTEGER PRIMARY KEY)`);
            }
          },
          reset: async () => stateAdapter.truncate(),
        });
      },
      { scope: "file" },
    ],
    tableNames: [
      async ({ db, conformance: _ }, use) => {
        const tables = db
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?`)
          .all(`${options.tablePrefix}%`) as { name: string }[];
        await use(tables.map((table) => table.name));
      },
      { scope: "file" },
    ],
  }) as ReturnType<typeof extendWithVarianceStateSqlite<T>>;
};
