import Database from "better-sqlite3";
import { type StateAdapter } from "queuert";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { describe, expect, it } from "vitest";

import { migrations } from "../state-adapter/sql.js";
import {
  type SqliteStateAdapter,
  createSqliteStateAdapter,
} from "../state-adapter/state-adapter.sqlite.js";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dummyProvider = {
  executeSql: async () => [],
  withTransaction: async <T>(fn: (ctx: any) => Promise<T>) => fn({}),
};

it("index");

describe("SQL identifier validation", () => {
  const identifierInjectionCases: { label: string; value: string }[] = [
    { label: "SQL injection via semicolon", value: "public; DROP TABLE" },
    { label: "starts with a digit", value: "1bad" },
    { label: "contains dash", value: "my-prefix-" },
    { label: "contains space", value: "bad prefix" },
    { label: "contains quote", value: `foo'quote` },
    { label: "contains double-quote", value: `foo"quote` },
    { label: "contains backslash", value: "foo\\bar" },
    { label: "empty string", value: "" },
    { label: "SQL comment", value: "a -- comment" },
    { label: "block comment", value: "a /*x*/ b" },
  ];

  describe("rejects invalid tablePrefix", () => {
    for (const { label, value } of identifierInjectionCases) {
      it(label, async () => {
        await expect(
          createSqliteStateAdapter({ stateProvider: dummyProvider, tablePrefix: value }),
        ).rejects.toThrow(/Invalid tablePrefix/);
      });
    }
  });

  describe("rejects invalid idType", () => {
    for (const { label, value } of identifierInjectionCases) {
      it(label, async () => {
        await expect(
          createSqliteStateAdapter({ stateProvider: dummyProvider, idType: value }),
        ).rejects.toThrow(/Invalid idType/);
      });
    }
  });

  it("accepts valid tablePrefix", async () => {
    const adapter = await createSqliteStateAdapter({
      stateProvider: dummyProvider,
      tablePrefix: "myapp_",
    });
    expect(adapter).toBeDefined();
  });

  it("accepts default values", async () => {
    const adapter = await createSqliteStateAdapter({ stateProvider: dummyProvider });
    expect(adapter).toBeDefined();
  });

  it("accepts typical idType value", async () => {
    const adapter = await createSqliteStateAdapter({
      stateProvider: dummyProvider,
      idType: "INTEGER",
    });
    expect(adapter).toBeDefined();
  });
});

describe("SQLite State Adapter Variance - Custom Table Prefix", () => {
  const tablePrefix = "myapp_queue_";

  const conformanceIt = it.extend<{
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string>;
  }>({
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
        const adapter = await createSqliteStateAdapter({ stateProvider, tablePrefix });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
  });

  conformanceIt("generates UUID job IDs", async ({ stateAdapter }) => {
    const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [{ typeName: "t", chainTypeName: "t", input: null }],
      }),
    );
    expect(UUID_PATTERN.test(job.id)).toBe(true);
    expect(UUID_PATTERN.test(job.chainId)).toBe(true);
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

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});

describe("SQLite State Adapter Variance - Custom ID Generator", () => {
  const tablePrefix = "queuert_";
  let idCounter = 0;
  const generateId = () => `custom-${Date.now()}-${idCounter++}`;

  const conformanceIt = it.extend<{
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string>;
  }>({
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
        const adapter = await createSqliteStateAdapter({ stateProvider, tablePrefix, generateId });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
  });

  conformanceIt("generates custom-prefixed job IDs", async ({ stateAdapter }) => {
    const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [{ typeName: "t", chainTypeName: "t", input: null }],
      }),
    );
    expect(job.id.startsWith("custom-")).toBe(true);
    expect(job.chainId.startsWith("custom-")).toBe(true);
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

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});

describe("SQLite State Adapter Variance - All Custom Options", () => {
  const tablePrefix = "jobs_";
  let idCounter = 0;
  const generateId = () => `job-${Date.now()}-${idCounter++}`;

  const conformanceIt = it.extend<{
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string>;
  }>({
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
        const adapter = await createSqliteStateAdapter({ stateProvider, tablePrefix, generateId });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
  });

  conformanceIt("generates custom-prefixed job IDs", async ({ stateAdapter }) => {
    const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [{ typeName: "t", chainTypeName: "t", input: null }],
      }),
    );
    expect(job.id.startsWith("job-")).toBe(true);
    expect(job.chainId.startsWith("job-")).toBe(true);
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

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});

