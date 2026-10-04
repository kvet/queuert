import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { it as baseIt, describe, expect } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.js";
import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";

const INSTALL = "001_initial_schema";
const ALL = [INSTALL];

type Provider = SqliteStateProvider<BetterSqlite3Context>;
type Db = {
  provider: Provider;
  adapter: Awaited<ReturnType<typeof createSqliteStateAdapter<BetterSqlite3Context, string>>>;
};

const ROW_RESULT: Record<string, "string"> = { _: "string" };
const query = async <T = Record<string, unknown>>(provider: Provider, sql: string): Promise<T[]> =>
  provider.executeSql({
    sql,
    params: [],
    paramTypes: {},
    columnTypes: ROW_RESULT,
    readOnly: true,
  }) as Promise<T[]>;

const it = baseIt.extend<{ fresh: Db }>({
  // oxlint-disable-next-line no-empty-pattern
  fresh: async ({}, use) => {
    const path = join(tmpdir(), `queuert-migration-${randomUUID()}.sqlite`);
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    const provider = createBetterSqlite3Provider({ db });
    const adapter = await createSqliteStateAdapter({
      stateProvider: provider,
      generateId: (): string => randomUUID(),
    });
    await use({ provider, adapter });
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  },
});

const objectNames = async (provider: Provider): Promise<string[]> =>
  (await query<{ name: string }>(provider, "SELECT name FROM sqlite_master ORDER BY name")).map(
    (row) => row.name,
  );

describe("migrateToLatest", () => {
  it(
    "installs the schema on an empty database",
    { timeout: 60_000 },
    async ({ fresh: { provider, adapter } }) => {
      expect(await adapter.migrateToLatest()).toEqual({
        applied: ALL,
        skipped: [],
        unrecognized: [],
      });
      expect(await objectNames(provider)).toEqual([
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
        "sqlite_autoindex_queuert_job_1",
        "sqlite_autoindex_queuert_job_blocker_1",
        "sqlite_autoindex_queuert_migration_1",
      ]);
    },
  );

  it("is a no-op on a second run", { timeout: 60_000 }, async ({ fresh: { adapter } }) => {
    await adapter.migrateToLatest();
    expect(await adapter.migrateToLatest()).toEqual({
      applied: [],
      skipped: ALL,
      unrecognized: [],
    });
  });
});
