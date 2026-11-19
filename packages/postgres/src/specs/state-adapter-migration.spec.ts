import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { sleep } from "@queuert/helpers/sleep";
import { createDeploymentSpawner, startPaused, startTogether } from "@queuert/helpers/testing";
import { acquirePostgres } from "@queuert/testcontainers";
import { type MigrationResult, createMigrator, createTemplateApplier } from "@queuert/typed-sql";
import { Pool } from "pg";
import { it as baseIt, describe, expect, vi } from "vitest";

import {
  createMigrationStore,
  createPgStateAdapter,
  createSchemaMigrations,
} from "../state-adapter/state-adapter.pg.ts";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.ts";
import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";
import { LEASE_TTL_MS, MARKER } from "./state-adapter-migration.process.ts";

const INSTALL = "001_schema_v1";
const ALL = createSchemaMigrations({} as Provider, createTemplateApplier({})).map(
  (migration) => migration.name,
);
const spawnDeployment = createDeploymentSpawner<MigrationResult>(
  join(import.meta.dirname, "state-adapter-migration.process.ts"),
  join(import.meta.dirname, "..", ".."),
);

type Provider = PgStateProvider<PgPoolContext>;
const query = async <T = Record<string, unknown>>(provider: Provider, text: string): Promise<T[]> =>
  provider.executeSql({
    sql: text,
    params: [],
    paramTypes: {},
    columnTypes: {},
    readOnly: false,
  }) as Promise<T[]>;

const applyTemplate = createTemplateApplier({
  schema: "public",
  table_prefix: "queuert_",
  job_id_type: "text",
  worker_id_type: "text",
});

const appliedNames = async (provider: Provider): Promise<string[]> =>
  (await query<{ name: string }>(provider, "SELECT name FROM queuert_migration ORDER BY name")).map(
    (row) => row.name,
  );

const lockRows = async (provider: Provider): Promise<{ locked_by: string }[]> =>
  query(provider, "SELECT locked_by FROM queuert_migration_lock");

// oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
const it = baseIt.extend("database", async ({}, { onCleanup }) => {
  const pg = await acquirePostgres("postgres:14", `pg-migration-${randomUUID()}`);
  const pool = new Pool({ connectionString: pg.connectionString });
  onCleanup(async () => {
    await pool.end();
    await pg[Symbol.asyncDispose]();
  });
  const provider = createPgPoolProvider({ pool });
  const adapter = createPgStateAdapter({
    stateProvider: provider,
    generateJobId: (): string => randomUUID(),
    generateWorkerId: (): string => randomUUID(),
  });
  return { connectionString: pg.connectionString, provider, adapter };
});

const relations = async (provider: Provider): Promise<Record<string, boolean>> => {
  const [row] = await query<Record<string, string | null>>(
    provider,
    `SELECT to_regclass('public.queuert_job') AS job,
            to_regclass('public.queuert_job_blocker') AS job_blocker,
            to_regclass('public.queuert_migration') AS migration,
            to_regclass('public.queuert_migration_lock') AS migration_lock,
            to_regclass('public.queuert_worker') AS worker,
            to_regclass('public.queuert_schema_fence_v1') AS schema_fence_v1,
            to_regclass('public.queuert_schema_fence_v2') AS schema_fence_v2`,
  );
  return Object.fromEntries(Object.entries(row).map(([name, value]) => [name, value !== null]));
};

const indexNames = async (provider: Provider): Promise<string[]> =>
  (
    await query<{ indexname: string }>(
      provider,
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname",
    )
  ).map((row) => row.indexname);

const migrateToInstall = async (provider: Provider): Promise<void> => {
  const applyTemplateUuid = createTemplateApplier({
    schema: "public",
    table_prefix: "queuert_",
    job_id_type: "uuid",
    worker_id_type: "uuid",
  });
  await createMigrator({
    migrations: createSchemaMigrations(provider, applyTemplateUuid).filter(
      (migration) => migration.name === INSTALL,
    ),
    store: createMigrationStore(provider, applyTemplateUuid),
  }).migrateToLatest();
};

const workerColumns = async (provider: Provider): Promise<string[]> =>
  (
    await query<{ column_name: string; udt_name: string; is_nullable: string }>(
      provider,
      "SELECT column_name, udt_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'queuert_worker' ORDER BY column_name",
    )
  ).map(
    (row) => `${row.column_name} ${row.udt_name}${row.is_nullable === "NO" ? " NOT NULL" : ""}`,
  );

