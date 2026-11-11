import Database from "better-sqlite3";
import type { SchemaFenceConformanceContext } from "queuert/conformance-internal";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.ts";

type VarianceOptions = {
  tablePrefix: string;
  jobIdType?: string;
  workerIdType?: string;
  generateJobId?: () => string;
  validateJobId?: (id: string) => boolean;
  generateWorkerId?: () => string;
  validateWorkerId?: (id: string) => boolean;
  maxBlockersPerJob?: number;
  countCap?: number;
};

export const varianceDb = async (
  // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
  {}: object,
  { onCleanup }: { onCleanup: (cleanup: () => Promise<void>) => void },
): Promise<Database.Database> => {
  const db = new Database(":memory:");
  onCleanup(async () => {
    db.close();
  });
  return db;
};

export const varianceConformance =
  (options: VarianceOptions) =>
  async ({ db }: { db: Database.Database }): Promise<SchemaFenceConformanceContext> => {
    const createStateAdapter = () =>
      createSqliteStateAdapter({ stateProvider: createBetterSqlite3Provider({ db }), ...options });
    {
      await using stateAdapter = createStateAdapter();
      await stateAdapter.migrateToLatest();
    }
    const fenceTable = `${options.tablePrefix}schema_fence_v1`;
    return {
      createStateAdapter: async () => {
        db.exec(
          `DELETE FROM ${options.tablePrefix}job_blocker; DELETE FROM ${options.tablePrefix}job; DELETE FROM ${options.tablePrefix}worker;`,
        );
        return createStateAdapter();
      },
      withNonTransactionContext: async (fn) => fn({ db }),
      withWritesFenced: async (fn) => {
        db.exec(`DROP TABLE ${fenceTable}`);
        try {
          return await fn();
        } finally {
          db.exec(`CREATE TABLE ${fenceTable} (id INTEGER PRIMARY KEY)`);
        }
      },
    };
  };

export const varianceTableNames =
  (options: VarianceOptions) =>
  async ({
    db,
    conformance: _,
  }: {
    db: Database.Database;
    conformance: unknown;
  }): Promise<string[]> =>
    (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?`)
        .all(`${options.tablePrefix}%`) as { name: string }[]
    ).map((table) => table.name);
