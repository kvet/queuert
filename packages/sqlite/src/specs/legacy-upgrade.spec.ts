import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import {
  type ColumnContract,
  type ReconcilerRow,
  createMigrationReconciler,
  createMigrator,
  createTemplateApplier,
  t,
} from "@queuert/typed-sql";
import Database from "better-sqlite3";
import { it as baseIt, describe, expect } from "vitest";

import { createLegacyUpgrade } from "../state-adapter/legacy-upgrade.sqlite.js";
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

const FIXTURE_PATH = fileURLToPath(new URL("../../fixtures/v0.15.1.sqlite.gz", import.meta.url));
const MANIFEST_PATH = fileURLToPath(
  new URL("../../fixtures/v0.15.1.manifest.json", import.meta.url),
);

const INSTALL = "001_initial_schema";
const ALL = [INSTALL];

type Provider = SqliteStateProvider<BetterSqlite3Context>;
type Sentinels = {
  pendingJobId: string;
  scheduledJobId: string;
  runningJobId: string;
  completedJobId: string;
  retriedJobId: string;
  blockedJobId: string;
  fanInBlockerId: string;
  fanInBlockedCount: number;
  chainId: string;
  chainLength: number;
};
type Manifest = {
  appliedMigrations: string[];
  totalJobs: number;
  totalBlockers: number;
  byStatus: Record<string, number>;
  sentinels: Sentinels;
};
type Db = {
  db: Database.Database;
  path: string;
  provider: Provider;
  adapter: Awaited<ReturnType<typeof createSqliteStateAdapter<BetterSqlite3Context, string>>>;
};

const applyTemplate = createTemplateApplier({ table_prefix: "queuert_", id_type: "TEXT" });

/** The adapter's own wiring: the legacy scripts bracketing the install. */
const migratorFor = (provider: Provider) => {
  const legacy = createLegacyUpgrade(provider, applyTemplate, t.string());
  return createMigrator({
    migrations,
    store: createMigrationStore(provider, applyTemplate),
    before: legacy.renameLegacySchemaAside,
    after: legacy.importLegacySchema,
  });
};

/** Stops after one phase, to inspect the database between them. */
const partialMigratorFor = (provider: Provider, phases: "rename" | "rename+install") =>
  createMigrator({
    migrations: phases === "rename" ? [] : migrations,
    store: createMigrationStore(provider, applyTemplate),
    before: createLegacyUpgrade(provider, applyTemplate, t.string()).renameLegacySchemaAside,
  });

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

const idText = (value: unknown): string => String(value);
const jobKey = (row: ReconcilerRow): string => idText(row.id);
const blockerKey = (row: ReconcilerRow): string =>
  `${idText(row.job_id)}|${idText(row.blocked_by_chain_id)}|${idText(row.index)}`;

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