describe("Migrations", () => {
  const migrationIt = it.extend<{
    db: Database.Database;
    stateAdapter: SqliteStateAdapter<BetterSqlite3Context>;
  }>({
    // oxlint-disable-next-line no-empty-pattern
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

  migrationIt("fresh install applies all migrations", async ({ stateAdapter }) => {
    const result = await stateAdapter.migrateToLatest();

    expect(result.skipped).toEqual([]);
    expect(result.applied).toEqual(migrations.map((m) => m.name));
    expect(result.unrecognized).toEqual([]);
  });

  migrationIt("running twice is idempotent", async ({ stateAdapter }) => {
    const firstResult = await stateAdapter.migrateToLatest();
    expect(firstResult.applied.length).toBeGreaterThan(0);

    const secondResult = await stateAdapter.migrateToLatest();
    expect(secondResult.skipped).toEqual(migrations.map((m) => m.name));
    expect(secondResult.applied).toEqual([]);
    expect(secondResult.unrecognized).toEqual([]);
  });

  migrationIt("vacuum runs without error", async ({ stateAdapter }) => {
    await stateAdapter.migrateToLatest();
    await expect(stateAdapter.vacuum()).resolves.toBeUndefined();
  });

  migrationIt("returns unknown migrations when database is ahead", async ({ db, stateAdapter }) => {
    await stateAdapter.migrateToLatest();

    db.exec("INSERT INTO queuert_migration (name) VALUES ('20991231235959_future_migration')");

    const result = await stateAdapter.migrateToLatest();

    expect(result.skipped).toEqual(migrations.map((m) => m.name));
    expect(result.applied).toEqual([]);
    expect(result.unrecognized).toEqual(["20991231235959_future_migration"]);
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
});

describe("validateId", () => {
  const makeAdapter = async (options: {
    generateId?: () => string;
    validateId?: (id: string) => boolean;
  }) => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("auto_vacuum = INCREMENTAL");
    db.pragma("foreign_keys = ON");
    const stateProvider = createBetterSqlite3Provider({ db });
    const adapter = await createSqliteStateAdapter<BetterSqlite3Context, string>({
      stateProvider,
      ...options,
    });
    await adapter.migrateToLatest();
    return { adapter, db };
  };

  const createJob = async (
    adapter: SqliteStateAdapter<BetterSqlite3Context, string>,
    id?: string,
  ) =>
    adapter.withTransaction(async (txCtx) =>
      adapter.createJobs({
        txCtx,
        jobs: [{ typeName: "t", id, chainTypeName: "t", input: null }],
      }),
    );

  it("rejects caller-supplied id that fails validateId", async () => {
    const { adapter, db } = await makeAdapter({
      validateId: (id) => id.startsWith("ok-"),
    });
    await expect(createJob(adapter, "bad-id")).rejects.toThrow(
      /Invalid job ID "bad-id" from caller/,
    );
    db.close();
  });

  it("rejects generator output that fails validateId", async () => {
    const { adapter, db } = await makeAdapter({
      generateId: () => "wrong-format",
      validateId: (id) => id.startsWith("ok-"),
    });
    await expect(createJob(adapter)).rejects.toThrow(
      /Invalid job ID "wrong-format" from generator/,
    );
    db.close();
  });

  it("accepts valid caller-supplied id", async () => {
    const { adapter, db } = await makeAdapter({
      generateId: () => `ok-${crypto.randomUUID()}`,
      validateId: (id) => id.startsWith("ok-"),
    });
    const [{ job }] = await createJob(adapter, "ok-custom");
    expect(job.id).toBe("ok-custom");
    db.close();
  });
});

describe("SQLite State Adapter Variance - With validateId", () => {
  const tablePrefix = "queuert_";
  const generateId = () => `ok-${crypto.randomUUID()}`;
  const validateId = (id: string) => id.startsWith("ok-");
  const generateInvalidId = () => `bad-${crypto.randomUUID()}`;

  const conformanceIt = it.extend<{
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    generateId: () => string;
    generateInvalidId: () => string;
  }>({
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
        const adapter = await createSqliteStateAdapter({
          stateProvider,
          tablePrefix,
          generateId,
          validateId,
        });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
    generateId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use(generateId),
      { scope: "test" },
    ],
    generateInvalidId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use(generateInvalidId),
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});
