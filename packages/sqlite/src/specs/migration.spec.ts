import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { migrations } from "../state-adapter/sql.js";
import { createBetterSqlite3Provider } from "./state-provider.better-sqlite3.js";

describe("SQLite migrations", () => {
  it("fresh install applies all migrations", async () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const stateProvider = createBetterSqlite3Provider({ db });
    const stateAdapter = await createSqliteStateAdapter({ stateProvider });

    const result = await stateAdapter.migrateToLatest();

    expect(result.skipped).toEqual([]);
    expect(result.applied).toEqual(migrations.map((m) => m.name));
    expect(result.unrecognized).toEqual([]);

    db.close();
  });

  it("running twice is idempotent", async () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const stateProvider = createBetterSqlite3Provider({ db });
    const stateAdapter = await createSqliteStateAdapter({ stateProvider });

    const firstResult = await stateAdapter.migrateToLatest();
    expect(firstResult.applied.length).toBeGreaterThan(0);

    const secondResult = await stateAdapter.migrateToLatest();
    expect(secondResult.skipped).toEqual(migrations.map((m) => m.name));
    expect(secondResult.applied).toEqual([]);
    expect(secondResult.unrecognized).toEqual([]);

    db.close();
  });

  it("returns unknown migrations when database is ahead", async () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const stateProvider = createBetterSqlite3Provider({ db });
    const stateAdapter = await createSqliteStateAdapter({ stateProvider });

    await stateAdapter.migrateToLatest();

    db.exec("INSERT INTO queuert_migration (name) VALUES ('20991231235959_future_migration')");

    const result = await stateAdapter.migrateToLatest();

    expect(result.skipped).toEqual(migrations.map((m) => m.name));
    expect(result.applied).toEqual([]);
    expect(result.unrecognized).toEqual(["20991231235959_future_migration"]);

    db.close();
  });
});
