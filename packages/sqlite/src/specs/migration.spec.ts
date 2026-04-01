import Database from "better-sqlite3";
import { it as baseIt, describe, expect } from "vitest";

import { migrations } from "../state-adapter/sql.js";
import {
  type SqliteStateAdapter,
  createSqliteStateAdapter,
} from "../state-adapter/state-adapter.sqlite.js";
import {
  type SqliteContext,
  createBetterSqlite3Provider,
} from "./state-provider.better-sqlite3.js";

const it = baseIt.extend<{
  db: Database.Database;
  stateAdapter: SqliteStateAdapter<SqliteContext>;
}>({
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("auto_vacuum = INCREMENTAL");
    db.pragma("foreign_keys = ON");
    await use(db);
    db.close();
  },
  stateAdapter: async ({ db }, use) => {
    const stateProvider = createBetterSqlite3Provider({ db });
    await use(await createSqliteStateAdapter({ stateProvider }));
  },
});

describe("SQLite migrations", () => {
  it("fresh install applies all migrations", async ({ stateAdapter }) => {
    const result = await stateAdapter.migrateToLatest();

    expect(result.skipped).toEqual([]);
    expect(result.applied).toEqual(migrations.map((m) => m.name));
    expect(result.unrecognized).toEqual([]);
  });

  it("running twice is idempotent", async ({ stateAdapter }) => {
    const firstResult = await stateAdapter.migrateToLatest();
    expect(firstResult.applied.length).toBeGreaterThan(0);

    const secondResult = await stateAdapter.migrateToLatest();
    expect(secondResult.skipped).toEqual(migrations.map((m) => m.name));
    expect(secondResult.applied).toEqual([]);
    expect(secondResult.unrecognized).toEqual([]);
  });

  it("vacuum runs without error", async ({ stateAdapter }) => {
    await stateAdapter.migrateToLatest();

    await expect(stateAdapter.vacuum()).resolves.toBeUndefined();
  });

  it("migrateToLatest throws when auto_vacuum is not INCREMENTAL", async () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const stateProvider = createBetterSqlite3Provider({ db });
    const stateAdapter = await createSqliteStateAdapter({ stateProvider });

    await expect(stateAdapter.migrateToLatest()).rejects.toThrow("auto_vacuum");

    db.close();
  });

  it("migrateToLatest skips auto_vacuum check when disabled", async () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const stateProvider = createBetterSqlite3Provider({ db });
    const stateAdapter = await createSqliteStateAdapter({
      stateProvider,
      checkAutoVacuum: false,
    });

    await expect(stateAdapter.migrateToLatest()).resolves.toBeDefined();

    db.close();
  });

  it("migrateToLatest throws when foreign_keys is not enabled", async () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("auto_vacuum = INCREMENTAL");
    db.pragma("foreign_keys = OFF");

    const stateProvider = createBetterSqlite3Provider({ db });
    const stateAdapter = await createSqliteStateAdapter({ stateProvider });

    await expect(stateAdapter.migrateToLatest()).rejects.toThrow("foreign_keys");

    db.close();
  });

  it("migrateToLatest skips foreign_keys check when disabled", async () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("auto_vacuum = INCREMENTAL");
    db.pragma("foreign_keys = OFF");

    const stateProvider = createBetterSqlite3Provider({ db });
    const stateAdapter = await createSqliteStateAdapter({
      stateProvider,
      checkForeignKeys: false,
    });

    await expect(stateAdapter.migrateToLatest()).resolves.toBeDefined();

    db.close();
  });

  it("returns unknown migrations when database is ahead", async ({ db, stateAdapter }) => {
    await stateAdapter.migrateToLatest();

    db.exec("INSERT INTO queuert_migration (name) VALUES ('20991231235959_future_migration')");

    const result = await stateAdapter.migrateToLatest();

    expect(result.skipped).toEqual(migrations.map((m) => m.name));
    expect(result.applied).toEqual([]);
    expect(result.unrecognized).toEqual(["20991231235959_future_migration"]);
  });
});
