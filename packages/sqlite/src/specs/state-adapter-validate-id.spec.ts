import Database from "better-sqlite3";
import { type StateAdapter } from "queuert";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { describe, expect, it } from "vitest";

import {
  type SqliteStateAdapter,
  createSqliteStateAdapter,
} from "../state-adapter/state-adapter.sqlite.js";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.js";

it("index");

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
      adapter.createChains({
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
