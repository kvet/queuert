// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { randomUUID } from "node:crypto";

import { sleep } from "@queuert/helpers/sleep";
import { acquireMysql } from "@queuert/testcontainers";
import { createPool } from "mysql2/promise";
import { afterAll, it as baseIt, describe, expect, onTestFinished } from "vitest";

import { createMysqlMigrator } from "../migration-store/migration-store.mysql.ts";
import { createMysqlStateAdapter } from "../state-adapter/state-adapter.mysql.ts";
import {
  type Mysql2PoolContext,
  createMysql2PoolProvider,
} from "../state-provider/state-provider.mysql2-pool.ts";

const defineMysqlHazardsSuite = async ({
  image,
  dialect,
  callerId,
}: {
  image: string;
  dialect: "mysql" | "mariadb";
  callerId: string;
}): Promise<void> => {
  const hostTimeZone = process.env.TZ;
  process.env.TZ = "Asia/Kolkata";
  afterAll(() => {
    process.env.TZ = hostTimeZone;
  });

  const { connectionOptions } = await acquireMysql(image, callerId);

  const it = baseIt.extend("adapter", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = createPool({ ...connectionOptions, connectionLimit: 5 });
    pool.on("connection", (connection) => {
      void connection.query("SET time_zone = '+05:00'");
    });
    onCleanup(async () => pool.end());
    const adapter = createMysqlStateAdapter<Mysql2PoolContext, string, string>({
      stateProvider: createMysql2PoolProvider({ pool }),
      dialect,
    });
    await adapter.migrateToLatest();
    return adapter;
  });

  const levelIt = baseIt.extend("adapters", { scope: "file" }, async ({}, { onCleanup }) => {
    const adapters = new Map<
      string,
      ReturnType<typeof createMysqlStateAdapter<Mysql2PoolContext, string, string>>
    >();
    const pools: ReturnType<typeof createPool>[] = [];
    onCleanup(async () => {
      await Promise.all(pools.map(async (pool) => pool.end()));
    });
    for (const level of ["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"]) {
      const pool = createPool({ ...connectionOptions, connectionLimit: 5 });
      pool.on("connection", (connection) => {
        void connection.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${level}`);
      });
      pools.push(pool);
      const adapter = createMysqlStateAdapter<Mysql2PoolContext, string, string>({
        stateProvider: createMysql2PoolProvider({ pool }),
        dialect,
      });
      await adapter.migrateToLatest();
      adapters.set(level, adapter);
    }
    return adapters;
  });

  const levelPairs = ["REPEATABLE READ", "SERIALIZABLE"].flatMap((first) =>
    ["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"].map((second) => [first, second]),
  );

  describe(`${image} blocker races across isolation levels`, () => {
    for (const [firstLevel, secondLevel] of [
      ...levelPairs,
      ...levelPairs.map(([first, second]) => [second, first]),
    ]) {
      levelIt(
        `attach waiting on a completion (${firstLevel} completer, ${secondLevel} attacher) leaves the dependent pending`,
        async ({ adapters }) => {
          const completer = adapters.get(firstLevel)!;
          const attacher = adapters.get(secondLevel)!;
          const blockerId = randomUUID();
          const dependentId = randomUUID();
          await completer.withTransaction(async (txCtx) =>
            completer.createJobs({
              txCtx,
              jobs: [
                { typeName: "race-blocker", id: blockerId, input: null },
                { typeName: "race-dependent", id: dependentId, input: null },
              ],
            }),
          );
          const completed = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const completion = completer.withTransaction(async (txCtx) => {
            await completer.getJobs({ txCtx, jobIds: [dependentId] });
            const [job] = await completer.completeJobs({
              txCtx,
              jobs: [{ jobId: blockerId, output: null }],
            });
            if (job!.hasDependents)
              await completer.unblockJobs({ txCtx, blockedByChainId: blockerId });
            completed.resolve();
            await release.promise;
          });
          await completed.promise;
          const attach = attacher.withTransaction(async (txCtx) => {
            await attacher.getJobs({ txCtx, jobIds: [dependentId] });
            await attacher.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: dependentId, blockedByChainIds: [blockerId] }],
            });
          });
          await sleep(200);
          release.resolve();
          await Promise.all([completion, attach]);

          const [dependent] = await completer.getJobs({ jobIds: [dependentId] });
          expect(dependent!.status).toBe("pending");
        },
      );

      levelIt(
        `completion waiting on an attach (${firstLevel} attacher, ${secondLevel} completer) leaves the dependent pending`,
        async ({ adapters }) => {
          const attacher = adapters.get(firstLevel)!;
          const completer = adapters.get(secondLevel)!;
          const blockerId = randomUUID();
          const dependentId = randomUUID();
          await attacher.withTransaction(async (txCtx) =>
            attacher.createJobs({
              txCtx,
              jobs: [
                { typeName: "race-blocker", id: blockerId, input: null },
                { typeName: "race-dependent", id: dependentId, input: null },
              ],
            }),
          );
          const attached = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const attach = attacher.withTransaction(async (txCtx) => {
            await attacher.getJobs({ txCtx, jobIds: [dependentId] });
            await attacher.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: dependentId, blockedByChainIds: [blockerId] }],
            });
            attached.resolve();
            await release.promise;
          });
          await attached.promise;
          const completion = completer.withTransaction(async (txCtx) => {
            await completer.getJobs({ txCtx, jobIds: [dependentId] });
            const [job] = await completer.completeJobs({
              txCtx,
              jobs: [{ jobId: blockerId, output: null }],
            });
            if (job!.hasDependents)
              await completer.unblockJobs({ txCtx, blockedByChainId: blockerId });
          });
          await sleep(200);
          release.resolve();
          await Promise.all([attach, completion]);

          const [dependent] = await completer.getJobs({ jobIds: [dependentId] });
          expect(dependent!.status).toBe("pending");
        },
      );

      levelIt(
        `two blockers of one dependent completing concurrently (${firstLevel} first, ${secondLevel} second) leave the dependent pending`,
        async ({ adapters }) => {
          const first = adapters.get(firstLevel)!;
          const second = adapters.get(secondLevel)!;
          const blockerIds = [randomUUID(), randomUUID()];
          const dependentId = randomUUID();
          await first.withTransaction(async (txCtx) => {
            await first.createJobs({
              txCtx,
              jobs: [
                ...blockerIds.map((id) => ({ typeName: "race-blocker", id, input: null })),
                { typeName: "race-dependent", id: dependentId, input: null },
              ],
            });
            await first.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: dependentId, blockedByChainIds: blockerIds }],
            });
          });
          const completed = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const complete = async (
            adapter: typeof first,
            blockerId: string,
            hold: boolean,
          ): Promise<void> =>
            adapter.withTransaction(async (txCtx) => {
              await adapter.getJobs({ txCtx, jobIds: [dependentId] });
              const [job] = await adapter.completeJobs({
                txCtx,
                jobs: [{ jobId: blockerId, output: null }],
              });
              if (job!.hasDependents)
                await adapter.unblockJobs({ txCtx, blockedByChainId: blockerId });
              if (hold) {
                completed.resolve();
                await release.promise;
              }
            });
          const firstCompletion = complete(first, blockerIds[0], true);
          await completed.promise;
          const secondCompletion = complete(second, blockerIds[1], false);
          await sleep(200);
          release.resolve();
          await Promise.all([firstCompletion, secondCompletion]);

          const [dependent] = await first.getJobs({ jobIds: [dependentId] });
          expect(dependent!.status).toBe("pending");
        },
      );
    }
  });

  describe(`${image} retries of transaction conflicts`, () => {
    const conflict = () => Object.assign(new Error("Deadlock found"), { errno: 1213 });

    levelIt(
      "withTransaction calls fn again after a conflict and throws after the fifth try",
      async ({ adapters }) => {
        const adapter = adapters.get("READ COMMITTED")!;
        let calls = 0;
        expect(
          await adapter.withTransaction(async () => {
            calls++;
            if (calls < 3) throw conflict();
            return "done";
          }),
        ).toBe("done");
        expect(calls).toBe(3);

        calls = 0;
        await expect(
          adapter.withTransaction(async () => {
            calls++;
            throw Object.assign(new Error("Record has changed since last read"), { errno: 1020 });
          }),
        ).rejects.toMatchObject({ errno: 1020 });
        expect(calls).toBe(5);

        calls = 0;
        await expect(
          adapter.withTransaction(async () => {
            calls++;
            throw Object.assign(new Error("Lock wait timeout exceeded"), { errno: 1205 });
          }),
        ).rejects.toMatchObject({ errno: 1205 });
        expect(calls).toBe(1);
      },
    );

    it("re-executes autocommit statements after a conflict and never retries a caller's transaction", async () => {
      const pool = createPool({ ...connectionOptions, connectionLimit: 5 });
      onTestFinished(async () => pool.end());
      const provider = createMysql2PoolProvider({ pool });
      let failures = 0;
      let calls = 0;
      const adapter = createMysqlStateAdapter<Mysql2PoolContext, string, string>({
        stateProvider: {
          ...provider,
          executeSql: async (options) => {
            calls++;
            if (failures > 0) {
              failures--;
              throw conflict();
            }
            return provider.executeSql(options);
          },
        },
        dialect,
      });
      await adapter.migrateToLatest();

      failures = 2;
      calls = 0;
      expect(await adapter.getJobs({ jobIds: [randomUUID()] })).toEqual([undefined]);
      expect(calls).toBe(3);

      failures = 10;
      calls = 0;
      await expect(adapter.getJobs({ jobIds: [randomUUID()] })).rejects.toMatchObject({
        errno: 1213,
      });
      expect(calls).toBe(5);

      failures = 1;
      calls = 0;
      await expect(
        provider.withTransaction(async (txCtx) =>
          adapter.getJobs({ txCtx, jobIds: [randomUUID()] }),
        ),
      ).rejects.toMatchObject({ errno: 1213 });
      expect(calls).toBe(1);
    });
  });

  describe(`${image} isolation levels in use`, () => {
    levelIt(
      "Queuert-owned transactions and migrations run at the session default",
      async ({ adapters }) => {
        const adapter = adapters.get("SERIALIZABLE")!;
        const readLevel = async (txCtx: Mysql2PoolContext) => {
          for (let tries = 1; ; tries++) {
            const [rows] = await txCtx.connection.query(
              "SELECT trx_isolation_level AS level FROM information_schema.innodb_trx WHERE trx_mysql_thread_id = CONNECTION_ID()",
            );
            const [row] = rows as { level: string }[];
            if (row !== undefined || tries === 10) return row?.level;
            await sleep(150);
          }
        };
        expect(
          await adapter.withTransaction(async (txCtx) => {
            await adapter.getJobs({ txCtx, jobIds: [randomUUID()] });
            await txCtx.connection.query("SELECT 1 FROM queuert_job LIMIT 1 FOR UPDATE");
            return readLevel(txCtx);
          }),
        ).toBe("SERIALIZABLE");

        const pool = createPool({ ...connectionOptions, connectionLimit: 2 });
        pool.on("connection", (connection) => {
          void connection.query("SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        });
        try {
          let migrationLevel: string | undefined;
          const migrator = createMysqlMigrator<Mysql2PoolContext>({
            stateProvider: createMysql2PoolProvider({ pool }),
            migrationTableName: "level_probe_migration",
            lockTableName: "level_probe_migration_lock",
            migrations: [
              {
                name: "probe_level",
                up: async (txCtx) => {
                  await txCtx.connection.query("SELECT 1 FROM queuert_job LIMIT 1 FOR UPDATE");
                  migrationLevel = await readLevel(txCtx);
                },
                down: async () => undefined,
              },
            ],
          });
          await migrator.migrateToLatest();
          expect(migrationLevel).toBe("SERIALIZABLE");
        } finally {
          await pool.end();
        }
      },
    );
  });

  describe(`${image} correctness hazards`, () => {
    it("treats deduplication keys that differ in case, accent or trailing space as distinct", async ({
      adapter,
    }) => {
      const typeName = `dedup-${randomUUID()}`;
      const keys = ["alpha", "Alpha", "álpha", "alpha "];
      const created = [];
      for (const key of keys) {
        const [chain] = await adapter.withTransaction(async (txCtx) =>
          adapter.createJobs({
            txCtx,
            jobs: [
              { typeName, id: randomUUID(), input: null, deduplication: { key, scope: "any" } },
            ],
          }),
        );
        created.push(chain);
      }
      const [again] = await adapter.withTransaction(async (txCtx) =>
        adapter.createJobs({
          txCtx,
          jobs: [
            {
              typeName,
              id: randomUUID(),
              input: null,
              deduplication: { key: "alpha", scope: "any" },
            },
          ],
        }),
      );

      expect(
        created.map(({ deduplicationKey, deduplicated }) => ({ deduplicationKey, deduplicated })),
      ).toEqual(keys.map((key) => ({ deduplicationKey: key, deduplicated: false })));
      expect(new Set(created.map(({ id }) => id)).size).toBe(keys.length);
      expect(again.id).toBe(created[0].id);
      expect(again.deduplicated).toBe(true);
    });

    it("treats type names that differ in case, accent or trailing space as distinct", async ({
      adapter,
    }) => {
      const base = `type-${randomUUID()}`;
      const typeNames = [base, base.toUpperCase(), `${base}é`, `${base}e`, `${base} `];
      await adapter.withTransaction(async (txCtx) =>
        adapter.createJobs({
          txCtx,
          jobs: typeNames.map((typeName) => ({ typeName, id: randomUUID(), input: typeName })),
        }),
      );
      const worker = await adapter.startWorker({
        workerId: randomUUID(),
        typeNames: [base],
        concurrency: 1,
        leaseMs: 60_000,
      });

      const claimed = await adapter.startJobAttempts({
        typeNames: [base],
        workerId: worker.id,
        workerToken: worker.token,
        limit: 10,
      });

      expect(claimed.map((job) => job.typeName)).toEqual([base]);
      expect(await adapter.getJobTypeNames({})).toEqual(expect.arrayContaining(typeNames));
    });

    it("round-trips timestamps exactly under a non-UTC host and session time zone", async ({
      adapter,
    }) => {
      const scheduledAt = new Date("2031-07-15T23:30:45.123Z");
      const before = Date.now();
      const [chain] = await adapter.withTransaction(async (txCtx) =>
        adapter.createJobs({
          txCtx,
          jobs: [
            {
              typeName: `time-${randomUUID()}`,
              id: randomUUID(),
              input: null,
              schedule: { at: scheduledAt },
            },
          ],
        }),
      );
      const [read] = await adapter.getChains({ chainIds: [chain.id] });

      expect(read?.head.scheduledAt).toEqual(scheduledAt);
      expect(Math.abs(read!.createdAt.getTime() - before)).toBeLessThan(5_000);
    });

    it("round-trips JSON null, absent values and non-ASCII text in inputs and outputs", async ({
      adapter,
    }) => {
      const typeName = `json-${randomUUID()}`;
      const inputs = [
        null,
        { value: null },
        [null, 1],
        "null",
        0,
        false,
        { nested: { empty: {} } },
        { text: "Ünïcödé — 日本語 🚀" },
      ];
      const chains = await adapter.withTransaction(async (txCtx) =>
        adapter.createJobs({
          txCtx,
          jobs: inputs.map((input) => ({ typeName, id: randomUUID(), input })),
        }),
      );
      const completed = await adapter.withTransaction(async (txCtx) =>
        adapter.completeJobs({
          txCtx,
          jobs: chains.map((chain, index) => ({ jobId: chain.id, output: inputs[index] })),
        }),
      );

      expect(chains.map((chain) => chain.head.input)).toEqual(inputs);
      expect(completed.map((job) => job?.output)).toEqual(inputs);
    });
  });
};

// NOTE: hack for vitest plugin
baseIt("index");

for (const { image, dialect } of [
  { image: "mysql:8.4", dialect: "mysql" as const },
  { image: "mariadb:11.4", dialect: "mariadb" as const },
]) {
  await defineMysqlHazardsSuite({ image, dialect, callerId: `${import.meta.url}-${dialect}` });
}