const jobColumnNames = async (provider: Provider): Promise<string[]> =>
  (
    await query<{ column_name: string }>(
      provider,
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'queuert_job' ORDER BY column_name",
    )
  ).map((row) => row.column_name);

const jobColumnTypes = async (provider: Provider): Promise<Record<string, string>> =>
  Object.fromEntries(
    (
      await query<{ column_name: string; udt_name: string; is_nullable: string }>(
        provider,
        "SELECT column_name, udt_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'queuert_job'",
      )
    ).map((row) => [
      row.column_name,
      `${row.udt_name}${row.is_nullable === "NO" ? " NOT NULL" : ""}`,
    ]),
  );

const indexDefinition = async (provider: Provider, indexName: string): Promise<string> => {
  const [row] = await query<{ indexdef: string }>(
    provider,
    `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = '${indexName}'`,
  );
  return row.indexdef;
};

describe("migrateToLatest", () => {
  it("names its migrations NNN_name, in ascending order", () => {
    for (const name of ALL) expect(name).toMatch(/^\d{3}_[a-z][a-z0-9_]*$/);
    expect(ALL).toEqual(ALL.toSorted());
  });

  it(
    "installs the schema on an empty database",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
      expect(await adapter.migrateToLatest()).toEqual({
        applied: ALL,
        skipped: [],
        reverted: [],
        unrecognized: [],
      });
      expect(await relations(provider)).toEqual({
        job: true,
        job_blocker: true,
        migration: true,
        migration_lock: true,
        worker: true,
        schema_fence_v1: false,
        schema_fence_v2: true,
      });
      expect(await workerColumns(provider)).toEqual([
        "concurrency int4 NOT NULL",
        "id uuid NOT NULL",
        "lease_until timestamptz NOT NULL",
        "started_at timestamptz NOT NULL",
        "token uuid NOT NULL",
        "type_names _text NOT NULL",
      ]);
      expect(await jobColumnNames(provider)).not.toContain("attempt_until");
      expect(await jobColumnNames(provider)).toContain("attempt_token");
      expect(await jobColumnTypes(provider)).toMatchObject({
        consecutive_failures: "int4 NOT NULL",
        last_attempt_error: "text",
        last_reschedule_reason: "text",
      });
    },
  );

  it("creates every index", { timeout: 120_000 }, async ({ database: { provider, adapter } }) => {
    await adapter.migrateToLatest();
    expect(await indexNames(provider)).toEqual([
      "queuert_chain_blocking_idx",
      "queuert_chain_completed_idx",
      "queuert_chain_deduplication_idx",
      "queuert_chain_idx",
      "queuert_chain_index_idx",
      "queuert_chain_running_idx",
      "queuert_job_attempt_by_idx",
      "queuert_job_blocked_idx",
      "queuert_job_blocker_chain_idx",
      "queuert_job_blocker_pkey",
      "queuert_job_completed_idx",
      "queuert_job_idx",
      "queuert_job_pending_idx",
      "queuert_job_pkey",
      "queuert_job_running_idx",
      "queuert_migration_lock_pkey",
      "queuert_migration_pkey",
      "queuert_schema_fence_v2_pkey",
      "queuert_worker_idx",
      "queuert_worker_pkey",
    ]);
    expect(await indexDefinition(provider, "queuert_job_running_idx")).toBe(
      "CREATE INDEX queuert_job_running_idx ON public.queuert_job USING btree (type_name, attempt_at) WHERE (status = 'running'::text)",
    );
  });

  it("is a no-op on a second run", { timeout: 120_000 }, async ({ database: { adapter } }) => {
    await adapter.migrateToLatest();
    expect(await adapter.migrateToLatest()).toEqual({
      applied: [],
      skipped: ALL,
      reverted: [],
      unrecognized: [],
    });
  });
});

