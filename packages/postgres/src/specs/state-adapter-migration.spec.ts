import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import { type AcquiredPostgres, acquirePostgres } from "@queuert/testcontainers";
import {
  type ColumnContract,
  type ReconcilerRow,
  createMigrationReconciler,
  createMigrator,
  createTemplateApplier,
} from "@queuert/typed-sql";
import { Client, Pool } from "pg";
import { type SeedSentinels, seedAllStates } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

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

const GENERATING = Boolean(process.env.GENERATE_FIXTURES);

const FIXTURE_PATH = fileURLToPath(
  new URL("../../fixtures/initial-schema.data.sql.gz", import.meta.url),
);
const MANIFEST_PATH = fileURLToPath(new URL("../../fixtures/manifest.json", import.meta.url));

type Provider = PgStateProvider<PgPoolContext>;
type Manifest = {
  totalJobs: number;
  totalBlockers: number;
  byStatus: Record<string, number>;
  sentinels: SeedSentinels;
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
  createMigrator({ migrations, store: createMigrationStore(provider, applyTemplate) });

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
  table: "job" | "job_blocker",
): Promise<ReconcilerRow[]> => query(provider, `SELECT * FROM queuert_${table}`);

const jobKey = (row: ReconcilerRow): string => String(row.id);
const blockerKey = (row: ReconcilerRow): string =>
  `${String(row.job_id)}|${String(row.blocked_by_chain_id)}`;

const readManifest = (): Manifest => JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;

