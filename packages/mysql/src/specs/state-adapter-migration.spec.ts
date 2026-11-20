// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { randomUUID } from "node:crypto";

import { acquireMysql } from "@queuert/testcontainers";
import { type Pool, type RowDataPacket, createPool } from "mysql2/promise";
import { it as baseIt, describe, expect } from "vitest";

import { createMysqlStateAdapter } from "../state-adapter/state-adapter.mysql.ts";
import { createMysql2PoolAtLevel } from "../state-provider/state-provider.mysql2-pool.spec-helper.ts";
import {
  type Mysql2PoolProvider,
  createMysql2PoolProvider,
} from "../state-provider/state-provider.mysql2-pool.ts";

const ALL = ["001_schema_v1", "002_schema_v2"];
const INSTALLED = { applied: ALL, skipped: [], reverted: [], unrecognized: [] };
const UP_TO_DATE = { applied: [], skipped: ALL, reverted: [], unrecognized: [] };

const SCHEMA_STATEMENT =
  /^\s*CREATE TABLE IF NOT EXISTS queuert_(job|job_blocker|worker|schema_fence_v1)\b/;

const schemaShape = async (pool: Pool): Promise<string[]> => {
  const [tables] = await pool.query<RowDataPacket[]>(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name",
  );
  const definitions: string[] = [];
  for (const { name } of tables) {
    const [[row]] = await pool.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${name as string}\``);
    definitions.push(row["Create Table"] as string);
  }
  return definitions;
};

const killedAfterSchemaStatements = (
  stateProvider: Mysql2PoolProvider,
  count: number,
): Mysql2PoolProvider => {
  const executed: string[] = [];
  return {
    ...stateProvider,
    executeSql: async (options) => {
      if (SCHEMA_STATEMENT.test(options.sql)) {
        if (executed.length === count) throw new Error("process killed");
        executed.push(options.sql);
      }
      return stateProvider.executeSql(options);
    },
  };
};

const killedAt =
  (statement: RegExp) =>
  (stateProvider: Mysql2PoolProvider): Mysql2PoolProvider => ({
    ...stateProvider,
    executeSql: async (options) => {
      if (statement.test(options.sql)) throw new Error("process killed");
      return stateProvider.executeSql(options);
    },
  });

const killedBeforeSchemaV2 = killedAt(/information_schema\.columns/);