// Fails the nth statement whose SQL matches, to cut an upgrade short mid-run.
const failingProvider = (provider: Provider, match: string, occurrence: number): Provider => {
  let seen = 0;
  return {
    ...provider,
    executeSql: async (options) => {
      if (options.sql.includes(match) && ++seen === occurrence) {
        throw new Error("simulated crash");
      }
      return provider.executeSql(options);
    },
  };
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

const objectNames = async (provider: Provider): Promise<string[]> =>
  (await query<{ name: string }>(provider, "SELECT name FROM sqlite_master")).map(
    (row) => row.name,
  );

const relations = async (provider: Provider): Promise<Record<string, boolean>> => {
  const names = new Set(await objectNames(provider));
  return {
    job: names.has("queuert_job"),
    job_blocker: names.has("queuert_job_blocker"),
    job_old: names.has("queuert_job_old"),
    job_blocker_old: names.has("queuert_job_blocker_old"),
  };
};

const counts = async (provider: Provider): Promise<Record<string, number>> => {
  const [row] = await query<Record<string, number>>(
    provider,
    `SELECT (SELECT count(*) FROM queuert_job) AS jobs,
            (SELECT count(*) FROM queuert_job_blocker) AS blockers,
            (SELECT count(*) FROM queuert_migration) AS migration_rows`,
  );
  return row;
};

// ---------------------------------------------------------------------------
// The data contract of the upgrade: every cell not named here must survive it
// byte-identical, and no row may appear or disappear.
// ---------------------------------------------------------------------------

const jobContract: ColumnContract = {
  rename: [
    { from: "leased_by", to: "attempt_by" },
    { from: "leased_until", to: "attempt_until" },
  ],
  drop: ["status"],
  add: [
    {
      column: "continued_to_id",
      derive: (after, beforeRow, snapshot) => {
        const chainId = String(beforeRow.chain_id);
        const nextIndex = Number(beforeRow.chain_index) + 1;
        if (after === null || after === undefined) {
          for (const [, row] of snapshot) {
            if (String(row.chain_id) === chainId && Number(row.chain_index) === nextIndex) {
              return false;
            }
          }
          return true;
        }
        const successor = snapshot.get(after as string);
        return (
          successor !== undefined &&
          String(successor.chain_id) === chainId &&
          Number(successor.chain_index) === nextIndex
        );
      },
    },
    {
      column: "blocked",
      derive: (after, beforeRow) => sqliteBool(after) === (String(beforeRow.status) === "blocked"),
    },
    {
      column: "attempt_at",
      // Workers are stopped during an upgrade, so every running attempt restarts from now.
      derive: (after, beforeRow) =>
        (String(beforeRow.status) === "running") === (after !== null && after !== undefined),
    },
  ],
  inPlace: [
    {
      column: "attempt_by",
      predicate: (after, beforeRow) =>
        String(beforeRow.status) === "running"
          ? after !== null && after !== undefined
          : after === (beforeRow.leased_by ?? null),
    },
    {
      column: "attempt_until",
      predicate: (after, beforeRow) =>
        String(beforeRow.status) === "running"
          ? after !== null && after !== undefined
          : String(after) === String(beforeRow.leased_until),
    },
  ],
};

describe("v0.15.1 upgrade path", () => {
  it(
    "imports every row of a v0.15.1 database under its declared contract",
    { timeout: 60_000 },
    async ({ loaded: { provider, adapter } }) => {
      const jobs = createMigrationReconciler("job", await readRows(provider, "job"), jobKey);
      const blockers = createMigrationReconciler(
        "job_blocker",
        await readRows(provider, "job_blocker"),
        blockerKey,
      );

      const result = await adapter.migrateToLatest();
      expect(result.applied).toEqual(ALL);

      jobs.reconcile("upgrade", jobContract, await readRows(provider, "job"));
      blockers.reconcile("upgrade", {}, await readRows(provider, "job_blocker"));
    },
  );

  it(
    "drops the renamed-aside tables and the superseded migration records",
    { timeout: 60_000 },
    async ({ loaded: { provider, adapter } }) => {
      await adapter.migrateToLatest();

      expect(await relations(provider)).toEqual({
        job: true,
        job_blocker: true,
        job_old: false,
        job_blocker_old: false,
      });
      expect((await counts(provider)).migration_rows).toBe(ALL.length);
      expect(await objectNames(provider)).not.toContain("queuert_job_old_chain_index_idx");
    },
  );

  it("is a no-op on a second run", { timeout: 60_000 }, async ({ loaded: { adapter } }) => {
    await adapter.migrateToLatest();
    const again = await adapter.migrateToLatest();
    expect(again).toEqual({ applied: [], skipped: ALL, unrecognized: [] });
  });

  it(
    "converges to the same schema as a fresh install",
    { timeout: 60_000 },
    async ({ loaded, fresh }) => {
      await loaded.adapter.migrateToLatest();
      await fresh.adapter.migrateToLatest();
      expect(await dumpSchema(loaded.provider)).toBe(await dumpSchema(fresh.provider));
    },
  );

  it(
    "matches the committed manifest counts before migrating",
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
      expect(
        (
          await query<{ name: string }>(
            provider,
            "SELECT name FROM queuert_migration ORDER BY name",
          )
        ).map((row) => row.name),
      ).toEqual(manifest.appliedMigrations);
    },
  );

  it(
    "preserves referential integrity",
    { timeout: 60_000 },
    async ({ loaded: { provider, adapter } }) => {
      await adapter.migrateToLatest();
      expect(await query(provider, "PRAGMA foreign_key_check")).toHaveLength(0);

      const ids = new Set((await readRows(provider, "job")).map((j) => idText(j.id)));
      for (const job of await readRows(provider, "job")) {
        expect(ids.has(idText(job.chain_id))).toBe(true);
        if (job.continued_to_id != null) expect(ids.has(idText(job.continued_to_id))).toBe(true);
      }
      for (const blocker of await readRows(provider, "job_blocker")) {
        expect(ids.has(idText(blocker.job_id))).toBe(true);
        expect(ids.has(idText(blocker.blocked_by_chain_id))).toBe(true);
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

      const [scheduled] = await adapter.getJobs({ jobIds: [sentinels.scheduledJobId] });
      expect(scheduled?.scheduledAt.getTime()).toBeGreaterThan(scheduled!.createdAt.getTime());

      const [blockedJob] = await adapter.getJobs({ jobIds: [sentinels.blockedJobId] });
      expect(blockedJob?.completedAt).toBeNull();
      expect(blockedJob?.attemptAt).toBeNull();
      expect(blockedJob?.blocked).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// Phases and interruption
// ---------------------------------------------------------------------------

describe("upgrade phases", () => {
  it(
    "renames the live tables aside, installs, imports, then drops them",
    { timeout: 60_000 },
    async ({ loaded: { provider } }) => {
      await partialMigratorFor(provider, "rename").migrateToLatest();
      expect(await relations(provider)).toEqual({
        job: false,
        job_blocker: false,
        job_old: true,
        job_blocker_old: true,
      });
      // The names the new schema wants back are freed; the import's join index is kept.
      const prepared = await objectNames(provider);
      expect(prepared).toContain("queuert_job_old_chain_index_idx");
      expect(prepared).not.toContain("queuert_chain_index_idx");
      expect(prepared).not.toContain("queuert_job_deduplication_idx");
      expect(prepared).not.toContain("queuert_job_blocker_chain_idx");

      await partialMigratorFor(provider, "rename+install").migrateToLatest();
      expect((await counts(provider)).jobs).toBe(0);
      expect(await objectNames(provider)).toContain("queuert_job_ready_idx");

      await migratorFor(provider).migrateToLatest();
      const manifest = readManifest();
      const imported = await counts(provider);
      expect({ jobs: imported.jobs, blockers: imported.blockers }).toEqual({
        jobs: manifest.totalJobs,
        blockers: manifest.totalBlockers,
      });
      expect(await relations(provider)).toEqual({
        job: true,
        job_blocker: true,
        job_old: false,
        job_blocker_old: false,
      });
    },
  );

  it(
    "refuses a database older than v0.15.1 without touching it",
    { timeout: 60_000 },
    async ({ loaded: { db, adapter, provider } }) => {
      db.prepare(
        "DELETE FROM queuert_migration WHERE name = '20260617000000_blocker_composite_pk'",
      ).run();

      await expect(adapter.migrateToLatest()).rejects.toThrow(/predates v0\.15\.1/);
      expect(await relations(provider)).toEqual({
        job: true,
        job_blocker: true,
        job_old: false,
        job_blocker_old: false,
      });
    },
  );

  it(
    "refuses a job table that is not in the v0.15.1 shape",
    { timeout: 60_000 },
    async ({ loaded: { db, provider, adapter } }) => {
      // A database carrying records the code does not know about, whose table is
      // already past v0.15.1: the ledger check passes, the shape check must not.
      for (const index of [
        "queuert_job_acquisition_idx",
        "queuert_job_expired_lease_idx",
        "queuert_job_listing_status_idx",
      ]) {
        db.prepare(`DROP INDEX ${index}`).run();
      }
      db.prepare("ALTER TABLE queuert_job DROP COLUMN status").run();

      await expect(adapter.migrateToLatest()).rejects.toThrow(/not in the v0\.15\.1 shape/);
      expect(await relations(provider)).toEqual({
        job: true,
        job_blocker: true,
        job_old: false,
        job_blocker_old: false,
      });
    },
  );

  it(
    "renames aside at most once, however often it runs",
    { timeout: 60_000 },
    async ({ loaded: { provider } }) => {
      // Nothing records a script, so the rename re-runs on every call and has to
      // recognize its own output rather than rely on a ledger entry.
      await partialMigratorFor(provider, "rename").migrateToLatest();
      await expect(partialMigratorFor(provider, "rename").migrateToLatest()).resolves.toMatchObject(
        { applied: [] },
      );

      expect(await relations(provider)).toEqual({
        job: false,
        job_blocker: false,
        job_old: true,
        job_blocker_old: true,
      });
    },
  );

  it(
    "leaves an already-upgraded database alone",
    { timeout: 60_000 },
    async ({ loaded: { provider, adapter } }) => {
      await adapter.migrateToLatest();
      const before = await objectNames(provider);

      await expect(adapter.migrateToLatest()).resolves.toEqual({
        applied: [],
        skipped: ALL,
        unrecognized: [],
      });
      expect(await objectNames(provider)).toEqual(before);
    },
  );

  it(
    "resumes a partial import from the last whole chain",
    { timeout: 60_000 },
    async ({ loaded: { provider, adapter } }) => {
      await expect(
        migratorFor(failingProvider(provider, "INSERT INTO queuert_job (", 3)).migrateToLatest(),
      ).rejects.toThrow(/simulated crash/);

      const manifest = readManifest();
      const partial = await counts(provider);
      expect(partial.jobs).toBeGreaterThan(0);
      expect(partial.jobs).toBeLessThan(manifest.totalJobs);
      expect((await relations(provider)).job_old).toBe(true);
      // Chains commit whole, so an interrupted import never leaves a partial one.
      const [split] = await query<{ c: number }>(
        provider,
        `SELECT count(*) AS c FROM
           (SELECT chain_id, count(*) AS n FROM queuert_job GROUP BY chain_id) j
           JOIN (SELECT chain_id, count(*) AS n FROM queuert_job_old GROUP BY chain_id) b
             ON j.chain_id = b.chain_id
         WHERE j.n <> b.n`,
      );
      expect(split?.c).toBe(0);

      // The install committed before the crash, so the resumed run applies no
      // migration at all — only the import script has work left.
      expect((await adapter.migrateToLatest()).applied).toEqual([]);
      const final = await counts(provider);
      expect({ jobs: final.jobs, blockers: final.blockers }).toEqual({
        jobs: manifest.totalJobs,
        blockers: manifest.totalBlockers,
      });
      expect((await relations(provider)).job_old).toBe(false);
    },
  );

  it(
    "re-runs a completed import without copying twice",
    { timeout: 60_000 },
    async ({ loaded: { provider, adapter } }) => {
      await expect(
        migratorFor(failingProvider(provider, "DROP TABLE", 1)).migrateToLatest(),
      ).rejects.toThrow(/simulated crash/);

      const manifest = readManifest();
      expect((await counts(provider)).jobs).toBe(manifest.totalJobs);
      expect((await relations(provider)).job_old).toBe(true);

      await adapter.migrateToLatest();
      expect((await counts(provider)).jobs).toBe(manifest.totalJobs);
      expect((await relations(provider)).job_old).toBe(false);
    },
  );
});
