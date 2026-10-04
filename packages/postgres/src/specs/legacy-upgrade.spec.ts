import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { type AcquiredPostgres, acquirePostgres } from "@queuert/testcontainers";
import {
  type ColumnContract,
  type InPlaceChange,
  type ReconcilerRow,
  createMigrationReconciler,
  createMigrator,
  createTemplateApplier,
  t,
} from "@queuert/typed-sql";
import { Client, Pool } from "pg";
import postgres from "postgres";
import { it as baseIt, describe, expect } from "vitest";

import { createLegacyUpgrade } from "../state-adapter/legacy-upgrade.pg.js";
import {
  createMigrationStore,
  createPgStateAdapter,
  migrations,
} from "../state-adapter/state-adapter.pg.js";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.js";
import { type PgStateProvider } from "../state-provider/state-provider.pg.js";
import { createPostgresJsProvider } from "../state-provider/state-provider.postgres-js.js";

const SCHEMA_PATH = fileURLToPath(new URL("../../fixtures/v0.15.1.schema.sql", import.meta.url));
const DATA_PATH = fileURLToPath(new URL("../../fixtures/v0.15.1.data.sql.gz", import.meta.url));
const MANIFEST_PATH = fileURLToPath(
  new URL("../../fixtures/v0.15.1.manifest.json", import.meta.url),
);

const INSTALL = "001_initial_schema";
const ALL = [INSTALL];

type Provider = PgStateProvider<PgPoolContext>;
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
type Database = {
  provider: Provider;
  adapter: Awaited<ReturnType<typeof createPgStateAdapter<PgPoolContext, string>>>;
  pg: AcquiredPostgres;
};

const applyTemplate = createTemplateApplier({
  schema: "public",
  table_prefix: "queuert_",
  id_type: "uuid",
});

const migratorFor = (provider: Provider) =>
  createMigrator({
    migrations,
    store: createMigrationStore(provider, applyTemplate),
    before: createLegacyUpgrade(provider, applyTemplate, t.uuid()).upgrade,
  });

// Runs only the copy that precedes the swap, leaving the v0.15.1 tables live, so a test can act
// as a v0.15.1 process between the two.
const prepareWith = async (provider: Provider) =>
  createMigrator({
    migrations: [],
    store: createMigrationStore(provider, applyTemplate),
    before: createLegacyUpgrade(provider, applyTemplate, t.uuid()).prepare,
  }).migrateToLatest();

const query = async <T = Record<string, unknown>>(
  provider: Provider,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> =>
  provider.executeSql({ sql, params, paramTypes: {}, columnTypes: {}, readOnly: true }) as Promise<
    T[]
  >;

const readRows = async (
  provider: Provider,
  table: "job" | "job_blocker" | "job_new" | "job_blocker_new",
): Promise<ReconcilerRow[]> => query(provider, `SELECT * FROM queuert_${table}`);

const jobKey = (row: ReconcilerRow): string => String(row.id);
const blockerKey = (row: ReconcilerRow): string =>
  `${String(row.job_id)}|${String(row.blocked_by_chain_id)}|${String(row.index)}`;

const readManifest = (): Manifest => JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;

const dumpSchema = async (provider: Provider): Promise<string> => {
  const inTables =
    "'queuert_job', 'queuert_job_blocker', 'queuert_migration', 'queuert_migration_lock'";
  const columns = await query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    provider,
    `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name IN (${inTables})
     ORDER BY table_name, column_name`,
  );
  const indexes = await query<{ indexname: string; indexdef: string }>(
    provider,
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename IN (${inTables}) ORDER BY indexname`,
  );
  const relopts = await query<{ relname: string; reloptions: string[] | null }>(
    provider,
    `SELECT relname, reloptions FROM pg_class
     WHERE relname IN ('queuert_job', 'queuert_job_blocker') ORDER BY relname`,
  );
  const constraints = await query<{ rel: string; conname: string; def: string }>(
    provider,
    `SELECT conrelid::regclass::text AS rel, conname, pg_get_constraintdef(oid) AS def
     FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY rel, conname`,
  );
  return [
    ...columns.map(
      (c) =>
        `col ${c.table_name}.${c.column_name} ${c.data_type} null=${c.is_nullable} default=${c.column_default}`,
    ),
    ...indexes.map((i) => `idx ${i.indexname} ${i.indexdef}`),
    ...relopts.map((r) => `rel ${r.relname} ${[...(r.reloptions ?? [])].sort().join(",")}`),
    ...constraints.map((c) => `con ${c.rel}.${c.conname} ${c.def}`),
  ].join("\n");
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

const loadFixture = async (
  connectionString: string,
  relocate: { schema: string; tablePrefix: string } = { schema: "public", tablePrefix: "queuert_" },
): Promise<void> => {
  // Strip psql meta-commands (`\restrict`/`\unrestrict`) — the `pg` driver runs SQL, not psql
  const data = gunzipSync(readFileSync(DATA_PATH))
    .toString("utf8")
    .split("\n")
    .filter((line) => !line.startsWith("\\"))
    .join("\n")
    .replaceAll("public.queuert_", `${relocate.schema}.${relocate.tablePrefix}`);
  const schema = readFileSync(SCHEMA_PATH, "utf8")
    .replace(/\bpublic\b/g, relocate.schema)
    .replaceAll("queuert_", relocate.tablePrefix);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${relocate.schema}`);
    await client.query(schema);
    await client.query(data);
  } finally {
    await client.end();
  }
};

