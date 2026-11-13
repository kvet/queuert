// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import Database from "better-sqlite3";
import { it as baseIt, describe, expect } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.ts";

const it = baseIt.extend("db", async ({}, { onCleanup }) => {
  const db = new Database(":memory:");
  onCleanup(async () => {
    db.close();
  });
  return db;
});

const createAdapterReportingVersion = (db: Database.Database, version: string) => {
  const stateProvider = createBetterSqlite3Provider({ db });
  return createSqliteStateAdapter({
    stateProvider: {
      ...stateProvider,
      executeSql: async (options) => {
        const rows = await stateProvider.executeSql(options);
        return options.id?.startsWith("serverVersion@")
          ? rows.map((row) => ({ ...(row as object), version }))
          : rows;
      },
    },
  });
};

describe("createSqliteStateAdapter server checks", () => {
  it("migrateToLatest accepts the SQLite version the driver bundles", async ({ db }) => {
    const stateAdapter = createSqliteStateAdapter({
      stateProvider: createBetterSqlite3Provider({ db }),
    });

    await expect(stateAdapter.migrateToLatest()).resolves.toBeDefined();
  });

  it.for(["3.41.2", "3.9.0", "2.99.0"])(
    "migrateToLatest rejects SQLite %s as below the minimum version",
    async (version, { db }) => {
      await expect(createAdapterReportingVersion(db, version).migrateToLatest()).rejects.toThrow(
        `Unsupported SQLite version ${version}: Queuert needs 3.42 or later`,
      );
      expect(db.prepare("SELECT name FROM sqlite_master").all()).toEqual([]);
    },
  );

  it.for(["3.42.0", "3.100.0", "4.0.0"])(
    "migrateToLatest accepts SQLite %s",
    async (version, { db }) => {
      await expect(
        createAdapterReportingVersion(db, version).migrateToLatest(),
      ).resolves.toBeDefined();
    },
  );
});