const defineMysqlMigrationSuite = async ({
  image,
  dialect,
  callerId,
}: {
  image: string;
  dialect: "mysql" | "mariadb";
  callerId: string;
}): Promise<void> => {
  await acquireMysql(image, callerId);

  const it = baseIt.extend("createDatabase", async ({}, { onCleanup }) => {
    const pools: Pool[] = [];
    onCleanup(async () => {
      await Promise.all(pools.map(async (pool) => pool.end()));
    });
    return async () => {
      const { connectionOptions } = await acquireMysql(image, `${callerId}-${randomUUID()}`);
      const createPoolForDatabase = (level?: "SERIALIZABLE") => {
        const pool =
          level === undefined
            ? createPool({ ...connectionOptions, connectionLimit: 5 })
            : createMysql2PoolAtLevel({ ...connectionOptions, connectionLimit: 5 }, level);
        pools.push(pool);
        return pool;
      };
      const shapePool = createPoolForDatabase();
      return {
        createAdapter: (
          wrap = (provider: Mysql2PoolProvider) => provider,
          level?: "SERIALIZABLE",
        ) =>
          createMysqlStateAdapter({
            stateProvider: wrap(createMysql2PoolProvider({ pool: createPoolForDatabase(level) })),
            dialect,
          }),
        shape: async () => schemaShape(shapePool),
        pool: shapePool,
      };
    };
  });

  describe(`${image} migrateToLatest`, () => {
    it("installs the schema once and then reports it up to date", async ({ createDatabase }) => {
      const database = await createDatabase();
      const adapter = database.createAdapter();

      expect(await adapter.migrateToLatest()).toEqual(INSTALLED);
      expect(await adapter.migrateToLatest()).toEqual(UP_TO_DATE);
    });

    it.for([0, 1, 2, 3])(
      "resumes a run killed after %i schema statements to the same schema",
      async (count, { createDatabase }) => {
        const reference = await createDatabase();
        await reference.createAdapter().migrateToLatest();
        const interrupted = await createDatabase();

        await expect(
          interrupted
            .createAdapter((provider) => killedAfterSchemaStatements(provider, count))
            .migrateToLatest(),
        ).rejects.toThrow("process killed");
        expect(await interrupted.createAdapter().migrateToLatest()).toEqual(INSTALLED);
        expect(await interrupted.shape()).toEqual(await reference.shape());
      },
    );

    it("upgrades a schema v1 database, counting a stored error as one failure", async ({
      createDatabase,
    }) => {
      const reference = await createDatabase();
      await reference.createAdapter().migrateToLatest();
      const database = await createDatabase();
      await expect(database.createAdapter(killedBeforeSchemaV2).migrateToLatest()).rejects.toThrow(
        "process killed",
      );
      const failedJobId = randomUUID();
      const pendingJobId = randomUUID();
      await database.pool.query(
        "INSERT INTO queuert_job (id, chain_id, chain_index, type_name, chain_status, scheduled_at, attempt, last_attempt_error) VALUES (?, ?, 0, 'upgrade', 'running', UTC_TIMESTAMP(6), 2, ?), (?, ?, 0, 'upgrade', 'running', UTC_TIMESTAMP(6), 0, NULL)",
        [
          failedJobId,
          failedJobId,
          JSON.stringify('Error: "boom"\n    at handler'),
          pendingJobId,
          pendingJobId,
        ],
      );
      const adapter = database.createAdapter();

      expect(await adapter.migrateToLatest()).toEqual({
        applied: ["002_schema_v2"],
        skipped: ["001_schema_v1"],
        reverted: [],
        unrecognized: [],
      });
      const [failedJob, pendingJob] = await adapter.getJobs({
        jobIds: [failedJobId, pendingJobId],
      });
      expect(failedJob).toMatchObject({
        attempt: 2,
        consecutiveFailures: 1,
        lastAttemptError: 'Error: "boom"\n    at handler',
        lastRescheduleReason: null,
      });
      expect(pendingJob).toMatchObject({
        consecutiveFailures: 0,
        lastAttemptError: null,
        lastRescheduleReason: null,
      });
      expect(await database.shape()).toEqual(await reference.shape());
    });

    it.for([
      ["drops the JSON last_attempt_error", /DROP COLUMN last_attempt_error/],
      ["renames the text column into place", /RENAME COLUMN last_attempt_error_text/],
    ] as const)(
      "resumes a schema v2 upgrade killed before it %s",
      async ([, killPoint], { createDatabase }) => {
        const reference = await createDatabase();
        await reference.createAdapter().migrateToLatest();
        const database = await createDatabase();
        await expect(
          database.createAdapter(killedBeforeSchemaV2).migrateToLatest(),
        ).rejects.toThrow("process killed");
        const failedJobId = randomUUID();
        await database.pool.query(
          "INSERT INTO queuert_job (id, chain_id, chain_index, type_name, chain_status, scheduled_at, attempt, last_attempt_error) VALUES (?, ?, 0, 'upgrade', 'running', UTC_TIMESTAMP(6), 2, ?)",
          [failedJobId, failedJobId, JSON.stringify("boom")],
        );
        await expect(database.createAdapter(killedAt(killPoint)).migrateToLatest()).rejects.toThrow(
          "process killed",
        );
        const [fences] = await database.pool.query<RowDataPacket[]>(
          "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'queuert_schema_fence_%'",
        );
        expect(fences).toEqual([]);
        const adapter = database.createAdapter();

        expect(await adapter.migrateToLatest()).toEqual({
          applied: ["002_schema_v2"],
          skipped: ["001_schema_v1"],
          reverted: [],
          unrecognized: [],
        });
        expect(await adapter.getJobs({ jobIds: [failedJobId] })).toMatchObject([
          { consecutiveFailures: 1, lastAttemptError: "boom", lastRescheduleReason: null },
        ]);
        expect(await database.shape()).toEqual(await reference.shape());
      },
    );

    it("lets one of two concurrent migrators install the schema", async ({ createDatabase }) => {
      const database = await createDatabase();

      const results = await Promise.all([
        database.createAdapter().migrateToLatest(),
        database.createAdapter().migrateToLatest(),
      ]);

      expect(results).toEqual(expect.arrayContaining([INSTALLED, UP_TO_DATE]));
    });

    it("lets one of several concurrent migrators with a serializable session default install the schema", async ({
      createDatabase,
    }) => {
      const database = await createDatabase();
      const reference = await createDatabase();
      await reference.createAdapter().migrateToLatest();

      const results = await Promise.all(
        Array.from({ length: 4 }, async () =>
          database.createAdapter(undefined, "SERIALIZABLE").migrateToLatest(),
        ),
      );

      expect(results.filter((result) => result.applied.length > 0)).toEqual([INSTALLED]);
      expect(results.filter((result) => result.applied.length === 0)).toEqual([
        UP_TO_DATE,
        UP_TO_DATE,
        UP_TO_DATE,
      ]);
      expect(await database.shape()).toEqual(await reference.shape());
    });

    it("upgrades a 001_schema_v1 database, flagging the chains that blocker rows reference and replacing its write fence", async ({
      createDatabase,
    }) => {
      const database = await createDatabase();
      await expect(database.createAdapter(killedBeforeSchemaV2).migrateToLatest()).rejects.toThrow(
        "process killed",
      );
      const adapter = database.createAdapter();
      const { pool } = database;

      const blockerChainId = randomUUID();
      const continuedBlockerChainId = randomUUID();
      const continuedBlockerTailId = randomUUID();
      const unreferencedChainId = randomUUID();
      const dependentId = randomUUID();
      await pool.query(
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status, continued_to_id, completed_at, scheduled_at)
         VALUES ('${blockerChainId}', 'blocker', '${blockerChainId}', 0, 'pending', 'running', NULL, NULL, UTC_TIMESTAMP(6)),
                ('${continuedBlockerChainId}', 'blocker', '${continuedBlockerChainId}', 0, 'completed', 'running', '${continuedBlockerTailId}', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
                ('${continuedBlockerTailId}', 'blocker', '${continuedBlockerChainId}', 1, 'pending', NULL, NULL, NULL, UTC_TIMESTAMP(6)),
                ('${unreferencedChainId}', 'unreferenced', '${unreferencedChainId}', 0, 'pending', 'running', NULL, NULL, UTC_TIMESTAMP(6)),
                ('${dependentId}', 'dependent', '${dependentId}', 0, 'blocked', 'running', NULL, NULL, UTC_TIMESTAMP(6))`,
      );
      await pool.query(
        `INSERT INTO queuert_job_blocker (job_id, blocked_by_chain_id, \`index\`)
         VALUES ('${dependentId}', '${blockerChainId}', 0),
                ('${dependentId}', '${continuedBlockerChainId}', 1)`,
      );

      expect(await adapter.migrateToLatest()).toEqual({
        applied: ["002_schema_v2"],
        skipped: ["001_schema_v1"],
        reverted: [],
        unrecognized: [],
      });
      const [fences] = await pool.query<RowDataPacket[]>(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'queuert_schema_fence_%' ORDER BY table_name",
      );
      expect(fences.map((row) => row.name)).toEqual(["queuert_schema_fence_v2"]);

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
    });

    it("upgrades a 001_schema_v1 database, counting incomplete blockers and releasing stuck dependents and orphaned attempts", async ({
      createDatabase,
    }) => {
      const database = await createDatabase();
      await expect(database.createAdapter(killedBeforeSchemaV2).migrateToLatest()).rejects.toThrow(
        "process killed",
      );
      const adapter = database.createAdapter();
      const { pool } = database;

      const runningBlockerId = randomUUID();
      const completedBlockerId = randomUUID();
      const missingBlockerId = randomUUID();
      const mixedDependentId = randomUUID();
      const duplicateDependentId = randomUUID();
      const stuckDependentId = randomUUID();
      const workerId = randomUUID();
      const ownedJobId = randomUUID();
      const orphanedJobId = randomUUID();
      await pool.query(
        `INSERT INTO queuert_worker (id, type_names, concurrency, started_at, lease_until, token)
         VALUES ('${workerId}', JSON_ARRAY('owned'), 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 1 HOUR, '${randomUUID()}')`,
      );
      await pool.query(
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status, completed_at, scheduled_at, attempt, attempt_at, attempt_by, attempt_token)
         VALUES ('${runningBlockerId}', 'blocker', '${runningBlockerId}', 0, 'pending', 'running', NULL, UTC_TIMESTAMP(6), 0, NULL, NULL, NULL),
                ('${completedBlockerId}', 'blocker', '${completedBlockerId}', 0, 'completed', 'completed', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 0, NULL, NULL, NULL),
                ('${mixedDependentId}', 'dependent', '${mixedDependentId}', 0, 'blocked', 'running', NULL, UTC_TIMESTAMP(6), 0, NULL, NULL, NULL),
                ('${duplicateDependentId}', 'dependent', '${duplicateDependentId}', 0, 'blocked', 'running', NULL, UTC_TIMESTAMP(6), 0, NULL, NULL, NULL),
                ('${stuckDependentId}', 'dependent', '${stuckDependentId}', 0, 'blocked', 'running', NULL, UTC_TIMESTAMP(6) - INTERVAL 1 HOUR, 0, NULL, NULL, NULL),
                ('${ownedJobId}', 'owned', '${ownedJobId}', 0, 'running', 'running', NULL, UTC_TIMESTAMP(6), 1, UTC_TIMESTAMP(6), '${workerId}', '${randomUUID()}'),
                ('${orphanedJobId}', 'owned', '${orphanedJobId}', 0, 'running', 'running', NULL, UTC_TIMESTAMP(6), 1, UTC_TIMESTAMP(6), '${randomUUID()}', '${randomUUID()}')`,
      );
      await pool.query(
        `INSERT INTO queuert_job_blocker (job_id, blocked_by_chain_id, \`index\`)
         VALUES ('${mixedDependentId}', '${runningBlockerId}', 0),
                ('${mixedDependentId}', '${completedBlockerId}', 1),
                ('${mixedDependentId}', '${missingBlockerId}', 2),
                ('${duplicateDependentId}', '${runningBlockerId}', 0),
                ('${duplicateDependentId}', '${runningBlockerId}', 1),
                ('${duplicateDependentId}', '${completedBlockerId}', 2),
                ('${stuckDependentId}', '${completedBlockerId}', 0)`,
      );

      await adapter.migrateToLatest();

      const [jobs] = await pool.query<RowDataPacket[]>(
        `SELECT id, status, blockers_remaining, attempt_by, attempt_token, attempt_at, scheduled_at >= UTC_TIMESTAMP(6) - INTERVAL 1 MINUTE AS rescheduled
         FROM queuert_job WHERE id IN (?)`,
        [[mixedDependentId, duplicateDependentId, stuckDependentId, ownedJobId, orphanedJobId]],
      );
      const byId = new Map(jobs.map((row) => [row.id as string, row]));
      expect(byId.get(mixedDependentId)).toMatchObject({
        status: "blocked",
        blockers_remaining: 2,
      });
      expect(byId.get(duplicateDependentId)).toMatchObject({
        status: "blocked",
        blockers_remaining: 2,
      });
      expect(byId.get(stuckDependentId)).toMatchObject({ status: "pending", rescheduled: 1 });
      expect(byId.get(ownedJobId)).toMatchObject({ status: "running", attempt_by: workerId });
      expect(byId.get(orphanedJobId)).toMatchObject({
        status: "pending",
        attempt_by: null,
        attempt_token: null,
        attempt_at: null,
      });

      await adapter.withTransaction(async (txCtx) => {
        await adapter.completeJobs({ txCtx, jobs: [{ jobId: runningBlockerId, output: null }] });
        await adapter.unblockJobs({ txCtx, blockedByChainId: runningBlockerId });
      });
      const [afterCompletion] = await pool.query<RowDataPacket[]>(
        "SELECT id, status, blockers_remaining FROM queuert_job WHERE id IN (?) ORDER BY id",
        [[mixedDependentId, duplicateDependentId]],
      );
      expect(new Map(afterCompletion.map((row) => [row.id, row]))).toEqual(
        new Map([
          [mixedDependentId, { id: mixedDependentId, status: "blocked", blockers_remaining: 1 }],
          [
            duplicateDependentId,
            { id: duplicateDependentId, status: "pending", blockers_remaining: 0 },
          ],
        ]),
      );
    });
  });
};

// NOTE: hack for vitest plugin
baseIt("index");

for (const { image, dialect } of [
  { image: "mysql:8.4", dialect: "mysql" as const },
  { image: "mariadb:11.4", dialect: "mariadb" as const },
]) {
  await defineMysqlMigrationSuite({ image, dialect, callerId: `${import.meta.url}-${dialect}` });
}