const provision = async (load: boolean): Promise<Database & { dispose: () => Promise<void> }> => {
  const pg = await acquirePostgres("postgres:14", `pg-migration-${randomUUID()}`);
  const pool = new Pool({ connectionString: pg.connectionString });
  const provider = createPgPoolProvider({ pool });
  const adapter = await createPgStateAdapter({
    stateProvider: provider,
    generateId: (): string => randomUUID(),
  });
  if (load) {
    await loadFixture(pg.connectionString);
  }
  return {
    provider,
    adapter,
    pg,
    dispose: async () => {
      await pool.end();
      await pg[Symbol.asyncDispose]();
    },
  };
};

const it = baseIt.extend<{ loaded: Database; fresh: Database }>({
  // oxlint-disable-next-line no-empty-pattern
  loaded: async ({}, use) => {
    const db = await provision(true);
    await use(db);
    await db.dispose();
  },
  // oxlint-disable-next-line no-empty-pattern
  fresh: async ({}, use) => {
    const db = await provision(false);
    await use(db);
    await db.dispose();
  },
});

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

const sameTimestamp = (a: unknown, b: unknown): boolean => {
  if (a == null || b == null) return a == null && b == null;
  return new Date(a as string).getTime() === new Date(b as string).getTime();
};

const tailIndex = new WeakMap<object, Map<string, ReconcilerRow>>();
const chainTail = (
  snapshot: ReadonlyMap<string, Readonly<ReconcilerRow>>,
  chainId: string,
): Readonly<ReconcilerRow> | undefined => {
  let byChain = tailIndex.get(snapshot);
  if (!byChain) {
    byChain = new Map();
    for (const [, row] of snapshot) {
      const key = String(row.chain_id);
      const current = byChain.get(key);
      if (!current || Number(row.chain_index) > Number(current.chain_index)) {
        byChain.set(key, row);
      }
    }
    tailIndex.set(snapshot, byChain);
  }
  return byChain.get(chainId);
};

const headOnly = (column: string, beforeColumn: string = column): InPlaceChange => ({
  column,
  predicate: (after, beforeRow) =>
    Number(beforeRow.chain_index) === 0
      ? (after ?? null) === (beforeRow[beforeColumn] ?? null)
      : after == null,
});

// oxlint-disable-next-line typescript/no-base-to-string
const statusOf = (row: Record<string, unknown>): string => String(row.status);

const relations = async (provider: Provider): Promise<Record<string, boolean>> => {
  const [row] = await query<Record<string, string | null>>(
    provider,
    `SELECT to_regclass('public.queuert_job') AS job,
            to_regclass('public.queuert_job_blocker') AS job_blocker,
            to_regclass('public.queuert_job_new') AS job_new,
            to_regclass('public.queuert_job_blocker_new') AS job_blocker_new,
            to_regclass('public.queuert_upgrade_changed_chain') AS changed_chain`,
  );
  return Object.fromEntries(Object.entries(row).map(([name, value]) => [name, value !== null]));
};

const LEGACY_ONLY = {
  job: true,
  job_blocker: true,
  job_new: false,
  job_blocker_new: false,
  changed_chain: false,
};
const PREPARED = { ...LEGACY_ONLY, job_new: true, job_blocker_new: true, changed_chain: true };
const UPGRADED = LEGACY_ONLY;

