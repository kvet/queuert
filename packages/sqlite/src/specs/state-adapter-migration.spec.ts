import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  type ColumnContract,
  type Migration,
  type ReconcilerRow,
  createMigrationReconciler,
  createMigrator,
  createTemplateApplier,
  sql,
} from "@queuert/typed-sql";
import Database from "better-sqlite3";
import { type SeedSentinelsV1, seedAllStatesV1 } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import {
  createMigrationStore,
  createSqliteStateAdapter,
  migrations,
} from "../state-adapter/state-adapter.sqlite.js";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.js";
import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";

const GENERATING = Boolean(process.env.GENERATE_FIXTURES);

const FIXTURE_PATH = fileURLToPath(
  new URL("../../fixtures/initial-schema.sqlite.gz", import.meta.url),
);
const MANIFEST_PATH = fileURLToPath(new URL("../../fixtures/manifest.json", import.meta.url));

type Provider = SqliteStateProvider<BetterSqlite3Context>;
type Manifest = {
  migration: string;
  totalJobs: number;
  totalBlockers: number;
  byStatus: Record<string, number>;
  sentinels: SeedSentinelsV1;
};
type Db = {
  db: Database.Database;
  path: string;
  provider: Provider;
  adapter: Awaited<ReturnType<typeof createSqliteStateAdapter<BetterSqlite3Context, string>>>;
};

const applyTemplate = createTemplateApplier({ table_prefix: "queuert_", id_type: "TEXT" });

const migratorFor = (provider: Provider) =>
  createMigrator({ migrations, store: createMigrationStore(provider, applyTemplate) });