describe("upgrading from 001_schema_v1", () => {
  it(
    "flags the chains that blocker rows reference",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateToInstall(provider);
      const blockerChainId = randomUUID();
      const continuedBlockerChainId = randomUUID();
      const continuedBlockerTailId = randomUUID();
      const unreferencedChainId = randomUUID();
      const dependentId = randomUUID();
      await query(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status, continued_to_id)
         VALUES ('${blockerChainId}', 'blocker', '${blockerChainId}', 0, 'pending', 'running', NULL),
                ('${continuedBlockerChainId}', 'blocker', '${continuedBlockerChainId}', 0, 'completed', 'running', '${continuedBlockerTailId}'),
                ('${continuedBlockerTailId}', 'blocker', '${continuedBlockerChainId}', 1, 'pending', NULL, NULL),
                ('${unreferencedChainId}', 'unreferenced', '${unreferencedChainId}', 0, 'pending', 'running', NULL),
                ('${dependentId}', 'dependent', '${dependentId}', 0, 'blocked', 'running', NULL)`,
      );
      await query(
        provider,
        `INSERT INTO queuert_job_blocker (job_id, blocked_by_chain_id, "index")
         VALUES ('${dependentId}', '${blockerChainId}', 0),
                ('${dependentId}', '${continuedBlockerChainId}', 1)`,
      );

      expect(await adapter.migrateToLatest()).toEqual({
        applied: ["002_schema_v2"],
        skipped: [INSTALL],
        reverted: [],
        unrecognized: [],
      });

      const completed = await adapter.withTransaction(async (txCtx) =>
        adapter.completeJobs({
          txCtx,
          jobs: [
            { jobId: blockerChainId, output: null },
            { jobId: continuedBlockerTailId, output: null },
            { jobId: unreferencedChainId, output: null },
          ],
        }),
      );
      expect(completed.map((job) => job!.chain.blocking)).toEqual([true, true, false]);
    },
  );

  it(
    "replaces the write fence of 001_schema_v1 with its own",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateToInstall(provider);
      expect(await relations(provider)).toMatchObject({
        schema_fence_v1: true,
        schema_fence_v2: false,
      });

      await adapter.migrateToLatest();

      expect(await relations(provider)).toMatchObject({
        schema_fence_v1: false,
        schema_fence_v2: true,
      });
    },
  );

  it(
    "counts one failure for a job that kept an attempt error and none for a job without one",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateToInstall(provider);
      const failedJobId = randomUUID();
      const cleanJobId = randomUUID();
      await query(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status, attempt, last_attempt_at, last_attempt_error)
         VALUES ('${failedJobId}', 'legacy', '${failedJobId}', 0, 'pending', 'running', 3, now(), '"Error: boom"'),
                ('${cleanJobId}', 'legacy', '${cleanJobId}', 0, 'pending', 'running', 2, now(), NULL)`,
      );

      await adapter.migrateToLatest();

      const [failedJob, cleanJob] = await adapter.getJobs({ jobIds: [failedJobId, cleanJobId] });
      expect(failedJob).toMatchObject({
        attempt: 3,
        consecutiveFailures: 1,
        lastAttemptError: "Error: boom",
        lastRescheduleReason: null,
      });
      expect(cleanJob).toMatchObject({
        attempt: 2,
        consecutiveFailures: 0,
        lastAttemptError: null,
        lastRescheduleReason: null,
      });
    },
  );

  it(
    "keeps the privileges granted on the job table",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateToInstall(provider);
      const role = `queuert_reader_${randomUUID().replaceAll("-", "")}`;
      await query(provider, `CREATE ROLE ${role}`);
      await query(provider, `GRANT SELECT, UPDATE ON queuert_job TO ${role}`);

      await adapter.migrateToLatest();

      expect(
        await query(
          provider,
          `SELECT has_table_privilege('${role}', 'public.queuert_job', 'SELECT') AS can_select,
                  has_table_privilege('${role}', 'public.queuert_job', 'UPDATE') AS can_update,
                  has_table_privilege('${role}', 'public.queuert_job', 'DELETE') AS can_delete`,
        ),
      ).toEqual([{ can_select: true, can_update: true, can_delete: false }]);
    },
  );

  it(
    "runs its copy and cutover transactions at READ COMMITTED under a serializable session default",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      await migrateToInstall(provider);
      await query(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status)
         SELECT id, 'filler', id, 0, 'pending', 'running'
         FROM (SELECT gen_random_uuid() AS id FROM generate_series(1, 10)) ids`,
      );
      const pool = new Pool({
        connectionString,
        options: "-c default_transaction_isolation=serializable",
      });
      try {
        const serializableProvider = createPgPoolProvider({ pool });
        const levels: { step: string; level: unknown }[] = [];
        const serializableAdapter = createPgStateAdapter({
          stateProvider: {
            ...serializableProvider,
            executeSql: async (options) => {
              const step = options.sql.includes("WITH source AS")
                ? "copy"
                : options.sql.includes("LOCK TABLE")
                  ? "cutover"
                  : undefined;
              if (step !== undefined) {
                const [row] = await serializableProvider.executeSql({
                  txCtx: options.txCtx,
                  sql: "SELECT current_setting('transaction_isolation') AS level",
                  params: [],
                  paramTypes: {},
                  columnTypes: {},
                  readOnly: true,
                });
                levels.push({ step, level: (row as { level: unknown }).level });
              }
              return serializableProvider.executeSql(options);
            },
          },
          generateJobId: (): string => randomUUID(),
          generateWorkerId: (): string => randomUUID(),
        });

        expect(await serializableAdapter.migrateToLatest()).toMatchObject({
          applied: ["002_schema_v2"],
        });
        expect(levels.length).toBeGreaterThanOrEqual(2);
        expect(new Set(levels.map(({ level }) => level))).toEqual(new Set(["read committed"]));
        expect(new Set(levels.map(({ step }) => step))).toEqual(new Set(["copy", "cutover"]));
      } finally {
        await pool.end();
      }
    },
  );

  it(
    "keeps the writes a 0.18 process makes while it copies, and resumes after a failed copy",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateToInstall(provider);
      const flaggedBlockerId = "00000000-0000-4000-8000-000000000001";
      const deletedDependentId = "00000000-0000-4000-8000-000000000002";
      const lateBlockerId = "00000000-0000-4000-8000-000000000003";
      const updatedJobId = "00000000-0000-4000-8000-000000000004";
      const deletedJobId = "00000000-0000-4000-8000-000000000005";
      const lateDependentId = "ffffffff-ffff-4fff-bfff-ffffffffffff";
      const referencedDependentId = "00000000-0000-4000-8000-000000000006";
      const referencedHeadId = "ffffffff-ffff-4fff-bfff-fffffffffff0";
      const partialDependentId = "00000000-0000-4000-8000-000000000007";
      const completingBlockerId = "00000000-0000-4000-8000-000000000008";
      await query(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status)
         SELECT id, 'filler', id, 0, 'pending', 'running'
         FROM (SELECT gen_random_uuid() AS id FROM generate_series(1, 3000)) ids`,
      );
      await query(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status)
         VALUES ('${flaggedBlockerId}', 'blocker', '${flaggedBlockerId}', 0, 'pending', 'running'),
                ('${deletedDependentId}', 'dependent', '${deletedDependentId}', 0, 'blocked', 'running'),
                ('${lateBlockerId}', 'blocker', '${lateBlockerId}', 0, 'pending', 'running'),
                ('${updatedJobId}', 'updated', '${updatedJobId}', 0, 'pending', 'running'),
                ('${deletedJobId}', 'deleted', '${deletedJobId}', 0, 'pending', 'running'),
                ('${referencedDependentId}', 'dependent', '${referencedDependentId}', 0, 'blocked', 'running'),
                ('${referencedHeadId}', 'blocker', '${referencedHeadId}', 0, 'pending', 'running'),
                ('${partialDependentId}', 'dependent', '${partialDependentId}', 0, 'blocked', 'running'),
                ('${completingBlockerId}', 'blocker', '${completingBlockerId}', 0, 'pending', 'running')`,
      );
      await query(
        provider,
        `INSERT INTO queuert_job_blocker (job_id, blocked_by_chain_id, "index")
         VALUES ('${deletedDependentId}', '${flaggedBlockerId}', 0),
                ('${referencedDependentId}', '${referencedHeadId}', 0),
                ('${partialDependentId}', '${completingBlockerId}', 0),
                ('${partialDependentId}', '${referencedHeadId}', 1)`,
      );
      let releaseCopy!: () => void;
      const copyReleased = new Promise<void>((resolve) => {
        releaseCopy = resolve;
      });
      let reachCopy!: () => void;
      const copyReached = new Promise<void>((resolve) => {
        reachCopy = resolve;
      });
      let batches = 0;
      const interruptedAdapter = createPgStateAdapter({
        stateProvider: {
          ...provider,
          executeSql: async (options) => {
            if (options.sql.includes("WITH source AS")) {
              batches++;
              if (batches === 2) {
                reachCopy();
                await copyReleased;
              }
              if (batches === 3) throw new Error("copy interrupted");
            }
            return provider.executeSql(options);
          },
        },
        generateJobId: (): string => randomUUID(),
        generateWorkerId: (): string => randomUUID(),
      });

      const interrupted = interruptedAdapter.migrateToLatest().then(
        () => undefined,
        (error: unknown) => error,
      );
      await copyReached;
      await query(
        provider,
        `DELETE FROM queuert_job_blocker WHERE job_id = '${deletedDependentId}'`,
      );
      await query(provider, `DELETE FROM queuert_job WHERE id = '${deletedDependentId}'`);
      await query(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status)
         VALUES ('${lateDependentId}', 'dependent', '${lateDependentId}', 0, 'blocked', 'running')`,
      );
      await query(
        provider,
        `INSERT INTO queuert_job_blocker (job_id, blocked_by_chain_id, "index")
         VALUES ('${lateDependentId}', '${lateBlockerId}', 0)`,
      );
      const workerId = randomUUID();
      await query(
        provider,
        `INSERT INTO queuert_worker (id, type_names, concurrency, lease_until, token)
         VALUES ('${workerId}', ARRAY['updated', 'blocker'], 1, now() + interval '1 hour', gen_random_uuid())`,
      );
      await query(
        provider,
        `UPDATE queuert_job SET status = 'running', attempt_by = '${workerId}', last_attempt_error = '"boom"' WHERE id = '${updatedJobId}'`,
      );
      await query(provider, `DELETE FROM queuert_job WHERE id = '${deletedJobId}'`);
      await query(
        provider,
        `UPDATE queuert_job SET status = 'running', attempt_by = '${workerId}' WHERE id = '${referencedHeadId}'`,
      );
      await query(
        provider,
        `UPDATE queuert_job SET status = 'completed', chain_status = 'completed'
         WHERE id = '${completingBlockerId}'`,
      );
      releaseCopy();
      expect(await interrupted).toMatchObject({
        message: expect.stringContaining("copy interrupted"),
      });
      expect(await relations(provider)).toMatchObject({
        schema_fence_v1: true,
        schema_fence_v2: false,
      });

      expect(await adapter.migrateToLatest()).toEqual({
        applied: ["002_schema_v2"],
        skipped: [INSTALL],
        reverted: [],
        unrecognized: [],
      });

      expect(
        await query(
          provider,
          `SELECT id::text, status, blocking, blockers_remaining FROM queuert_job
           WHERE type_name <> 'filler' ORDER BY id`,
        ),
      ).toEqual([
        { id: flaggedBlockerId, status: "pending", blocking: false, blockers_remaining: 0 },
        { id: lateBlockerId, status: "pending", blocking: true, blockers_remaining: 0 },
        { id: updatedJobId, status: "running", blocking: false, blockers_remaining: 0 },
        { id: referencedDependentId, status: "blocked", blocking: false, blockers_remaining: 1 },
        { id: partialDependentId, status: "blocked", blocking: false, blockers_remaining: 1 },
        { id: completingBlockerId, status: "completed", blocking: true, blockers_remaining: 0 },
        { id: referencedHeadId, status: "running", blocking: true, blockers_remaining: 0 },
        { id: lateDependentId, status: "blocked", blocking: false, blockers_remaining: 1 },
      ]);
      expect(
        await query(
          provider,
          `SELECT count(*)::int AS count FROM queuert_job WHERE type_name = 'filler'`,
        ),
      ).toEqual([{ count: 3000 }]);
      expect(
        await query(
          provider,
          `SELECT consecutive_failures, last_attempt_error FROM queuert_job WHERE id = '${updatedJobId}'`,
        ),
      ).toEqual([{ consecutive_failures: 1, last_attempt_error: "boom" }]);
      expect(await relations(provider)).toMatchObject({
        schema_fence_v1: false,
        schema_fence_v2: true,
      });
    },
  );

  it(
    "counts the incomplete blockers of blocked jobs, and moves stuck dependents and orphaned attempts to pending",
    { timeout: 30_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateToInstall(provider);
      const runningBlockerId = randomUUID();
      const completedBlockerId = randomUUID();
      const secondRunningBlockerId = randomUUID();
      const waitingId = randomUUID();
      const duplicateId = randomUUID();
      const stuckId = randomUUID();
      const orphanedId = randomUUID();
      const attemptedId = randomUUID();
      const workerId = randomUUID();
      await query(
        provider,
        `INSERT INTO queuert_worker (id, type_names, concurrency, lease_until, token)
         VALUES ('${workerId}', ARRAY['attempted'], 1, now() + interval '1 hour', gen_random_uuid())`,
      );
      await query(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status, scheduled_at, attempt, attempt_at, attempt_by, attempt_token)
         VALUES ('${runningBlockerId}', 'blocker', '${runningBlockerId}', 0, 'pending', 'running', now(), 0, NULL, NULL, NULL),
                ('${completedBlockerId}', 'blocker', '${completedBlockerId}', 0, 'completed', 'completed', now(), 1, NULL, NULL, NULL),
                ('${secondRunningBlockerId}', 'blocker', '${secondRunningBlockerId}', 0, 'pending', 'running', now(), 0, NULL, NULL, NULL),
                ('${waitingId}', 'dependent', '${waitingId}', 0, 'blocked', 'running', now(), 0, NULL, NULL, NULL),
                ('${duplicateId}', 'dependent', '${duplicateId}', 0, 'blocked', 'running', now(), 0, NULL, NULL, NULL),
                ('${stuckId}', 'dependent', '${stuckId}', 0, 'blocked', 'running', now() - interval '1 hour', 0, NULL, NULL, NULL),
                ('${orphanedId}', 'orphaned', '${orphanedId}', 0, 'running', 'running', now(), 1, now(), '${randomUUID()}', gen_random_uuid()),
                ('${attemptedId}', 'attempted', '${attemptedId}', 0, 'running', 'running', now(), 1, now(), '${workerId}', gen_random_uuid())`,
      );
      await query(
        provider,
        `INSERT INTO queuert_job_blocker (job_id, blocked_by_chain_id, "index")
         VALUES ('${waitingId}', '${runningBlockerId}', 0),
                ('${waitingId}', '${completedBlockerId}', 1),
                ('${waitingId}', '${secondRunningBlockerId}', 2),
                ('${duplicateId}', '${runningBlockerId}', 0),
                ('${duplicateId}', '${runningBlockerId}', 1),
                ('${duplicateId}', '${completedBlockerId}', 2),
                ('${stuckId}', '${completedBlockerId}', 0),
                ('${stuckId}', '${completedBlockerId}', 1)`,
      );

      expect(await adapter.migrateToLatest()).toEqual({
        applied: ["002_schema_v2"],
        skipped: [INSTALL],
        reverted: [],
        unrecognized: [],
      });

      expect(
        await query(
          provider,
          `SELECT j.id, j.status, j.blockers_remaining, j.attempt_by IS NULL AS attempt_cleared,
             j.attempt_token IS NULL AS token_cleared, j.scheduled_at >= now() - interval '1 minute' AS scheduled_recently,
             (SELECT count(*)::integer FROM queuert_job_blocker jb
              LEFT JOIN queuert_job h ON h.id = jb.blocked_by_chain_id
              WHERE jb.job_id = j.id AND h.chain_status IS DISTINCT FROM 'completed') AS recomputed
           FROM queuert_job j
           WHERE j.id IN ('${waitingId}', '${duplicateId}', '${stuckId}', '${orphanedId}', '${attemptedId}')
           ORDER BY j.type_name, j.id`,
        ),
      ).toEqual(
        expect.arrayContaining([
          {
            id: waitingId,
            status: "blocked",
            blockers_remaining: 2,
            attempt_cleared: true,
            token_cleared: true,
            scheduled_recently: true,
            recomputed: 2,
          },
          {
            id: duplicateId,
            status: "blocked",
            blockers_remaining: 2,
            attempt_cleared: true,
            token_cleared: true,
            scheduled_recently: true,
            recomputed: 2,
          },
          {
            id: stuckId,
            status: "pending",
            blockers_remaining: 0,
            attempt_cleared: true,
            token_cleared: true,
            scheduled_recently: true,
            recomputed: 0,
          },
          {
            id: orphanedId,
            status: "pending",
            blockers_remaining: 0,
            attempt_cleared: true,
            token_cleared: true,
            scheduled_recently: true,
            recomputed: 0,
          },
          {
            id: attemptedId,
            status: "running",
            blockers_remaining: 0,
            attempt_cleared: false,
            token_cleared: false,
            scheduled_recently: true,
            recomputed: 0,
          },
        ]),
      );

      await adapter.withTransaction(async (txCtx) => {
        await adapter.completeJobs({
          txCtx,
          jobs: [{ jobId: runningBlockerId, output: null }],
        });
        return adapter.unblockJobs({ txCtx, blockedByChainId: runningBlockerId });
      });
      await adapter.withTransaction(async (txCtx) => {
        await adapter.completeJobs({
          txCtx,
          jobs: [{ jobId: secondRunningBlockerId, output: null }],
        });
        return adapter.unblockJobs({ txCtx, blockedByChainId: secondRunningBlockerId });
      });
      expect(
        await query(
          provider,
          `SELECT id, status FROM queuert_job WHERE id IN ('${waitingId}', '${duplicateId}') ORDER BY id`,
        ),
      ).toEqual([waitingId, duplicateId].toSorted().map((id) => ({ id, status: "pending" })));
    },
  );

  it(
    "finishes a run that stopped after the cutover, leaving nothing of the copy behind",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateToInstall(provider);
      await adapter.migrateToLatest();
      await query(provider, `DELETE FROM queuert_migration WHERE name = '002_schema_v2'`);

      expect(await adapter.migrateToLatest()).toEqual({
        applied: ["002_schema_v2"],
        skipped: [INSTALL],
        reverted: [],
        unrecognized: [],
      });

      expect(
        await query(
          provider,
          `SELECT to_regclass('public.queuert_job_v2') AS job_v2,
                  to_regclass('public.queuert_job_v2_dirty') AS job_v2_dirty`,
        ),
      ).toEqual([{ job_v2: null, job_v2_dirty: null }]);
      expect(
        await query(
          provider,
          `SELECT tgname AS name FROM pg_trigger WHERE tgname LIKE 'queuert_job_v2%'
           UNION ALL
           SELECT proname FROM pg_proc WHERE proname LIKE 'queuert_job_v2%'`,
        ),
      ).toEqual([]);
      expect(await relations(provider)).toMatchObject({
        schema_fence_v1: false,
        schema_fence_v2: true,
      });
    },
  );
});

describe("parallel deployments", () => {
  it(
    "applies the schema exactly once when several deployments migrate at the same time",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const results = await startTogether(
        Array.from({ length: 5 }, () => spawnDeployment(connectionString, "older")),
      );

      expect(
        results.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ).toEqual([
        { applied: [], skipped: ALL, reverted: [], unrecognized: [] },
        { applied: [], skipped: ALL, reverted: [], unrecognized: [] },
        { applied: [], skipped: ALL, reverted: [], unrecognized: [] },
        { applied: [], skipped: ALL, reverted: [], unrecognized: [] },
        { applied: ALL, skipped: [], reverted: [], unrecognized: [] },
      ]);
      expect(await appliedNames(provider)).toEqual(ALL);
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "keeps the lease past its TTL while the holder is busy, and the waiter skips the holder's work",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const holder = await startPaused(
        spawnDeployment(connectionString, "older", "before-migrating"),
      );
      const waiter = spawnDeployment(connectionString, "older");
      await waiter.waitFor("ready");
      waiter.go();

      await sleep(LEASE_TTL_MS * 2);
      expect(waiter.finished()).toBe(false);

      holder.go();
      expect(await holder.result()).toEqual({
        applied: ALL,
        skipped: [],
        reverted: [],
        unrecognized: [],
      });
      expect(await waiter.result()).toEqual({
        applied: [],
        skipped: ALL,
        reverted: [],
        unrecognized: [],
      });
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "rolls back the migration of a deployment killed mid-migration and takes over its lease once it expires",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const killed = await startPaused(
        spawnDeployment(connectionString, "older", "inside-migration"),
      );
      await killed.kill();

      expect(await appliedNames(provider)).toEqual([]);
      expect(await lockRows(provider)).toHaveLength(1);

      const startedAt = performance.now();
      expect(await startTogether([spawnDeployment(connectionString, "older")])).toEqual([
        { applied: ALL, skipped: [], reverted: [], unrecognized: [] },
      ]);
      expect(performance.now() - startedAt).toBeGreaterThan(LEASE_TTL_MS / 2);
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "aborts a deployment frozen before migrating once it resumes after another deployment migrated in its place",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const frozen = await startPaused(
        spawnDeployment(connectionString, "newer", "before-migrating"),
      );
      frozen.freeze();
      await sleep(LEASE_TTL_MS + 500);

      expect(await startTogether([spawnDeployment(connectionString, "older")])).toEqual([
        { applied: ALL, skipped: [], reverted: [], unrecognized: [] },
      ]);

      frozen.thaw();
      frozen.go();
      expect(await frozen.result()).toEqual({
        error: expect.stringMatching(/Migration lock lost/),
      });
      expect(await appliedNames(provider)).toEqual(ALL);
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "aborts a deployment frozen mid-migration once it resumes, while the deployment that took over finishes the rest",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const frozen = await startPaused(
        spawnDeployment(connectionString, "newer", "inside-migration"),
      );
      frozen.freeze();
      const [{ locked_by: frozenOwner }] = await lockRows(provider);
      await sleep(LEASE_TTL_MS + 500);

      const takingOver = spawnDeployment(connectionString, "older");
      await takingOver.waitFor("ready");
      takingOver.go();
      await vi.waitFor(
        async () => {
          expect((await lockRows(provider))[0]?.locked_by).not.toBe(frozenOwner);
        },
        { timeout: 30_000, interval: 50 },
      );
      expect(takingOver.finished()).toBe(false);

      frozen.thaw();
      frozen.go();
      expect(await frozen.result()).toEqual({
        error: expect.stringMatching(/Migration lock lost/),
      });
      expect(await takingOver.result()).toEqual({
        applied: ALL.slice(1),
        skipped: ALL.slice(0, 1),
        reverted: [],
        unrecognized: [],
      });
      expect(await appliedNames(provider)).toEqual(ALL);
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "lets an older and a newer deployment migrate side by side",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const [older, newer] = (await startTogether([
        spawnDeployment(connectionString, "older"),
        spawnDeployment(connectionString, "newer"),
      ])) as MigrationResult[];

      expect([...older.applied, ...newer.applied].toSorted()).toEqual([...ALL, MARKER]);
      expect(newer.applied).toContain(MARKER);
      expect(await startTogether([spawnDeployment(connectionString, "older")])).toEqual([
        { applied: [], skipped: ALL, reverted: [], unrecognized: [MARKER] },
      ]);
      expect(await appliedNames(provider)).toEqual([...ALL, MARKER]);
    },
  );
});

describe("migration lease", () => {
  it(
    "is fenced by its owner, so an expired lease stays extendable until another owner claims it",
    { timeout: 120_000 },
    async ({ database: { provider } }) => {
      const store = createMigrationStore(provider, applyTemplate);
      await store.initialize?.();
      const expire = async (): Promise<void> => {
        await query(
          provider,
          "UPDATE queuert_migration_lock SET locked_until = now() - interval '1 second'",
        );
      };

      expect(await store.acquireMigrationLock!("first", 60_000)).toBe(true);
      expect(await store.acquireMigrationLock!("second", 60_000)).toBe(false);
      expect(await store.acquireMigrationLock!("first", 60_000)).toBe(false);

      await expire();
      expect(await store.extendMigrationLock!("first", 60_000)).toBe(true);
      expect(await store.acquireMigrationLock!("second", 60_000)).toBe(false);

      await expire();
      expect(await store.acquireMigrationLock!("second", 60_000)).toBe(true);
      expect(await store.extendMigrationLock!("first", 60_000)).toBe(false);

      await store.releaseMigrationLock!("first");
      expect(await lockRows(provider)).toEqual([{ locked_by: "second" }]);
      await store.releaseMigrationLock!("second");
      expect(await lockRows(provider)).toEqual([]);
      expect(await store.extendMigrationLock!("second", 60_000)).toBe(false);
    },
  );
});