const dumpSchema = async (provider: Provider): Promise<string> => {
  const inTables = "'queuert_job', 'queuert_job_blocker', 'queuert_migration'";
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
  const enumLabels = await query<{ enumlabel: string }>(
    provider,
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'queuert_job_status' ORDER BY e.enumsortorder`,
  );
  return [
    ...columns.map(
      (c) =>
        `col ${c.table_name}.${c.column_name} ${c.data_type} null=${c.is_nullable} default=${c.column_default}`,
    ),
    ...indexes.map((i) => `idx ${i.indexname} ${i.indexdef}`),
    ...relopts.map((r) => `rel ${r.relname} ${[...(r.reloptions ?? [])].sort().join(",")}`),
    `enum ${enumLabels.map((e) => e.enumlabel).join(",")}`,
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
    await migratorFor(provider).migrateTo(migrations[0].name);
    // Strip psql meta-commands (`\restrict`/`\unrestrict`) — the `pg` driver runs SQL, not psql
    const dump = gunzipSync(readFileSync(FIXTURE_PATH))
      .toString("utf8")
      .split("\n")
      .filter((line) => !line.startsWith("\\"))
      .join("\n");
    const client = new Client({ connectionString: pg.connectionString });
    await client.connect();
    try {
      await client.query(dump);
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

// ---------------------------------------------------------------------------
// Per-migration schema contracts
// ---------------------------------------------------------------------------

type MigrationContract = {
  job?: ColumnContract;
  jobBlocker?: ColumnContract;
  schema?: (provider: Provider) => Promise<void>;
  sentinel?: (provider: Provider, sentinels: SeedSentinels) => Promise<void>;
};

const reloptions = async (provider: Provider, table: string): Promise<string[]> => {
  const [row] = await query(provider, "SELECT reloptions FROM pg_class WHERE relname = $1", [
    table,
  ]);
  return (row?.reloptions as string[] | null) ?? [];
};

const indexNames = async (provider: Provider, table: string): Promise<string[]> =>
  (
    await query(
      provider,
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1",
      [table],
    )
  ).map((row) => String(row.indexname));

const migrationContracts: Record<string, MigrationContract> = {
  "20240102000000_vacuum_tuning": {
    schema: async (provider) => {
      const jobOptions = await reloptions(provider, "queuert_job");
      expect(jobOptions).toContain("fillfactor=75");
      expect(jobOptions).toContain("autovacuum_vacuum_scale_factor=0.02");
      expect(jobOptions).toContain("autovacuum_vacuum_scale_factor=0.02");
      expect(jobOptions).toContain("autovacuum_vacuum_cost_delay=0");
      const blockerOptions = await reloptions(provider, "queuert_job_blocker");
      expect(blockerOptions).toContain("autovacuum_vacuum_cost_delay=0");
    },
  },

  "20260430000000_rename_chain_indexes": {
    schema: async (provider) => {
      const indexes = await indexNames(provider, "queuert_job");
      expect(indexes).toContain("queuert_chain_index_idx");
      expect(indexes).toContain("queuert_chain_listing_idx");
      expect(indexes).not.toContain("queuert_job_chain_index_idx");
    },
  },

  "20260517000000_drop_job_id_default": {
    schema: async (provider) => {
      const [row] = await query(
        provider,
        `SELECT column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'queuert_job' AND column_name = 'id'`,
      );
      expect(row?.column_default).toBeNull();
    },
  },

  "20260531000000_vacuum_threshold_pinning": {
    schema: async (provider) => {
      for (const table of ["queuert_job", "queuert_job_blocker"]) {
        const options = await reloptions(provider, table);
        expect(options).toContain("autovacuum_vacuum_threshold=5000");
        expect(options).toContain("autovacuum_vacuum_scale_factor=0");
      }
    },
  },
};

// ---------------------------------------------------------------------------
// Upgrade path
// ---------------------------------------------------------------------------

describe.skipIf(GENERATING)("migration upgrade path", () => {
  it(
    "reconciles each migration's data contract, asserts its schema effect, then is idempotent",
    { timeout: 60_000 },
    async ({ loaded: { provider } }) => {
      const { sentinels } = readManifest();

      const jobs = createMigrationReconciler("job", await readRows(provider, "job"), jobKey);
      const blockers = createMigrationReconciler(
        "job_blocker",
        await readRows(provider, "job_blocker"),
        blockerKey,
      );

      const laterMigrations = migrations.slice(1);
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

  it(
    "matches the committed manifest counts",
    { timeout: 60_000 },
    async ({ loaded: { provider } }) => {
      const manifest = readManifest();
      const jobs = await readRows(provider, "job");
      expect(jobs.length).toBe(manifest.totalJobs);
      expect((await readRows(provider, "job_blocker")).length).toBe(manifest.totalBlockers);

      const byStatus: Record<string, number> = {};
      for (const job of jobs)
        byStatus[String(job.status)] = (byStatus[String(job.status)] ?? 0) + 1;
      expect(byStatus).toEqual(manifest.byStatus);
    },
  );

  it(
    "preserves referential integrity",
    { timeout: 60_000 },
    async ({ loaded: { provider, adapter } }) => {
      await adapter.migrateToLatest();
      const ids = new Set((await readRows(provider, "job")).map((j) => String(j.id)));
      const [orphans] = await query<{ c: number }>(
        provider,
        `SELECT count(*)::int AS c FROM queuert_job j
       LEFT JOIN queuert_job p ON j.chain_id = p.id WHERE p.id IS NULL`,
      );
      expect(orphans?.c).toBe(0);
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

      const [blockerChain] = await adapter.getJobBlockers({ jobId: sentinels.blockedJobId });
      expect(blockerChain[0].chainId).toBe(sentinels.fanInBlockerId);
      const [fanIn] = await query<{ c: number }>(
        provider,
        "SELECT count(*)::int AS c FROM queuert_job_blocker WHERE blocked_by_chain_id = $1",
        [sentinels.fanInBlockerId],
      );
      expect(fanIn?.c).toBe(sentinels.fanInBlockedCount);

      const [completed] = await adapter.getJobs({ jobIds: [sentinels.completedJobId] });
      expect(completed?.status).toBe("completed");
      expect(completed?.output).toMatchObject({ ok: true });

      const [running] = await adapter.getJobs({ jobIds: [sentinels.runningJobId] });
      expect(running?.status).toBe("running");
      expect(running?.leasedUntil).not.toBeNull();

      const [retried] = await adapter.getJobs({ jobIds: [sentinels.retriedJobId] });
      expect(retried?.status).toBe("pending");
      expect(String(retried?.lastAttemptError)).toContain("transient");

      const [scheduled] = await adapter.getJobs({ jobIds: [sentinels.scheduledJobId] });
      expect(scheduled?.scheduledAt.getTime()).toBeGreaterThan(scheduled!.createdAt.getTime());

      const [blockedJob] = await adapter.getJobs({ jobIds: [sentinels.blockedJobId] });
      expect(blockedJob?.status).toBe("blocked");
    },
  );

  it("vacuum runs without error", { timeout: 60_000 }, async ({ fresh: { adapter } }) => {
    await adapter.migrateToLatest();
    await expect(adapter.vacuum()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fixture generation — run with GENERATE_FIXTURES=1
// ---------------------------------------------------------------------------

describe.runIf(GENERATING)("fixture generation", () => {
  it(
    "writes the initial-schema data dump and manifest",
    { timeout: 300_000 },
    async ({ fresh: { provider, adapter, pg } }) => {
      await migratorFor(provider).migrateTo(migrations[0].name);
      const sentinels = await seedAllStates(adapter);
      const dump = await pg.dumpData(["queuert_job", "queuert_job_blocker"]);

      const jobs = await readRows(provider, "job");
      const byStatus: Record<string, number> = {};
      for (const job of jobs)
        byStatus[String(job.status)] = (byStatus[String(job.status)] ?? 0) + 1;
      const manifest: Manifest = {
        totalJobs: jobs.length,
        totalBlockers: (await readRows(provider, "job_blocker")).length,
        byStatus,
        sentinels,
      };

      mkdirSync(fileURLToPath(new URL("../../fixtures/", import.meta.url)), { recursive: true });
      writeFileSync(FIXTURE_PATH, gzipSync(dump));
      writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
      // eslint-disable-next-line no-console
      console.log(
        `Wrote ${manifest.totalJobs} jobs / ${manifest.totalBlockers} blockers`,
        byStatus,
      );
    },
  );
});
