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

const migratorFor = (provider: Provider) => {
  const legacy = createLegacyUpgrade(provider, applyTemplate, t.uuid());
  return createMigrator({
    migrations,
    store: createMigrationStore(provider, applyTemplate),
    before: legacy.renameLegacySchemaAside,
    after: legacy.importLegacySchema,
  });
};

const partialMigratorFor = (provider: Provider, phases: "rename" | "rename+install") =>
  createMigrator({
    migrations: phases === "rename" ? [] : migrations,
    store: createMigrationStore(provider, applyTemplate),
    before: createLegacyUpgrade(provider, applyTemplate, t.uuid()).renameLegacySchemaAside,
  });

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
  table: "job" | "job_blocker" | "job_old" | "job_blocker_old",
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

const provision = async (load: boolean): Promise<Database & { dispose: () => Promise<void> }> => {
  const pg = await acquirePostgres("postgres:14", `pg-migration-${randomUUID()}`);
  const pool = new Pool({ connectionString: pg.connectionString });
  const provider = createPgPoolProvider({ pool });
  const adapter = await createPgStateAdapter({
    stateProvider: provider,
    generateId: (): string => randomUUID(),
  });
  if (load) {
    // Strip psql meta-commands (`\restrict`/`\unrestrict`) — the `pg` driver runs SQL, not psql
    const data = gunzipSync(readFileSync(DATA_PATH))
      .toString("utf8")
      .split("\n")
      .filter((line) => !line.startsWith("\\"))
      .join("\n");
    const client = new Client({ connectionString: pg.connectionString });
    await client.connect();
    try {
      await client.query(readFileSync(SCHEMA_PATH, "utf8"));
      await client.query(data);
    } finally {
      await client.end();
    }
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
            to_regclass('public.queuert_job_old') AS job_old,
            to_regclass('public.queuert_job_blocker_old') AS job_blocker_old`,
  );
  return Object.fromEntries(Object.entries(row).map(([name, value]) => [name, value !== null]));
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
    "drops the renamed-aside tables, the legacy enum, and the superseded migration records",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await adapter.migrateToLatest();

      expect(await relations(provider)).toEqual({
        job: true,
        job_blocker: true,
        job_old: false,
        job_blocker_old: false,
      });
      const after = await counts(provider);
      expect(after.job_status_enum).toBe(0);
      expect(after.migration_rows).toBe(ALL.length);
      expect(await indexNames(provider)).not.toContain("queuert_job_old_chain_index_idx");
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
    "renames the live tables aside, installs, imports, then drops them",
    { timeout: 120_000 },
    async ({ loaded: { provider } }) => {
      await partialMigratorFor(provider, "rename").migrateToLatest();
      expect(await relations(provider)).toEqual({
        job: false,
        job_blocker: false,
        job_old: true,
        job_blocker_old: true,
      });
      const prepared = await indexNames(provider);
      expect(prepared).toContain("queuert_job_old_pkey");
      expect(prepared).toContain("queuert_job_blocker_old_pkey");
      expect(prepared).toContain("queuert_job_old_chain_index_idx");
      expect(prepared).not.toContain("queuert_chain_index_idx");
      expect(prepared).not.toContain("queuert_job_deduplication_idx");

      await partialMigratorFor(provider, "rename+install").migrateToLatest();
      expect((await counts(provider)).jobs).toBe(0);
      expect(await indexNames(provider)).toContain("queuert_job_pending_idx");

      await migratorFor(provider).migrateToLatest();
      const imported = await counts(provider);
      expect({ jobs: imported.jobs, blockers: imported.blockers }).toEqual({
        jobs: readManifest().totalJobs,
        blockers: readManifest().totalBlockers,
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
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await query(
        provider,
        "DELETE FROM queuert_migration WHERE name = '20260617000000_blocker_composite_pk'",
      );

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
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await query(provider, "ALTER TABLE queuert_job DROP COLUMN chain_type_name");

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
    { timeout: 120_000 },
    async ({ loaded: { provider } }) => {
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
    "resumes a partial import from the last whole chain",
    { timeout: 120_000 },
    async ({ loaded: { provider, adapter } }) => {
      await expect(
        migratorFor(
          failingProvider(provider, "INSERT INTO public.queuert_job (", 3),
        ).migrateToLatest(),
      ).rejects.toThrow(/simulated crash/);

      const manifest = readManifest();
      const partial = await counts(provider);
      expect(partial.jobs).toBeGreaterThan(0);
      expect(partial.jobs).toBeLessThan(manifest.totalJobs);
      expect((await relations(provider)).job_old).toBe(true);
      const [split] = await query<{ c: number }>(
        provider,
        `SELECT count(*)::int AS c FROM
           (SELECT chain_id, count(*) AS n FROM queuert_job GROUP BY chain_id) j
           JOIN (SELECT chain_id, count(*) AS n FROM queuert_job_old GROUP BY chain_id) b
             ON j.chain_id = b.chain_id
         WHERE j.n <> b.n`,
      );
      expect(split?.c).toBe(0);

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
    { timeout: 120_000 },
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

        const adapter = await createPgStateAdapter({
          stateProvider: createPostgresJsProvider({ sql }),
          idType: "text",
          generateId: (): string => `job.${randomUUID()}`,
        });
        expect((await adapter.migrateToLatest()).applied).toEqual(ALL);

        const [head] = await adapter.getJobs({ jobIds: ["job.a0"] });
        expect(head?.continuedToId).toBe("job.a1");
        const [blocked] = await adapter.getJobs({ jobIds: ["job.a1"] });
        expect(blocked?.status).toBe("blocked");
        expect(blocked?.continuedToId).toBeNull();
        expect(blocked?.chain.completedAt).toBeNull();
        const [running] = await adapter.getJobs({ jobIds: ["job.b0"] });
        expect(running?.attemptAt).not.toBeNull();
        expect(running?.chain.completedAt).toBeNull();
        const [blocker] = await adapter.getJobBlockers({ jobId: "job.a1" });
        expect(blocker.id).toBe("job.b0");

        const [relation] = await sql.unsafe(
          `SELECT to_regclass('public.queuert_job_old') AS job_old`,
        );
        expect(relation.job_old).toBeNull();
      } finally {
        await sql.end();
        await pg[Symbol.asyncDispose]();
      }
    },
  );
});
