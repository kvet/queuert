import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDeploymentSpawner, startPaused, startTogether } from "@queuert/helpers/testing";
import { type MigrationResult } from "@queuert/typed-sql";
import Database from "better-sqlite3";
import { it as baseIt, describe, expect } from "vitest";

import { createSqliteStateAdapter, migrations } from "../state-adapter/state-adapter.sqlite.js";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.js";
import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";
import { MARKER } from "./state-adapter-migration.process.js";

const ALL = migrations.map((migration) => migration.name);
const spawnDeployment = createDeploymentSpawner<MigrationResult>(
  join(import.meta.dirname, "state-adapter-migration.process.ts"),
  join(import.meta.dirname, "..", ".."),
);

type Provider = SqliteStateProvider<BetterSqlite3Context>;

const query = async <T>(provider: Provider, text: string): Promise<T[]> =>
  provider.executeSql({
    sql: text,
    params: [],
    paramTypes: {},
    columnTypes: { _: "string" },
    readOnly: true,
  }) as Promise<T[]>;

const names = async (provider: Provider, text: string): Promise<string[]> =>
  (await query<{ name: string }>(provider, text)).map((row) => row.name);

const appliedNames = async (provider: Provider): Promise<string[]> =>
  names(provider, "SELECT name FROM queuert_migration ORDER BY name");

const it = baseIt.extend<{
  database: {
    path: string;
    provider: Provider;
    adapter: Awaited<ReturnType<typeof createSqliteStateAdapter<BetterSqlite3Context, string>>>;
  };
}>({
  // oxlint-disable-next-line no-empty-pattern
  database: async ({}, use) => {
    const path = join(tmpdir(), `queuert-migration-${randomUUID()}.sqlite`);
    const db = new Database(path, { timeout: 30_000 });
    db.pragma("journal_mode = WAL");
    const provider = createBetterSqlite3Provider({ db });
    const adapter = await createSqliteStateAdapter({
      stateProvider: provider,
      generateId: (): string => randomUUID(),
    });
    await use({ path, provider, adapter });
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  },
});

describe("migrateToLatest", () => {
  it(
    "installs the schema on an empty database",
    { timeout: 60_000 },
    async ({ database: { provider, adapter } }) => {
      expect(await adapter.migrateToLatest()).toEqual({
        applied: ALL,
        skipped: [],
        unrecognized: [],
      });
      expect(await names(provider, "SELECT name FROM sqlite_master ORDER BY name")).toEqual([
        "queuert_chain_completed_idx",
        "queuert_chain_deduplication_idx",
        "queuert_chain_idx",
        "queuert_chain_index_idx",
        "queuert_chain_running_idx",
        "queuert_job",
        "queuert_job_blocked_idx",
        "queuert_job_blocker",
        "queuert_job_blocker_chain_idx",
        "queuert_job_completed_idx",
        "queuert_job_idx",
        "queuert_job_pending_idx",
        "queuert_job_running_idx",
        "queuert_migration",
        "queuert_write_lock",
        "sqlite_autoindex_queuert_job_1",
        "sqlite_autoindex_queuert_job_blocker_1",
        "sqlite_autoindex_queuert_migration_1",
      ]);
    },
  );

  it("is a no-op on a second run", { timeout: 60_000 }, async ({ database: { adapter } }) => {
    await adapter.migrateToLatest();
    expect(await adapter.migrateToLatest()).toEqual({
      applied: [],
      skipped: ALL,
      unrecognized: [],
    });
  });
});

describe("parallel deployments", () => {
  it(
    "applies the schema exactly once when several deployments migrate at the same time",
    { timeout: 120_000 },
    async ({ database: { path, provider } }) => {
      const results = await startTogether(
        Array.from({ length: 4 }, () => spawnDeployment(path, "older")),
      );

      expect(
        results.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ).toEqual([
        { applied: [], skipped: ALL, unrecognized: [] },
        { applied: [], skipped: ALL, unrecognized: [] },
        { applied: [], skipped: ALL, unrecognized: [] },
        { applied: ALL, skipped: [], unrecognized: [] },
      ]);
      expect(await appliedNames(provider)).toEqual(ALL);
    },
  );

  it(
    "rolls back the migration of a deployment killed mid-migration, and the next deployment applies it",
    { timeout: 120_000 },
    async ({ database: { path, provider } }) => {
      const killed = await startPaused(spawnDeployment(path, "older", "inside-migration"));
      await killed.kill();

      expect(
        await names(provider, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"),
      ).toEqual(["queuert_migration", "queuert_write_lock"]);
      expect(await startTogether([spawnDeployment(path, "older")])).toEqual([
        { applied: ALL, skipped: [], unrecognized: [] },
      ]);
      expect(await appliedNames(provider)).toEqual(ALL);
    },
  );

  it(
    "lets an older and a newer deployment migrate side by side",
    { timeout: 120_000 },
    async ({ database: { path, provider } }) => {
      const [older, newer] = (await startTogether([
        spawnDeployment(path, "older"),
        spawnDeployment(path, "newer"),
      ])) as MigrationResult[];

      expect([...older.applied, ...newer.applied].toSorted()).toEqual([...ALL, MARKER]);
      expect(newer.applied).toContain(MARKER);
      expect(await startTogether([spawnDeployment(path, "older")])).toEqual([
        { applied: [], skipped: ALL, unrecognized: [MARKER] },
      ]);
      expect(await appliedNames(provider)).toEqual([...ALL, MARKER]);
    },
  );
});