// The better-sqlite3 provider returns rows only when columnTypes is non-empty
// (its SELECT-vs-exec switch); the values are unused when reading raw rows.
const ROW_RESULT: Record<string, "string"> = { _: "string" };
const query = async <T = Record<string, unknown>>(
  provider: Provider,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> =>
  provider.executeSql({
    sql,
    params,
    paramTypes: {},
    columnTypes: ROW_RESULT,
    readOnly: true,
  }) as Promise<T[]>;

const readRows = async (
  provider: Provider,
  table: "job" | "job_blocker",
): Promise<ReconcilerRow[]> => query(provider, `SELECT * FROM queuert_${table}`);

const jobKey = (row: ReconcilerRow): string => String(row.id);
const blockerKey = (row: ReconcilerRow): string =>
  `${String(row.job_id)}|${String(row.blocked_by_chain_id)}`;

const readManifest = (): Manifest => JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;

const dumpSchema = async (provider: Provider): Promise<string> => {
  const rows = await query<{ type: string; name: string; sql: string }>(
    provider,
    `SELECT type, name, sql FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type, name`,
  );
  return rows.map((r) => `${r.type} ${r.name} ${r.sql.replace(/\s+/g, " ").trim()}`).join("\n");
};

const collectAll = async <T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> => {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
};

const openDb = (path: string): Database.Database => {
  const db = new Database(path);
  db.pragma("journal_mode = DELETE"); // keep the whole database in one file for the fixture
  db.pragma("auto_vacuum = INCREMENTAL");
  db.pragma("foreign_keys = ON");
  return db;
};

const provision = async (load: boolean): Promise<Db & { dispose: () => void }> => {
  const path = join(tmpdir(), `queuert-migration-${randomUUID()}.sqlite`);
  if (load) writeFileSync(path, gunzipSync(readFileSync(FIXTURE_PATH)));
  const db = openDb(path);
  const provider = createBetterSqlite3Provider({ db });
  const adapter = await createSqliteStateAdapter({
    stateProvider: provider,
    generateId: (): string => randomUUID(),
  });
  return {
    db,
    path,
    provider,
    adapter,
    dispose: () => {
      db.close();
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
    },
  };
};

const it = baseIt.extend<{ loaded: Db; fresh: Db }>({
  // oxlint-disable-next-line no-empty-pattern
  loaded: async ({}, use) => {
    const db = await provision(true);
    await use(db);
    db.dispose();
  },
  // oxlint-disable-next-line no-empty-pattern
  fresh: async ({}, use) => {
    const db = await provision(false);
    await use(db);
    db.dispose();
  },
});

// ---------------------------------------------------------------------------
// Per-migration schema contracts
// ---------------------------------------------------------------------------

type MigrationContract = {
  job?: ColumnContract;
  jobBlocker?: ColumnContract;
  schema?: (provider: Provider) => Promise<void>;
  sentinel?: (provider: Provider, sentinels: SeedSentinelsV1) => Promise<void>;
};

const sqliteBool = (v: unknown): boolean => v === 1 || v === true || v === "1";

const statusOf = (row: Record<string, unknown>): string => {
  // oxlint-disable-next-line typescript/no-base-to-string
  if ("status" in row && row.status != null) return String(row.status);
  if (row.completed_at != null) return "completed";
  if (row.attempt_at != null) return "running";
  if (sqliteBool(row.blocked)) return "blocked";
  return "pending";
};

const indexNames = async (provider: Provider): Promise<string[]> =>
  (await query(provider, "SELECT name FROM sqlite_master WHERE type = 'index'")).map((row) =>
    String(row.name),
  );

const migrationContracts: Record<string, MigrationContract> = {
  "20260430000000_rename_chain_indexes": {
    schema: async (provider) => {
      const indexes = await indexNames(provider);
      expect(indexes).toContain("queuert_chain_index_idx");
      expect(indexes).toContain("queuert_chain_listing_idx");
      expect(indexes).not.toContain("queuert_job_chain_index_idx");
      expect(indexes).not.toContain("queuert_job_chain_listing_idx");
    },
  },

  "20260617000000_blocker_composite_pk": {
    schema: async (provider) => {
      const rows = await query(
        provider,
        "SELECT name FROM pragma_table_info('queuert_job_blocker') WHERE pk > 0 ORDER BY pk",
      );
      expect(rows.map((r) => r.name)).toEqual(["job_id", "blocked_by_chain_id", "index"]);
    },
  },

  "20260622000000_job_model_v2": {
    job: {
      add: [
        {
          column: "continued_to_id",
          derive: (after, beforeRow, snapshot) => {
            if (after === null || after === undefined) {
              const chainId = String(beforeRow.chain_id);
              const chainIndex = Number(beforeRow.chain_index);
              for (const [, row] of snapshot) {
                if (String(row.chain_id) === chainId && Number(row.chain_index) === chainIndex + 1)
                  return false;
              }
              return true;
            }
            const afterId = after as string;
            const successor = snapshot.get(afterId);
            if (!successor) return false;
            return (
              String(successor.chain_id) === String(beforeRow.chain_id) &&
              Number(successor.chain_index) === Number(beforeRow.chain_index) + 1
            );
          },
        },
        {
          column: "attempt_at",
          derive: (after, beforeRow) => {
            if (String(beforeRow.status) === "running")
              return after !== null && after !== undefined;
            return after === null || after === undefined;
          },
        },
        {
          column: "blocked",
          derive: (after, beforeRow) => {
            if (String(beforeRow.status) === "blocked") return sqliteBool(after);
            return !sqliteBool(after);
          },
        },
      ],
      rename: [
        { from: "leased_by", to: "attempt_by" },
        { from: "leased_until", to: "attempt_until" },
      ],
      drop: ["status"],
    },
    schema: async (provider) => {
      const columns = (
        await query<{ name: string }>(provider, "PRAGMA table_info(queuert_job)")
      ).map((c) => c.name);
      expect(columns).toContain("continued_to_id");
      expect(columns).toContain("attempt_at");
      expect(columns).toContain("attempt_by");
      expect(columns).toContain("attempt_until");
      expect(columns).toContain("blocked");
      expect(columns).not.toContain("status");
      expect(columns).not.toContain("leased_by");
      expect(columns).not.toContain("leased_until");
      expect(columns).not.toContain("leased_at");

      const indexes = await indexNames(provider);
      expect(indexes).not.toContain("queuert_job_acquisition_idx");
      expect(indexes).not.toContain("queuert_job_expired_lease_idx");
      expect(indexes).not.toContain("queuert_job_listing_status_idx");
      expect(indexes).not.toContain("queuert_job_listing_type_name_idx");
      expect(indexes).not.toContain("queuert_chain_listing_type_name_idx");
      expect(indexes).not.toContain("queuert_job_blocked_listing_idx");
      expect(indexes).not.toContain("queuert_chain_completed_at_idx");
      expect(indexes).not.toContain("queuert_chain_listing_idx");
      expect(indexes).not.toContain("queuert_job_listing_idx");
      expect(indexes).not.toContain("queuert_job_completed_listing_idx");

      expect(indexes).toContain("queuert_job_continuation_idx");
      expect(indexes).toContain("queuert_job_ready_idx");
      expect(indexes).toContain("queuert_job_running_idx");
      expect(indexes).toContain("queuert_job_completed_idx");
      expect(indexes).toContain("queuert_job_deduplication_idx");
      expect(indexes).toContain("queuert_chain_tail_open_idx");
      expect(indexes).toContain("queuert_chain_tail_completed_idx");
      expect(indexes).toContain("queuert_chain_head_idx");
      expect(indexes).toContain("queuert_job_idx");
    },
    sentinel: async (provider, sentinels) => {
      const [running] = await query(
        provider,
        "SELECT attempt_at, attempt_by, attempt_until FROM queuert_job WHERE id = ?",
        [sentinels.runningJobId],
      );
      expect(running?.attempt_at).not.toBeNull();
      expect(running?.attempt_by).not.toBeNull();
      expect(running?.attempt_until).not.toBeNull();

      const [blocked] = await query(provider, "SELECT blocked FROM queuert_job WHERE id = ?", [
        sentinels.blockedJobId,
      ]);
      expect(sqliteBool(blocked?.blocked)).toBe(true);

      const [pending] = await query(provider, "SELECT blocked FROM queuert_job WHERE id = ?", [
        sentinels.pendingJobId,
      ]);
      expect(sqliteBool(pending?.blocked)).toBe(false);

      const chainJobs = await query<{
        id: string;
        chain_index: number;
        continued_to_id: string | null;
      }>(
        provider,
        "SELECT id, chain_index, continued_to_id FROM queuert_job WHERE chain_id = ? ORDER BY chain_index",
        [sentinels.chainId],
      );
      expect(chainJobs.length).toBe(sentinels.chainLength);
      for (let i = 0; i < chainJobs.length - 1; i++) {
        expect(chainJobs[i].continued_to_id).toBe(chainJobs[i + 1].id);
      }
      expect(chainJobs[chainJobs.length - 1].continued_to_id).toBeNull();
    },
  },
};

// ---------------------------------------------------------------------------
// Upgrade path
// ---------------------------------------------------------------------------

const postFixtureMigrations = () => {
  const { migration } = readManifest();
  const idx = migrations.findIndex((m) => m.name === migration);
  return migrations.slice(idx + 1);
};

describe.skipIf(GENERATING)("migration upgrade path", () => {
  it("has a contract for every post-fixture migration", () => {
    const missing = postFixtureMigrations()
      .filter((m) => !(m.name in migrationContracts))
      .map((m) => m.name);
    expect(missing).toEqual([]);
  });

  it(
    "reconciles each migration's data contract, asserts its schema effect, then is idempotent",
    { timeout: 60_000 },
    async ({ loaded: { provider } }) => {
      const { sentinels } = readManifest();
      const laterMigrations = postFixtureMigrations();

      const jobs = createMigrationReconciler("job", await readRows(provider, "job"), jobKey);
      const blockers = createMigrationReconciler(
        "job_blocker",
        await readRows(provider, "job_blocker"),
        blockerKey,
      );

      const migrator = migratorFor(provider);
      const applied: string[] = [];
      for (const { name } of laterMigrations) {
        const result = await migrator.migrateTo(name);
        applied.push(...result.applied);

        const contract = migrationContracts[name] ?? {};
        jobs.reconcile(name, contract.job ?? {}, await readRows(provider, "job"));
        blockers.reconcile(
          name,
          contract.jobBlocker ?? {},
          await readRows(provider, "job_blocker"),
        );
        await contract.schema?.(provider);
        await contract.sentinel?.(provider, sentinels);
      }
      expect(applied).toEqual(laterMigrations.map((m) => m.name));

      const again = await migrator.migrateToLatest();
      expect(again.applied).toEqual([]);
      expect(again.unrecognized).toEqual([]);
    },
  );

  it(
    "converges to the same schema as a fresh install",
    { timeout: 60_000 },
    async ({ loaded, fresh }) => {
      await loaded.adapter.migrateToLatest();
      await fresh.adapter.migrateToLatest();
      expect(await dumpSchema(loaded.provider)).toBe(await dumpSchema(fresh.provider));
    },
  );

  it("drains a batched migration in bounded steps through the store", async ({
    fresh: { provider },
  }) => {
    const store = createMigrationStore(provider, applyTemplate);
    const scratch: Migration[] = [
      {
        name: "20990101000000_scratch_setup",
        type: "transactional",
        statements: [
          sql(/* sql */ `
CREATE TABLE {{table_prefix}}scratch (
  id INTEGER PRIMARY KEY,
  flag INTEGER NOT NULL DEFAULT 0
)`),
          sql(/* sql */ `
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 25)
INSERT INTO {{table_prefix}}scratch (id) SELECT n FROM seq`),
        ],
      },
      {
        name: "20990101000001_scratch_backfill",
        type: "batched",
        statements: [
          sql(/* sql */ `
UPDATE {{table_prefix}}scratch SET flag = 1
WHERE id IN (
  SELECT id FROM {{table_prefix}}scratch WHERE flag = 0 LIMIT 10
)`),
        ],
      },
    ];

    const result = await createMigrator({ migrations: scratch, store }).migrateToLatest();
    expect(result.applied).toEqual(scratch.map((m) => m.name));

    const [row] = await query<{ c: number }>(
      provider,
      "SELECT count(*) AS c FROM queuert_scratch WHERE flag = 1",
    );
    expect(row?.c).toBe(25);
  });

  it(
    "matches the committed manifest counts",
    { timeout: 60_000 },
    async ({ loaded: { provider } }) => {
      const manifest = readManifest();
      const jobs = await readRows(provider, "job");
      expect(jobs.length).toBe(manifest.totalJobs);
      expect((await readRows(provider, "job_blocker")).length).toBe(manifest.totalBlockers);

      const byStatus: Record<string, number> = {};
      for (const job of jobs) {
        const s = statusOf(job);
        byStatus[s] = (byStatus[s] ?? 0) + 1;
      }
      expect(byStatus).toEqual(manifest.byStatus);
    },
  );

  it(
    "preserves referential integrity",
    { timeout: 60_000 },
    async ({ loaded: { provider, adapter } }) => {
      await adapter.migrateToLatest();
      const jobs = await readRows(provider, "job");
      const ids = new Set(jobs.map((j) => String(j.id)));
      for (const job of jobs) {
        expect(ids.has(String(job.chain_id))).toBe(true);
        const cid = job.continued_to_id as string | null;
        if (cid !== null && cid !== undefined) {
          expect(ids.has(cid)).toBe(true);
        }
      }
      for (const blocker of await readRows(provider, "job_blocker")) {
        expect(ids.has(String(blocker.job_id))).toBe(true);
        expect(ids.has(String(blocker.blocked_by_chain_id))).toBe(true);
      }
    },
  );

  it(
    "leaves data semantically intact and readable by the engine",
    { timeout: 60_000 },
    async ({ loaded: { provider, adapter } }) => {
      await adapter.migrateToLatest();
      const { sentinels } = readManifest();

      const chainJobs = await collectAll(async (cursor) =>
        adapter.listChainJobs({
          chainId: sentinels.chainId,
          orderDirection: "asc",
          page: { limit: 500, cursor },
        }),
      );
      expect(chainJobs.length).toBe(sentinels.chainLength);
      expect(chainJobs.every((job, i) => (job.input as { n: number }).n === i)).toBe(true);

      for (let i = 0; i < chainJobs.length - 1; i++) {
        expect(chainJobs[i].continuedToId).toBe(chainJobs[i + 1].id);
      }
      expect(chainJobs[chainJobs.length - 1].continuedToId).toBeNull();

      const [blockerChain] = await adapter.getJobBlockers({ jobId: sentinels.blockedJobId });
      expect(blockerChain[0].chainId).toBe(sentinels.fanInBlockerId);
      const [fanIn] = await query<{ c: number }>(
        provider,
        "SELECT count(*) AS c FROM queuert_job_blocker WHERE blocked_by_chain_id = ?",
        [sentinels.fanInBlockerId],
      );
      expect(fanIn?.c).toBe(sentinels.fanInBlockedCount);

      const [completed] = await adapter.getJobs({ jobIds: [sentinels.completedJobId] });
      expect(completed?.completedAt).not.toBeNull();
      expect(completed?.output).toMatchObject({ ok: true });

      const [running] = await adapter.getJobs({ jobIds: [sentinels.runningJobId] });
      expect(running?.attemptAt).not.toBeNull();
      expect(running?.attemptBy).not.toBeNull();
      expect(running?.attemptUntil).not.toBeNull();
      expect(running?.completedAt).toBeNull();

      const [retried] = await adapter.getJobs({ jobIds: [sentinels.retriedJobId] });
      expect(retried?.completedAt).toBeNull();
      expect(retried?.attemptAt).toBeNull();
      expect(retried?.blocked).toBe(false);
      expect(String(retried?.lastAttemptError)).toContain("transient");

      const [blockedJob] = await adapter.getJobs({ jobIds: [sentinels.blockedJobId] });
      expect(blockedJob?.completedAt).toBeNull();
      expect(blockedJob?.attemptAt).toBeNull();
      expect(blockedJob?.blocked).toBe(true);
    },
  );

  it("vacuum runs without error", { timeout: 60_000 }, async ({ fresh: { adapter } }) => {
    await adapter.migrateToLatest();
    await expect(adapter.vacuum()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Pragma guards
// ---------------------------------------------------------------------------

describe("pragma guards", () => {
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

// ---------------------------------------------------------------------------
// Fixture generation — run with GENERATE_FIXTURES=1
// ---------------------------------------------------------------------------

describe.runIf(GENERATING)("fixture generation", () => {
  it(
    "writes the seeded database and manifest",
    { timeout: 300_000 },
    async ({ fresh: { db, path, provider, adapter } }) => {
      await adapter.migrateToLatest();
      const sentinels = await seedAllStatesV1(adapter);

      const jobs = await readRows(provider, "job");
      const byStatus: Record<string, number> = {};
      for (const job of jobs) {
        const s = statusOf(job);
        byStatus[s] = (byStatus[s] ?? 0) + 1;
      }
      const manifest: Manifest = {
        migration: migrations[migrations.length - 1].name,
        totalJobs: jobs.length,
        totalBlockers: (await readRows(provider, "job_blocker")).length,
        byStatus,
        sentinels,
      };

      db.pragma("wal_checkpoint(TRUNCATE)");
      const bytes = readFileSync(path);

      mkdirSync(fileURLToPath(new URL("../../fixtures/", import.meta.url)), { recursive: true });
      writeFileSync(FIXTURE_PATH, gzipSync(bytes));
      writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
      // eslint-disable-next-line no-console
      console.log(
        `Wrote ${manifest.totalJobs} jobs / ${manifest.totalBlockers} blockers at ${manifest.migration}`,
      );
    },
  );
});
