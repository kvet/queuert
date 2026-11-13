import { expectToThrow } from "@queuert/helpers/expect.spec-helper";
import { type MaybePromise, isPromise } from "@queuert/helpers/maybe-promise";
import { createModeMigrator } from "@queuert/typed-sql/migrator";
import { createTemplateExecutor } from "@queuert/typed-sql/sql-executor";
import { createTemplateApplier } from "@queuert/typed-sql/template-applier";
import Database from "better-sqlite3";
import type { AdapterMode } from "queuert";
import type { ConformanceStateAdapter } from "queuert/conformance";
import { describe, expect, it } from "vitest";

import { createV017Migrations } from "../specs/v0.17-migrations.spec-helper.ts";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.ts";
import type {
  AnySqliteStateProvider,
  ModeSqliteStateProvider,
} from "../state-provider/state-provider.sqlite.ts";
import {
  createMigrationStore,
  createSchemaMigrations,
  createSqliteStateAdapter,
} from "./state-adapter.sqlite.ts";

const migrationNames = createSchemaMigrations(async () => {}, "async").map(
  (migration) => migration.name,
);

const inMode = async <T>(mode: AdapterMode, value: MaybePromise<T>): Promise<T> => {
  expect(isPromise(value)).toBe(mode === "async");
  return value;
};

describe.for(["async", "sync"] as const)("createSqliteStateAdapter in %s mode", (mode) => {
  const createProvider = (): AnySqliteStateProvider<BetterSqlite3Context> =>
    createBetterSqlite3Provider({ db: new Database(":memory:"), mode });

  const createMigratedAdapter = async () => {
    const adapter = createSqliteStateAdapter({ stateProvider: createProvider() });
    await inMode(mode, adapter.migrateToLatest());
    return adapter;
  };

  const createLegacyAdapter = async ({ only }: { only?: string } = {}) => {
    const stateProvider = createProvider();
    const modeStateProvider: ModeSqliteStateProvider<BetterSqlite3Context> = stateProvider;
    const applyTemplate = createTemplateApplier({
      table_prefix: "queuert_",
      migration_table: "queuert_migration",
      write_lock_table: "queuert_write_lock",
      job_id_type: "TEXT",
      worker_id_type: "TEXT",
    });
    await createModeMigrator({
      sync: mode === "sync",
      migrations: createV017Migrations(
        createTemplateExecutor(modeStateProvider, applyTemplate),
      ).filter((migration) => only === undefined || migration.name === only),
      store: createMigrationStore(modeStateProvider, applyTemplate),
    }).migrateToLatest();
    return createSqliteStateAdapter({ stateProvider });
  };

  it("follows the provider's mode: the brand, the dispose symbol and plain or promised results", async () => {
    const adapter = await createMigratedAdapter();

    expect("sync" in adapter).toBe(mode === "sync");
    expect(Symbol.dispose in adapter).toBe(mode === "sync");
    expect(Symbol.asyncDispose in adapter).toBe(mode === "async");
    expect(await inMode(mode, adapter.getChainTypeNames({}))).toEqual([]);
    await inMode(mode, adapter.close());
  });

  it("applies every migration once and skips them on the next run", async () => {
    const adapter = createSqliteStateAdapter({ stateProvider: createProvider() });

    expect(await inMode(mode, adapter.migrateToLatest())).toEqual({
      skipped: [],
      applied: migrationNames,
      reverted: [],
      unrecognized: [],
    });
    expect(await inMode(mode, adapter.migrateToLatest())).toEqual({
      skipped: migrationNames,
      applied: [],
      reverted: [],
      unrecognized: [],
    });
  });

  it("carries a 0.17 database onto the current schema", async () => {
    const adapter = await createLegacyAdapter();

    expect(await inMode(mode, adapter.migrateToLatest())).toEqual({
      skipped: migrationNames,
      applied: [],
      reverted: [],
      unrecognized: [],
    });
  });

  it("refuses a 0.16 database", async () => {
    const adapter = await createLegacyAdapter({ only: "001_initial_schema" });

    const refused = expectToThrow(
      () => adapter.migrateToLatest(),
      /Cannot upgrade a 0\.16 schema directly/,
    );
    expect(isPromise(refused)).toBe(mode === "async");
    await refused;
  });

  it("reads back a chain created in a transaction", async () => {
    const adapter: ConformanceStateAdapter = await createMigratedAdapter();
    const id = adapter.config.generateJobId();

    const [created] = await inMode(
      mode,
      adapter.withTransaction((txCtx: BetterSqlite3Context) =>
        adapter.createJobs({ txCtx, jobs: [{ id, typeName: "t", input: { n: 1 } }] }),
      ),
    );
    const [read] = await inMode(mode, adapter.getChains({ chainIds: [id] }));

    expect(created.deduplicated).toBe(false);
    expect(read).toMatchObject({
      id,
      typeName: "t",
      status: "running",
      head: { id, status: "pending", input: { n: 1 } },
    });
  });
});

describe("createSqliteStateAdapter over an async provider", () => {
  it("rejects when the provider throws synchronously", async () => {
    const stateProvider = createBetterSqlite3Provider({ db: new Database(":memory:") });
    const adapter = createSqliteStateAdapter({
      stateProvider: {
        ...stateProvider,
        executeSql: () => {
          throw new Error("driver failed");
        },
      },
    });

    const result = adapter.getChainTypeNames({});
    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toThrow("driver failed");
  });
});
