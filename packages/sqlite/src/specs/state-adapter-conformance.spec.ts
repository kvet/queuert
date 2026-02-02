import Database from "better-sqlite3";
import { type StateAdapter } from "queuert";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { describe, expect, it } from "vitest";
import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { createBetterSqlite3Provider } from "./state-provider.better-sqlite3.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

it("index");

describe("SQLite State Adapter Conformance - Default Config", () => {
  const tablePrefix = "queuert_";

  const conformanceIt = it.extend<{
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    validateId: (id: string) => boolean;
  }>({
    db: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = new Database(":memory:");
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        await use(db);
        db.close();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ db }, use) => {
        const stateProvider = createBetterSqlite3Provider({ db });
        const adapter = await createSqliteStateAdapter({ stateProvider, tablePrefix });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
    validateId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use((id: string) => UUID_PATTERN.test(id)),
      { scope: "test" },
    ],
  });

  conformanceIt("creates tables with correct prefix", ({ db, stateAdapter: _ }) => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?`)
      .all(`${tablePrefix}%`) as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain(`${tablePrefix}job`);
    expect(tableNames).toContain(`${tablePrefix}job_blocker`);
    expect(tableNames).toContain(`${tablePrefix}migration`);
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt as any });
});

describe("SQLite State Adapter Conformance - Custom Table Prefix", () => {
  const tablePrefix = "myapp_queue_";

  const conformanceIt = it.extend<{
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    validateId: (id: string) => boolean;
  }>({
    db: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = new Database(":memory:");
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        await use(db);
        db.close();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ db }, use) => {
        const stateProvider = createBetterSqlite3Provider({ db });
        const adapter = await createSqliteStateAdapter({ stateProvider, tablePrefix });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
    validateId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use((id: string) => UUID_PATTERN.test(id)),
      { scope: "test" },
    ],
  });

  conformanceIt("creates tables with correct prefix", ({ db, stateAdapter: _ }) => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?`)
      .all(`${tablePrefix}%`) as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain(`${tablePrefix}job`);
    expect(tableNames).toContain(`${tablePrefix}job_blocker`);
    expect(tableNames).toContain(`${tablePrefix}migration`);
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt as any });
});

describe("SQLite State Adapter Conformance - Custom ID Generator", () => {
  const tablePrefix = "queuert_";
  let idCounter = 0;
  const idGenerator = () => `custom-${Date.now()}-${idCounter++}`;

  const conformanceIt = it.extend<{
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    validateId: (id: string) => boolean;
  }>({
    db: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = new Database(":memory:");
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        await use(db);
        db.close();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ db }, use) => {
        const stateProvider = createBetterSqlite3Provider({ db });
        const adapter = await createSqliteStateAdapter({ stateProvider, tablePrefix, idGenerator });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
    validateId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use((id: string) => id.startsWith("custom-")),
      { scope: "test" },
    ],
  });

  conformanceIt("creates tables with correct prefix", ({ db, stateAdapter: _ }) => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?`)
      .all(`${tablePrefix}%`) as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain(`${tablePrefix}job`);
    expect(tableNames).toContain(`${tablePrefix}job_blocker`);
    expect(tableNames).toContain(`${tablePrefix}migration`);
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt as any });
});

describe("SQLite State Adapter Conformance - All Custom Options", () => {
  const tablePrefix = "jobs_";
  let idCounter = 0;
  const idGenerator = () => `job-${Date.now()}-${idCounter++}`;

  const conformanceIt = it.extend<{
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    validateId: (id: string) => boolean;
  }>({
    db: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = new Database(":memory:");
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        await use(db);
        db.close();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ db }, use) => {
        const stateProvider = createBetterSqlite3Provider({ db });
        const adapter = await createSqliteStateAdapter({ stateProvider, tablePrefix, idGenerator });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
    validateId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use((id: string) => id.startsWith("job-")),
      { scope: "test" },
    ],
  });

  conformanceIt("creates tables with correct prefix", ({ db, stateAdapter: _ }) => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?`)
      .all(`${tablePrefix}%`) as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain(`${tablePrefix}job`);
    expect(tableNames).toContain(`${tablePrefix}job_blocker`);
    expect(tableNames).toContain(`${tablePrefix}migration`);
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt as any });
});