const isLegacyShape = async (provider: Provider): Promise<boolean> => {
  const [row] = await query<{ legacy: boolean }>(
    provider,
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'queuert_job' AND column_name = 'chain_type_name'
     ) AS legacy`,
  );
  return row.legacy;
};

const counts = async (provider: Provider): Promise<Record<string, number>> => {
  const [row] = await query<Record<string, string>>(
    provider,
    `SELECT (SELECT count(*) FROM queuert_job) AS jobs,
            (SELECT count(*) FROM queuert_job_blocker) AS blockers,
            (SELECT count(*) FROM queuert_migration) AS migration_rows,
            (SELECT count(*) FROM pg_type WHERE typname = 'queuert_job_status') AS job_status_enum`,
  );
  return Object.fromEntries(Object.entries(row).map(([name, value]) => [name, Number(value)]));
};

const jobContract: ColumnContract = {
  rename: [
    { from: "leased_by", to: "attempt_by" },
    { from: "leased_until", to: "attempt_until" },
    { from: "deduplication_key", to: "chain_deduplication_key" },
  ],
  drop: ["chain_type_name"],
  add: [
    {
      column: "chain_completed_at",
      derive: (after, beforeRow, snapshot) => {
        if (Number(beforeRow.chain_index) !== 0) return after == null;
        const tail = chainTail(snapshot, String(beforeRow.chain_id));
        return sameTimestamp(after, tail?.completed_at ?? null);
      },
    },
    {
      column: "chain_status",
      derive: (after, beforeRow, snapshot) => {
        if (Number(beforeRow.chain_index) !== 0) return after == null;
        const tail = chainTail(snapshot, String(beforeRow.chain_id));
        return after === (tail?.completed_at != null ? "completed" : "running");
      },
    },
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
      column: "attempt_at",
      derive: (after, beforeRow) =>
        (String(beforeRow.status) === "running") === (after !== null && after !== undefined),
    },
  ],
  inPlace: [
    headOnly("chain_deduplication_key", "deduplication_key"),
    headOnly("chain_trace_context"),
    {
      column: "attempt_by",
      predicate: (after, beforeRow) =>
        (String(beforeRow.status) === "running") === (after !== null && after !== undefined),
    },
    {
      column: "attempt_until",
      predicate: (after, beforeRow) =>
        (String(beforeRow.status) === "running") === (after !== null && after !== undefined),
    },
  ],
};

describe("v0.15.1 upgrade path", () => {
  it(
    "imports every row of a v0.15.1 database under its declared contract",
    { timeout: 120_000 },
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
    "drops the v0.15.1 tables, the upgrade's tracking objects, the legacy enum, and the superseded migration records",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await adapter.migrateToLatest();

      expect(await relations(provider)).toEqual(UPGRADED);
      expect(await isLegacyShape(provider)).toBe(false);
      const after = await counts(provider);
      expect(after.job_status_enum).toBe(0);
      expect(after.migration_rows).toBe(ALL.length);
      const [leftovers] = await query<{ functions: number; triggers: number }>(
        provider,
        `SELECT (SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'queuert_upgrade_%') AS functions,
                (SELECT count(*)::int FROM pg_trigger WHERE tgname = 'queuert_upgrade_track') AS triggers`,
      );
      expect(leftovers).toEqual({ functions: 0, triggers: 0 });
      const indexes = await indexNames(provider);
      expect(indexes).not.toContain("queuert_job_old_chain_index_idx");
      expect(indexes).not.toContain("queuert_job_blocker_old_chain_idx");
    },
  );

  it("is a no-op on a second run", { timeout: 120_000 }, async ({ loaded: { adapter } }) => {
    await adapter.migrateToLatest();
    const again = await adapter.migrateToLatest();
    expect(again).toEqual({ applied: [], skipped: ALL, unrecognized: [] });
  });

  it(
    "converges to the same schema as a fresh install",
    { timeout: 120_000 },
    async ({ loaded, fresh }) => {
      await loaded.adapter.migrateToLatest();
      await fresh.adapter.migrateToLatest();
      expect(await dumpSchema(loaded.provider)).toBe(await dumpSchema(fresh.provider));
    },
  );

  it(
    "matches the committed manifest counts before migrating",
    { timeout: 120_000 },
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
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await adapter.migrateToLatest();
      const ids = new Set((await readRows(provider, "job")).map((j) => String(j.id)));
      const [orphans] = await query<{ chain: number; continued: number }>(
        provider,
        `SELECT
           (SELECT count(*)::int FROM queuert_job j
            LEFT JOIN queuert_job p ON j.chain_id = p.id WHERE p.id IS NULL) AS chain,
           (SELECT count(*)::int FROM queuert_job j
            LEFT JOIN queuert_job s ON j.continued_to_id = s.id
            WHERE j.continued_to_id IS NOT NULL AND s.id IS NULL) AS continued`,
      );
      expect(orphans).toEqual({ chain: 0, continued: 0 });

      for (const blocker of await readRows(provider, "job_blocker")) {
        expect(ids.has(String(blocker.job_id))).toBe(true);
        expect(ids.has(String(blocker.blocked_by_chain_id))).toBe(true);
      }
    },
  );

  it(
    "leaves data semantically intact and readable by the engine",
    { timeout: 120_000 },
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
      expect(chainJobs.every((stateJob, i) => (stateJob.input as { n: number }).n === i)).toBe(
        true,
      );
      for (let i = 0; i < chainJobs.length - 1; i++) {
        expect(chainJobs[i].continuedToId).toBe(chainJobs[i + 1].id);
      }
      expect(chainJobs[chainJobs.length - 1].continuedToId).toBeNull();
      expect(chainJobs[0].chain.completedAt).toEqual(chainJobs[chainJobs.length - 1].completedAt);

      const [blockerChain] = await adapter.getJobBlockers({ jobId: sentinels.blockedJobId });
      expect(blockerChain.id).toBe(sentinels.fanInBlockerId);
      const [fanIn] = await query<{ c: number }>(
        provider,
        "SELECT count(*)::int AS c FROM queuert_job_blocker WHERE blocked_by_chain_id = $1",
        [sentinels.fanInBlockerId],
      );
      expect(fanIn?.c).toBe(sentinels.fanInBlockedCount);

      const [completed] = await adapter.getJobs({ jobIds: [sentinels.completedJobId] });
      expect(completed?.status).toBe("completed");
      expect(completed?.completedAt).not.toBeNull();
      expect(completed?.output).toMatchObject({ ok: true });
      expect(completed?.chain.status).toBe("completed");
      expect(completed?.chain.completedAt).not.toBeNull();

      const [running] = await adapter.getJobs({ jobIds: [sentinels.runningJobId] });
      expect(running?.status).toBe("running");
      expect(running?.attemptAt).not.toBeNull();
      expect(running?.attemptBy).not.toBeNull();
      expect(running?.attemptUntil).not.toBeNull();
      expect(running?.completedAt).toBeNull();
      expect(running?.chain.completedAt).toBeNull();

      const [retried] = await adapter.getJobs({ jobIds: [sentinels.retriedJobId] });
      expect(retried?.status).toBe("pending");
      expect(retried?.completedAt).toBeNull();
      expect(retried?.attemptAt).toBeNull();
      expect(String(retried?.lastAttemptError)).toContain("transient");

      const [scheduled] = await adapter.getJobs({ jobIds: [sentinels.scheduledJobId] });
      expect(scheduled?.scheduledAt.getTime()).toBeGreaterThan(scheduled!.createdAt.getTime());

      const [blockedJob] = await adapter.getJobs({ jobIds: [sentinels.blockedJobId] });
      expect(blockedJob?.status).toBe("blocked");
      expect(blockedJob?.completedAt).toBeNull();
      expect(blockedJob?.attemptAt).toBeNull();
      expect(blockedJob?.chain.status).toBe("running");
    },
  );
});

const indexNames = async (provider: Provider): Promise<string[]> =>
  (
    await query<{ indexname: string }>(
      provider,
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
    )
  ).map((row) => row.indexname);

describe("upgrade phases", () => {
  it(
    "prepares the new tables beside the live ones, then swaps them in",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      const manifest = readManifest();
      await prepareWith(provider);

      expect(await relations(provider)).toEqual(PREPARED);
      expect(await isLegacyShape(provider)).toBe(true);
      expect((await readRows(provider, "job_new")).length).toBe(manifest.totalJobs);
      expect((await readRows(provider, "job_blocker_new")).length).toBe(manifest.totalBlockers);
      expect((await counts(provider)).migration_rows).toBe(manifest.appliedMigrations.length);
      const prepared = await indexNames(provider);
      expect(prepared).toContain("queuert_job_old_chain_index_idx");
      expect(prepared).toContain("queuert_job_blocker_old_chain_idx");
      expect(prepared).toContain("queuert_job_pending_idx");

      expect((await adapter.migrateToLatest()).applied).toEqual(ALL);
      const upgraded = await counts(provider);
      expect({ jobs: upgraded.jobs, blockers: upgraded.blockers }).toEqual({
        jobs: manifest.totalJobs,
        blockers: manifest.totalBlockers,
      });
      expect(await relations(provider)).toEqual(UPGRADED);
    },
  );

  it(
    "prepares as a no-op on a fresh or an already-upgraded database",
    { timeout: 120_000 },
    async ({ loaded, fresh }) => {
      await prepareWith(fresh.provider);
      expect((await relations(fresh.provider)).job).toBe(false);

      await loaded.adapter.migrateToLatest();
      const before = await dumpSchema(loaded.provider);
      await prepareWith(loaded.provider);
      expect(await dumpSchema(loaded.provider)).toBe(before);
    },
  );

  it(
    "refuses a database older than v0.15.1 without touching it",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await query(
        provider,
        "DELETE FROM queuert_migration WHERE name = '20260617000000_blocker_composite_pk'",
      );

      await expect(prepareWith(provider)).rejects.toThrow(/predates v0\.15\.1/);
      await expect(adapter.migrateToLatest()).rejects.toThrow(/predates v0\.15\.1/);
      expect(await relations(provider)).toEqual(LEGACY_ONLY);
    },
  );

  it(
    "refuses a job table that is not in the v0.15.1 shape",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await query(provider, "ALTER TABLE queuert_job DROP COLUMN chain_type_name");

      await expect(adapter.migrateToLatest()).rejects.toThrow(/not in the v0\.15\.1 shape/);
      expect(await relations(provider)).toEqual(LEGACY_ONLY);
    },
  );

  it(
    "refuses a job table that already has a column the current schema added",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await query(provider, "ALTER TABLE queuert_job ADD COLUMN continued_to_id uuid");

      await expect(adapter.migrateToLatest()).rejects.toThrow(/not in the v0\.15\.1 shape/);
      expect(await relations(provider)).toEqual(LEGACY_ONLY);
    },
  );

  it(
    "refuses a schema migrated past v0.15.1 without touching it",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await query(
        provider,
        "INSERT INTO queuert_migration (name) VALUES ('20260622000000_job_model_v2_expand')",
      );
      const indexesBefore = await indexNames(provider);

      await expect(adapter.migrateToLatest()).rejects.toThrow(
        /migrations this upgrade does not know \(20260622000000_job_model_v2_expand\)/,
      );
      expect(await relations(provider)).toEqual(LEGACY_ONLY);
      expect((await counts(provider)).migration_rows).toBe(
        readManifest().appliedMigrations.length + 1,
      );
      expect(
        (await indexNames(provider)).filter((name) => name !== "queuert_migration_lock_pkey"),
      ).toEqual(indexesBefore);
    },
  );

  it(
    "leaves an already-upgraded database alone",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await adapter.migrateToLatest();
      const before = await dumpSchema(provider);

      await expect(adapter.migrateToLatest()).resolves.toEqual({
        applied: [],
        skipped: ALL,
        unrecognized: [],
      });
      expect(await dumpSchema(provider)).toBe(before);
    },
  );

  it(
    "resumes a partial copy from the last whole chain",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await expect(
        prepareWith(failingProvider(provider, "INSERT INTO public.queuert_job_new (", 3)),
      ).rejects.toThrow(/simulated crash/);

      const manifest = readManifest();
      const partial = (await readRows(provider, "job_new")).length;
      expect(partial).toBeGreaterThan(0);
      expect(partial).toBeLessThan(manifest.totalJobs);
      const [split] = await query<{ c: number }>(
        provider,
        `SELECT count(*)::int AS c FROM
           (SELECT chain_id, count(*) AS n FROM queuert_job_new GROUP BY chain_id) j
           JOIN (SELECT chain_id, count(*) AS n FROM queuert_job GROUP BY chain_id) b
             ON j.chain_id = b.chain_id
         WHERE j.n <> b.n`,
      );
      expect(split?.c).toBe(0);

      expect((await adapter.migrateToLatest()).applied).toEqual(ALL);
      const final = await counts(provider);
      expect({ jobs: final.jobs, blockers: final.blockers }).toEqual({
        jobs: manifest.totalJobs,
        blockers: manifest.totalBlockers,
      });
      expect(await relations(provider)).toEqual(UPGRADED);
    },
  );

  it(
    "resumes after a crash while building the new indexes",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await expect(
        migratorFor(
          failingProvider(provider, "CREATE INDEX IF NOT EXISTS queuert_job_pending_idx", 1),
        ).migrateToLatest(),
      ).rejects.toThrow(/simulated crash/);

      expect(await relations(provider)).toEqual(PREPARED);
      expect(await isLegacyShape(provider)).toBe(true);
      const partial = await indexNames(provider);
      expect(partial).toContain("queuert_job_idx");
      expect(partial).not.toContain("queuert_job_pending_idx");

      expect((await adapter.migrateToLatest()).applied).toEqual(ALL);
      expect(await relations(provider)).toEqual(UPGRADED);
      expect(await indexNames(provider)).toContain("queuert_job_pending_idx");
      expect((await counts(provider)).jobs).toBe(readManifest().totalJobs);
    },
  );

  it(
    "keeps a changed chain marked when a catch-up pass crashes",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      const { sentinels } = readManifest();
      await prepareWith(provider);
      await query(provider, `UPDATE queuert_job SET input = '{"caught": true}' WHERE id = $1`, [
        sentinels.pendingJobId,
      ]);

      // Every chain is already copied, so the first copy this run makes is a catch-up pass.
      await expect(
        migratorFor(
          failingProvider(provider, "DELETE FROM public.queuert_job_new WHERE chain_id", 1),
        ).migrateToLatest(),
      ).rejects.toThrow(/simulated crash/);

      expect(await relations(provider)).toEqual(PREPARED);
      const [marked] = await query<{ c: number }>(
        provider,
        "SELECT count(*)::int AS c FROM queuert_upgrade_changed_chain WHERE chain_id = (SELECT chain_id FROM queuert_job WHERE id = $1)",
        [sentinels.pendingJobId],
      );
      expect(marked?.c).toBe(1);

      expect((await adapter.migrateToLatest()).applied).toEqual(ALL);
      const [job] = await adapter.getJobs({ jobIds: [sentinels.pendingJobId] });
      expect(job?.input).toEqual({ caught: true });
    },
  );

  it(
    "keeps the v0.15.1 tables and names the left-behind jobs when a chain has no head",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await query(
        provider,
        `UPDATE queuert_job SET chain_id = id
         WHERE id = (SELECT id FROM queuert_job WHERE chain_index > 0 ORDER BY id LIMIT 1)`,
      );

      await expect(adapter.migrateToLatest()).rejects.toThrow(
        /1\/\d+ jobs .* list them with `SELECT \* FROM public\.queuert_job o WHERE NOT EXISTS/,
      );
      expect(await relations(provider)).toEqual(PREPARED);
      expect(await isLegacyShape(provider)).toBe(true);
    },
  );

  it(
    "rolls a failed swap back to the live v0.15.1 tables",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await expect(
        migratorFor(failingProvider(provider, "DROP TABLE", 1)).migrateToLatest(),
      ).rejects.toThrow(/simulated crash/);

      expect(await relations(provider)).toEqual(PREPARED);
      expect(await isLegacyShape(provider)).toBe(true);

      expect((await adapter.migrateToLatest()).applied).toEqual(ALL);
      expect((await counts(provider)).jobs).toBe(readManifest().totalJobs);
      expect(await relations(provider)).toEqual(UPGRADED);
    },
  );
});

