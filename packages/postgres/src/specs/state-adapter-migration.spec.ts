import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import { type AcquiredPostgres, acquirePostgres } from "@queuert/testcontainers";
import {
  type ColumnContract,
  type Migration,
  type ReconcilerRow,
  createMigrationReconciler,
  createMigrator,
  createTemplateApplier,
  sql,
} from "@queuert/typed-sql";
import { Client, Pool } from "pg";
import { type SeedSentinelsV1, seedAllStatesV1 } from "queuert/testing";
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
  migration: string;
  totalJobs: number;
  totalBlockers: number;
  byStatus: Record<string, number>;
  sentinels: SeedSentinelsV1;
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
    const { migration } = readManifest();
    await migratorFor(provider).migrateTo(migration);
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
  sentinel?: (provider: Provider, sentinels: SeedSentinelsV1) => Promise<void>;
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

const pgBool = (v: unknown): boolean => v === true || v === "t" || v === 1;

const statusOf = (row: Record<string, unknown>): string => {
  // oxlint-disable-next-line typescript/no-base-to-string
  if ("status" in row && row.status != null) return String(row.status);
  if (row.completed_at != null) return "completed";
  if (row.attempt_at != null) return "running";
  if (pgBool(row.blocked)) return "blocked";
  return "pending";
};

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

  "20260617000000_blocker_composite_pk": {
    schema: async (provider) => {
      const rows = await query(
        provider,
        `SELECT a.attname
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = 'queuert_job_blocker'::regclass AND i.indisprimary
         ORDER BY array_position(i.indkey, a.attnum)`,
      );
      expect(rows.map((r) => r.attname)).toEqual(["job_id", "blocked_by_chain_id", "index"]);
    },
  },

  "20260622000000_job_model_v2_columns": {
    job: {
      add: [
        { column: "continued_to_id", derive: () => true },
        { column: "leased_at", derive: () => true },
        { column: "blocked", derive: () => true },
      ],
    },
    schema: async (provider) => {
      const columns = (
        await query<{ column_name: string }>(
          provider,
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'queuert_job'`,
        )
      ).map((c) => c.column_name);
      expect(columns).toContain("continued_to_id");
      expect(columns).toContain("leased_at");
      expect(columns).toContain("blocked");
    },
  },

  "20260622000001_job_model_v2_backfill": {
    job: {
      inPlace: [
        {
          column: "continued_to_id",
          predicate: (after, beforeRow, snapshot) => {
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
          column: "leased_at",
          predicate: (after, beforeRow) => {
            if (String(beforeRow.status) === "running")
              return after !== null && after !== undefined;
            return after === null || after === undefined;
          },
        },
        {
          column: "leased_by",
          predicate: (after, beforeRow) => {
            if (String(beforeRow.status) === "running")
              return after !== null && after !== undefined;
            return after === beforeRow.leased_by;
          },
        },
        {
          column: "blocked",
          predicate: (after, beforeRow) => {
            if (String(beforeRow.status) === "blocked") return pgBool(after);
            return !pgBool(after);
          },
        },
        {
          column: "status",
          predicate: (after, beforeRow) => {
            if (String(beforeRow.status) === "blocked") return String(after) === "pending";
            return after === beforeRow.status;
          },
        },
      ],
    },
    sentinel: async (provider, sentinels) => {
      const [running] = await query(
        provider,
        "SELECT leased_at, leased_by, leased_until FROM queuert_job WHERE id = $1",
        [sentinels.runningJobId],
      );
      expect(running?.leased_at).not.toBeNull();
      expect(running?.leased_by).not.toBeNull();
      expect(running?.leased_until).not.toBeNull();

      const [blocked] = await query(provider, "SELECT blocked FROM queuert_job WHERE id = $1", [
        sentinels.blockedJobId,
      ]);
      expect(pgBool(blocked?.blocked)).toBe(true);

      const [pending] = await query(provider, "SELECT blocked FROM queuert_job WHERE id = $1", [
        sentinels.pendingJobId,
      ]);
      expect(pgBool(pending?.blocked)).toBe(false);

      const chainJobs = await query<{
        id: string;
        chain_index: number;
        continued_to_id: string | null;
      }>(
        provider,
        "SELECT id, chain_index, continued_to_id FROM queuert_job WHERE chain_id = $1 ORDER BY chain_index",
        [sentinels.chainId],
      );
      expect(chainJobs.length).toBe(sentinels.chainLength);
      for (let i = 0; i < chainJobs.length - 1; i++) {
        expect(chainJobs[i].continued_to_id).toBe(chainJobs[i + 1].id);
      }
      expect(chainJobs[chainJobs.length - 1].continued_to_id).toBeNull();
    },
  },

  "20260622000002_job_model_v2_finalize": {
    job: {
      rename: [
        { from: "leased_at", to: "attempt_at" },
        { from: "leased_by", to: "attempt_by" },
        { from: "leased_until", to: "attempt_until" },
      ],
      drop: ["status"],
    },
    schema: async (provider) => {
      const columns = (
        await query<{ column_name: string }>(
          provider,
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'queuert_job'`,
        )
      ).map((c) => c.column_name);
      expect(columns).toContain("continued_to_id");
      expect(columns).toContain("attempt_at");
      expect(columns).toContain("attempt_by");
      expect(columns).toContain("attempt_until");
      expect(columns).toContain("blocked");
      expect(columns).not.toContain("status");
      expect(columns).not.toContain("leased_by");
      expect(columns).not.toContain("leased_until");
      expect(columns).not.toContain("leased_at");

      const enums = await query(
        provider,
        `SELECT typname FROM pg_type WHERE typname = 'queuert_job_status'`,
      );
      expect(enums).toHaveLength(0);
    },
  },

  "20260622000003_job_model_v2_indexes": {
    schema: async (provider) => {
      const indexes = await indexNames(provider, "queuert_job");
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
      expect(indexes).toContain("queuert_chain_index_idx");
      expect(indexes).toContain("queuert_chain_head_idx");
      expect(indexes).toContain("queuert_job_idx");
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

  it(
    "serializes concurrent migrateToLatest runs via the migration lease",
    { timeout: 120_000 },
    async ({ fresh: { provider } }) => {
      const store = createMigrationStore(provider, applyTemplate);
      const mkMigrator = () => createMigrator({ migrations, store, lock: { pollIntervalMs: 50 } });
      const [a, b] = await Promise.all([
        mkMigrator().migrateToLatest(),
        mkMigrator().migrateToLatest(),
      ]);

      const allNames = migrations.map((m) => m.name).sort();
      expect([...a.applied, ...b.applied].sort()).toEqual(allNames);
      const [winner, loser] = a.applied.length > 0 ? [a, b] : [b, a];
      expect(winner.applied.length).toBe(migrations.length);
      expect(loser.applied).toEqual([]);
      expect([...loser.skipped].sort()).toEqual(allNames);

      const leases = await query(provider, "SELECT * FROM queuert_migration_lock");
      expect(leases).toHaveLength(0);
    },
  );

  it(
    "drains a batched migration in bounded steps through the store",
    { timeout: 60_000 },
    async ({ fresh: { provider } }) => {
      const store = createMigrationStore(provider, applyTemplate);
      const scratch: Migration[] = [
        {
          name: "20990101000000_scratch_setup",
          type: "transactional",
          statements: [
            sql(/* sql */ `
CREATE TABLE {{schema}}.{{table_prefix}}scratch (
  id integer PRIMARY KEY,
  flag boolean NOT NULL DEFAULT false
)`),
            sql(/* sql */ `
INSERT INTO {{schema}}.{{table_prefix}}scratch (id) SELECT generate_series(1, 25)`),
          ],
        },
        {
          name: "20990101000001_scratch_backfill",
          type: "batched",
          statements: [
            sql(/* sql */ `
UPDATE {{schema}}.{{table_prefix}}scratch SET flag = true
WHERE id IN (
  SELECT id FROM {{schema}}.{{table_prefix}}scratch WHERE flag = false LIMIT 10
)`),
          ],
        },
      ];

      const result = await createMigrator({ migrations: scratch, store }).migrateToLatest();
      expect(result.applied).toEqual(scratch.map((m) => m.name));

      const [row] = await query<{ c: number }>(
        provider,
        "SELECT count(*)::int AS c FROM queuert_scratch WHERE flag",
      );
      expect(row?.c).toBe(25);
    },
  );

  it(
    "finalize backfills rows minted after the batched drain, under the exclusive lock",
    { timeout: 60_000 },
    async ({ loaded: { provider } }) => {
      const migrator = migratorFor(provider);
      await migrator.migrateTo("20260622000001_job_model_v2_backfill");

      // Simulates old-version workers writing old-shape rows behind the drain.
      const blockedId = randomUUID();
      const runningId = randomUUID();
      await provider.executeSql({
        sql: `INSERT INTO queuert_job (id, type_name, chain_id, chain_type_name, chain_index, input, status)
              VALUES ($1, 'straggler', $1, 'straggler', 0, 'null'::jsonb, 'blocked')`,
        params: [blockedId],
        paramTypes: {},
        columnTypes: {},
        readOnly: false,
      });
      await provider.executeSql({
        sql: `INSERT INTO queuert_job (id, type_name, chain_id, chain_type_name, chain_index, input, status, leased_until)
              VALUES ($1, 'straggler', $1, 'straggler', 0, 'null'::jsonb, 'running', now() + interval '1 minute')`,
        params: [runningId],
        paramTypes: {},
        columnTypes: {},
        readOnly: false,
      });

      await migrator.migrateTo("20260622000002_job_model_v2_finalize");

      const [blockedRow] = await query(
        provider,
        "SELECT blocked, attempt_at FROM queuert_job WHERE id = $1",
        [blockedId],
      );
      expect(pgBool(blockedRow.blocked)).toBe(true);
      expect(blockedRow.attempt_at).toBeNull();

      const [runningRow] = await query(
        provider,
        "SELECT attempt_at, attempt_by FROM queuert_job WHERE id = $1",
        [runningId],
      );
      expect(runningRow.attempt_at).not.toBeNull();
      expect(runningRow.attempt_by).toBe("migrated");
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
      const [orphans] = await query<{ c: number }>(
        provider,
        `SELECT count(*)::int AS c FROM queuert_job j
       LEFT JOIN queuert_job p ON j.chain_id = p.id WHERE p.id IS NULL`,
      );
      expect(orphans?.c).toBe(0);

      const [continuedOrphans] = await query<{ c: number }>(
        provider,
        `SELECT count(*)::int AS c FROM queuert_job j
       LEFT JOIN queuert_job s ON j.continued_to_id = s.id
       WHERE j.continued_to_id IS NOT NULL AND s.id IS NULL`,
      );
      expect(continuedOrphans?.c).toBe(0);

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
        "SELECT count(*)::int AS c FROM queuert_job_blocker WHERE blocked_by_chain_id = $1",
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
    "writes the seeded database dump and manifest",
    { timeout: 300_000 },
    async ({ fresh: { provider, adapter, pg } }) => {
      await adapter.migrateToLatest();
      const sentinels = await seedAllStatesV1(adapter);
      const dump = await pg.dumpData(["queuert_job", "queuert_job_blocker"]);

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

      mkdirSync(fileURLToPath(new URL("../../fixtures/", import.meta.url)), { recursive: true });
      writeFileSync(FIXTURE_PATH, gzipSync(dump));
      writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
      // eslint-disable-next-line no-console
      console.log(
        `Wrote ${manifest.totalJobs} jobs / ${manifest.totalBlockers} blockers at ${manifest.migration}`,
      );
    },
  );
});