const LEGACY_CHAIN_ID = "20000000-0000-4000-8000-000000000001";

describe("changes made by v0.15.1 while upgrading", () => {
  it(
    "carries inserts, updates and deletes made after the copy into the swap",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      const manifest = readManifest();
      const { sentinels } = manifest;
      await prepareWith(provider);

      const [removable] = await query<{ id: string }>(
        provider,
        `SELECT j.id FROM queuert_job j
         WHERE j.chain_index = 0 AND j.status = 'completed'
           AND NOT EXISTS (SELECT 1 FROM queuert_job c WHERE c.chain_id = j.id AND c.id <> j.id)
           AND NOT EXISTS (SELECT 1 FROM queuert_job_blocker b
                           WHERE b.blocked_by_chain_id = j.id OR b.job_id = j.id)
         ORDER BY j.id LIMIT 1`,
      );
      await query(provider, "DELETE FROM queuert_job WHERE id = $1", [removable.id]);
      await query(
        provider,
        `UPDATE queuert_job SET status = 'completed', output = '{"live": true}', completed_at = now(),
           completed_by = 'v0.15.1-worker'
         WHERE id = $1`,
        [sentinels.pendingJobId],
      );
      await query(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_type_name, chain_index, status)
         VALUES ($1, 'live', $1, 'live', 0, 'blocked')`,
        [LEGACY_CHAIN_ID],
      );
      await query(
        provider,
        `INSERT INTO queuert_job_blocker (job_id, blocked_by_chain_id, index) VALUES ($1, $2, 0)`,
        [LEGACY_CHAIN_ID, sentinels.fanInBlockerId],
      );

      expect((await adapter.migrateToLatest()).applied).toEqual(ALL);

      const final = await counts(provider);
      expect({ jobs: final.jobs, blockers: final.blockers }).toEqual({
        jobs: manifest.totalJobs,
        blockers: manifest.totalBlockers + 1,
      });
      expect(await adapter.getJobs({ jobIds: [removable.id] })).toEqual([undefined]);
      const [completed] = await adapter.getJobs({ jobIds: [sentinels.pendingJobId] });
      expect(completed?.status).toBe("completed");
      expect(completed?.output).toEqual({ live: true });
      expect(completed?.chain.status).toBe(
        completed?.continuedToId === null ? "completed" : "running",
      );
      const [inserted] = await adapter.getJobs({ jobIds: [LEGACY_CHAIN_ID] });
      expect(inserted?.status).toBe("blocked");
      expect(inserted?.chain.status).toBe("running");
      const [blocker] = await adapter.getJobBlockers({ jobId: LEGACY_CHAIN_ID });
      expect(blocker?.id).toBe(sentinels.fanInBlockerId);
    },
  );

  it(
    "keeps every change v0.15.1 workers commit while migrateToLatest runs",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter, pg } }) => {
      const workers = new Pool({ connectionString: pg.connectionString, max: 3 });
      const createdChains: string[] = [];
      const completedJobs = new Map<string, number>();
      let stopped = false;
      let stoppedBy: unknown;
      // A function read, so lint sees that the workers can flip `stopped` while the loop below waits.
      const isStopped = (): boolean => stopped;

      // Plays a v0.15.1 worker against the v0.15.1 tables until the swap drops them: each step
      // starts a chain blocked on a new blocker chain, and completes one pending job.
      const worker = async (workerIndex: number): Promise<void> => {
        for (let step = 0; !stopped; step++) {
          const client = await workers.connect();
          try {
            await client.query("BEGIN");
            const [blockerId, dependentId] = [randomUUID(), randomUUID()];
            await client.query(
              `INSERT INTO queuert_job (id, type_name, chain_id, chain_type_name, chain_index, status)
               VALUES ($1, 'live', $1, 'live', 0, 'pending'), ($2, 'live', $2, 'live', 0, 'blocked')`,
              [blockerId, dependentId],
            );
            await client.query(
              "INSERT INTO queuert_job_blocker (job_id, blocked_by_chain_id, index) VALUES ($1, $2, 0)",
              [dependentId, blockerId],
            );
            const { rows } = await client.query<{ id: string }>(
              `SELECT id FROM queuert_job WHERE status = 'pending' AND type_name <> 'live'
               LIMIT 1 FOR UPDATE SKIP LOCKED`,
            );
            const marker = workerIndex * 1_000_000 + step;
            if (rows[0]) {
              await client.query(
                `UPDATE queuert_job SET status = 'completed', completed_at = now(), output = $2
                 WHERE id = $1`,
                [rows[0].id, JSON.stringify({ marker })],
              );
            }
            await client.query("COMMIT");
            createdChains.push(blockerId, dependentId);
            if (rows[0]) completedJobs.set(rows[0].id, marker);
          } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            stoppedBy = error;
            stopped = true;
          } finally {
            client.release();
          }
        }
      };

      const running = [0, 1, 2].map(worker);
      try {
        while (createdChains.length < 30 && !isStopped()) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect((await adapter.migrateToLatest()).applied).toEqual(ALL);
        stopped = true;
        await Promise.all(running);
      } finally {
        stopped = true;
        await workers.end();
      }
      // A worker that outlived the swap fails on the v0.15.1 shape, or not at all if none was mid-step.
      if (stoppedBy !== undefined) {
        expect(stoppedBy).toMatchObject({ message: expect.stringMatching(/does not exist/) });
      }

      const manifest = readManifest();
      const final = await counts(provider);
      expect({ jobs: final.jobs, blockers: final.blockers }).toEqual({
        jobs: manifest.totalJobs + createdChains.length,
        blockers: manifest.totalBlockers + createdChains.length / 2,
      });
      const created = await adapter.getJobs({ jobIds: createdChains });
      expect(created.every((job) => job?.chain.status === "running")).toBe(true);
      const completed = await adapter.getJobs({ jobIds: [...completedJobs.keys()] });
      for (const job of completed) {
        expect(job?.status).toBe("completed");
        expect(job?.output).toEqual({ marker: completedJobs.get(job!.id) });
      }
    },
  );

  it(
    "does not lose a change whose transaction is still open while a copy pass runs",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter, pg } }) => {
      const { sentinels } = readManifest();
      await prepareWith(provider);
      // A committed change leaves the chain marked, so the open one below finds the mark present.
      await query(provider, `UPDATE queuert_job SET input = '{"step": 1}' WHERE id = $1`, [
        sentinels.pendingJobId,
      ]);

      const worker = new Client({ connectionString: pg.connectionString });
      await worker.connect();
      try {
        await worker.query("BEGIN");
        await worker.query(`UPDATE queuert_job SET input = '{"step": 2}' WHERE id = $1`, [
          sentinels.pendingJobId,
        ]);

        await prepareWith(provider);
        const [copied] = await query<{ input: unknown }>(
          provider,
          "SELECT input FROM queuert_job_new WHERE id = $1",
          [sentinels.pendingJobId],
        );
        expect(copied?.input).not.toEqual({ step: 2 });

        await worker.query("COMMIT");
      } finally {
        await worker.end();
      }

      expect((await adapter.migrateToLatest()).applied).toEqual(ALL);
      const [job] = await adapter.getJobs({ jobIds: [sentinels.pendingJobId] });
      expect(job?.input).toEqual({ step: 2 });
    },
  );

  it(
    "carries an unblock v0.15.1 makes after the dependent was copied",
    { timeout: 120_000 },
    async ({ fresh: { provider, adapter, pg } }) => {
      await loadSplitBlockerFixture(pg.connectionString, {
        blockerChainId: LAST_CHAIN_ID,
        dependentChainId: FIRST_CHAIN_ID,
      });
      await prepareWith(provider);

      await query(
        provider,
        `UPDATE queuert_job SET status = 'completed', output = 'null', completed_at = now() WHERE id = $1`,
        [LAST_CHAIN_ID],
      );
      await query(provider, "UPDATE queuert_job SET status = 'pending' WHERE id = $1", [
        FIRST_CHAIN_ID,
      ]);

      expect((await adapter.migrateToLatest()).applied).toEqual(ALL);
      const [dependent] = await adapter.getJobs({ jobIds: [FIRST_CHAIN_ID] });
      expect(dependent?.status).toBe("pending");
      const [blocker] = await adapter.getJobBlockers({ jobId: FIRST_CHAIN_ID });
      expect(blocker?.status).toBe("completed");
    },
  );
});

describe("upgrade robustness", () => {
  it(
    "fails with a directed error when the job tables stay locked, keeping the copy",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter, pg } }) => {
      const holder = new Client({ connectionString: pg.connectionString });
      await holder.connect();
      try {
        await holder.query("BEGIN");
        await holder.query("LOCK TABLE public.queuert_job IN ACCESS SHARE MODE");

        await expect(adapter.migrateToLatest()).rejects.toThrow(/stop all workers/);
        expect(await relations(provider)).toEqual(PREPARED);
        expect(await isLegacyShape(provider)).toBe(true);
        expect((await counts(provider)).migration_rows).toBe(
          readManifest().appliedMigrations.length,
        );

        await holder.query("ROLLBACK");
      } finally {
        await holder.end();
      }

      expect((await adapter.migrateToLatest()).applied).toEqual(ALL);
      expect((await counts(provider)).jobs).toBe(readManifest().totalJobs);
    },
  );

  it(
    "fails with a directed error when the tracking triggers cannot be installed",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter, pg } }) => {
      const holder = new Client({ connectionString: pg.connectionString });
      await holder.connect();
      try {
        await holder.query("BEGIN");
        await holder.query("LOCK TABLE public.queuert_job IN ROW EXCLUSIVE MODE");

        await expect(prepareWith(provider)).rejects.toThrow(/Cannot prepare the upgrade/);
        expect(await relations(provider)).toEqual(LEGACY_ONLY);
        expect(await indexNames(provider)).toContain("queuert_chain_index_idx");

        await holder.query("ROLLBACK");
      } finally {
        await holder.end();
      }

      expect((await adapter.migrateToLatest()).applied).toEqual(ALL);
    },
  );

  it(
    "upgrades a mixed-case table prefix in a non-public schema",
    { timeout: 120_000 },
    async () => {
      const pg = await acquirePostgres("postgres:14", `pg-migration-${randomUUID()}`);
      const pool = new Pool({ connectionString: pg.connectionString });
      try {
        await loadFixture(pg.connectionString, { schema: "LegacySchema", tablePrefix: "MyApp_" });
        const provider = createPgPoolProvider({ pool });
        const adapter = await createPgStateAdapter({
          stateProvider: provider,
          schema: "LegacySchema",
          tablePrefix: "MyApp_",
          generateId: (): string => randomUUID(),
        });

        expect((await adapter.migrateToLatest()).applied).toEqual(ALL);

        const manifest = readManifest();
        const [row] = await query<Record<string, string | null>>(
          provider,
          `SELECT (SELECT count(*) FROM LegacySchema.MyApp_job)::int AS jobs,
                  (SELECT count(*) FROM LegacySchema.MyApp_job_blocker)::int AS blockers,
                  to_regclass('LegacySchema.MyApp_job_new') AS job_new,
                  to_regclass('LegacySchema.MyApp_job_blocker_new') AS job_blocker_new`,
        );
        expect(row).toEqual({
          jobs: manifest.totalJobs,
          blockers: manifest.totalBlockers,
          job_new: null,
          job_blocker_new: null,
        });
        const [blocked] = await adapter.getJobs({ jobIds: [manifest.sentinels.blockedJobId] });
        expect(blocked?.status).toBe("blocked");
      } finally {
        await pool.end();
        await pg[Symbol.asyncDispose]();
      }
    },
  );
});

describe("upgrade data fidelity", () => {
  it(
    "clears attempt fields on jobs that are not running",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      const { sentinels } = readManifest();
      await query(
        provider,
        "UPDATE queuert_job SET leased_by = 'stale-worker', leased_until = now() WHERE id IN ($1, $2)",
        [sentinels.pendingJobId, sentinels.completedJobId],
      );

      await adapter.migrateToLatest();

      for (const job of await adapter.getJobs({
        jobIds: [sentinels.pendingJobId, sentinels.completedJobId],
      })) {
        expect(job?.attemptBy).toBeNull();
        expect(job?.attemptUntil).toBeNull();
        expect(job?.attemptAt).toBeNull();
      }
    },
  );

  it(
    "names constraints like a fresh install, even for a prefix long enough that Postgres truncates them",
    { timeout: 120_000 },
    async () => {
      // The longest prefix v0.15.1 could migrate: its blocker primary key rebuild dropped
      // `<prefix>job_blocker_pkey` by name, which a longer prefix truncates differently.
      const tablePrefix = `${"p".repeat(46)}_`;
      const pg = await acquirePostgres("postgres:14", `pg-migration-${randomUUID()}`);
      const pool = new Pool({ connectionString: pg.connectionString });
      try {
        await loadFixture(pg.connectionString, { schema: "public", tablePrefix });
        const provider = createPgPoolProvider({ pool });
        const adapterIn = async (schema: string) =>
          createPgStateAdapter({
            stateProvider: provider,
            schema,
            tablePrefix,
            generateId: (): string => randomUUID(),
          });
        expect((await (await adapterIn("public")).migrateToLatest()).applied).toEqual(ALL);
        await query(provider, "CREATE SCHEMA fresh");
        await (await adapterIn("fresh")).migrateToLatest();

        const constraintNames = async (schema: string) =>
          (
            await query<{ conname: string }>(
              provider,
              `SELECT conname FROM pg_constraint
               WHERE connamespace = $1::regnamespace AND contype IN ('p', 'c', 'n')
               ORDER BY conname`,
              [schema],
            )
          ).map((row) => row.conname);
        expect(await constraintNames("public")).toEqual(await constraintNames("fresh"));

        const manifest = readManifest();
        const [row] = await query<Record<string, string | number | null>>(
          provider,
          `SELECT (SELECT count(*) FROM public.${tablePrefix}job)::int AS jobs,
                  (SELECT count(*) FROM public.${tablePrefix}job_blocker)::int AS blockers,
                  to_regclass('public.${tablePrefix}job_new') AS job_new`,
        );
        expect(row).toEqual({
          jobs: manifest.totalJobs,
          blockers: manifest.totalBlockers,
          job_new: null,
        });
      } finally {
        await pool.end();
        await pg[Symbol.asyncDispose]();
      }
    },
  );
});

const FIRST_CHAIN_ID = "00000000-0000-4000-8000-000000000001";
const LAST_CHAIN_ID = "ffffffff-0000-4000-8000-000000000001";

// One chain sorts first and the other last, with a full batch of completed chains in between, so
// the copy lands them in different batches.
const loadSplitBlockerFixture = async (
  connectionString: string,
  { blockerChainId, dependentChainId }: { blockerChainId: string; dependentChainId: string },
): Promise<void> => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(readFileSync(SCHEMA_PATH, "utf8"));
    await client.query(/* sql */ `
INSERT INTO public.queuert_job (id, type_name, chain_id, chain_type_name, chain_index, status)
VALUES
  ('${blockerChainId}', 'blocker', '${blockerChainId}', 'blocker', 0, 'pending'),
  ('${dependentChainId}', 'dependent', '${dependentChainId}', 'dependent', 0, 'blocked');

INSERT INTO public.queuert_job (id, type_name, chain_id, chain_type_name, chain_index, status, output, completed_at)
SELECT id, 'filler', id, 'filler', 0, 'completed', 'null', now()
FROM (SELECT format('10000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid AS id
      FROM generate_series(1, 1000) AS i) AS filler;

INSERT INTO public.queuert_job_blocker (job_id, blocked_by_chain_id, index)
VALUES ('${dependentChainId}', '${blockerChainId}', 0);
`);
  } finally {
    await client.end();
  }
};

const TEXT_ID_ROWS = /* sql */ `
INSERT INTO public.queuert_job (id, type_name, chain_id, chain_type_name, chain_index, status, output, completed_at, leased_by, leased_until)
VALUES
  ('job.a0', 'first', 'job.a0', 'chain', 0, 'completed', '{"ok": true}', now(), NULL, NULL),
  ('job.a1', 'second', 'job.a0', 'chain', 1, 'blocked', NULL, NULL, NULL, NULL),
  ('job.b0', 'blocker', 'job.b0', 'blocker_chain', 0, 'running', NULL, NULL, 'worker-1', now());

INSERT INTO public.queuert_job_blocker (job_id, blocked_by_chain_id, index)
VALUES ('job.a1', 'job.b0', 0);
`;

describe("custom id types", () => {
  it(
    "upgrades a text-id database through a provider that honours declared param types",
    { timeout: 120_000 },
    async () => {
      const pg = await acquirePostgres("postgres:14", `pg-migration-${randomUUID()}`);
      const sql = postgres(pg.connectionString, { max: 4, onnotice: () => {} });
      try {
        await sql.unsafe(readFileSync(SCHEMA_PATH, "utf8").replace(/\buuid\b/g, "text"));
        await sql.unsafe(TEXT_ID_ROWS);

        const stateProvider = createPostgresJsProvider({ sql });
        const adapter = await createPgStateAdapter({
          stateProvider,
          idType: "text",
          generateId: (): string => `job.${randomUUID()}`,
        });
        const textApplyTemplate = createTemplateApplier({
          schema: "public",
          table_prefix: "queuert_",
          id_type: "text",
        });
        await createMigrator({
          migrations: [],
          store: createMigrationStore(stateProvider, textApplyTemplate),
          before: createLegacyUpgrade(stateProvider, textApplyTemplate, t.string()).prepare,
        }).migrateToLatest();
        await sql.unsafe(
          `UPDATE public.queuert_job SET status = 'completed', completed_at = now(), output = 'null' WHERE id = 'job.b0'`,
        );
        expect((await adapter.migrateToLatest()).applied).toEqual(ALL);

        const [head] = await adapter.getJobs({ jobIds: ["job.a0"] });
        expect(head?.continuedToId).toBe("job.a1");
        const [blocked] = await adapter.getJobs({ jobIds: ["job.a1"] });
        expect(blocked?.status).toBe("blocked");
        expect(blocked?.continuedToId).toBeNull();
        expect(blocked?.chain.completedAt).toBeNull();
        const [completed] = await adapter.getJobs({ jobIds: ["job.b0"] });
        expect(completed?.status).toBe("completed");
        expect(completed?.chain.status).toBe("completed");
        const [blocker] = await adapter.getJobBlockers({ jobId: "job.a1" });
        expect(blocker.id).toBe("job.b0");

        const [relation] = await sql.unsafe(
          `SELECT to_regclass('public.queuert_job_new') AS job_new`,
        );
        expect(relation.job_new).toBeNull();
      } finally {
        await sql.end();
        await pg[Symbol.asyncDispose]();
      }
    },
  );
});
