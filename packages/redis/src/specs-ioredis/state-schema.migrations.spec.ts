// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { acquireRedis } from "@queuert/testcontainers";
import { createMigrator } from "@queuert/typed-sql";
import { Redis } from "ioredis";
import { SchemaFencedError } from "queuert";
import { it as baseIt, describe, expect } from "vitest";

import { createRedisMigrationStore } from "../migration-store/migration-store.redis.ts";
import {
  type RedisStoreContext,
  createRedisTransaction,
} from "../state-adapter/redis-transaction.ts";
import { createRedisStateAdapter } from "../state-adapter/state-adapter.redis.ts";
import { createRedisSchemaMigrations } from "../state-adapter/state-schema.migrations.redis.ts";
import { createRedisSchema, opaqueRecordFields } from "../state-adapter/state-schema.redis.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";
import { createIoredisStateProvider } from "./state-provider.ioredis.ts";

const redis = await acquireRedis("redis:6");

const ALL = createRedisSchemaMigrations({
  schema: createRedisSchema(""),
  stateProvider: {} as RedisStateProvider,
  withTransaction: async () => {
    throw new Error("not called");
  },
}).map((migration) => migration.name);

const it = baseIt.extend("setup", async ({}, { onCleanup }) => {
  const client = new Redis(redis.connectionUrl);
  onCleanup(async () => {
    await client.quit();
  });
  const keyPrefix = `{queuert-${crypto.randomUUID()}}:`;
  const createStateAdapter = (
    stateProvider: RedisStateProvider = createIoredisStateProvider({ client }),
  ) => createRedisStateAdapter({ stateProvider, keyPrefix });
  return { client, keyPrefix, createStateAdapter };
});

const migrateThroughHistory = async (client: Redis, keyPrefix: string) => {
  const stateProvider = createIoredisStateProvider({ client });
  const schema = createRedisSchema(keyPrefix);
  const store = {
    provider: stateProvider,
    sequenceKey: schema.keys.sequence,
    setVersionsKey: schema.keys.setVersions,
    opaqueFields: opaqueRecordFields,
    commitKeyPrefix: schema.keys.commit(""),
  };
  const withTransaction = async <T>(fn: (txCtx: RedisStoreContext) => Promise<T>) => {
    const transaction = createRedisTransaction(store, undefined);
    const result = await fn({ transaction });
    expect(await transaction.commit()).toBe(true);
    return result;
  };
  return createMigrator({
    migrations: createRedisSchemaMigrations({ schema, stateProvider, withTransaction }),
    store: createRedisMigrationStore({
      stateProvider,
      withTransaction,
      migrationsKey: schema.keys.migrations,
      migrationLockKey: schema.keys.migrationLock,
    }),
  }).migrateToLatest();
};

const persistentKeyspace = async (client: Redis, keyPrefix: string) => {
  const entries = await Promise.all(
    (await client.keys(`${keyPrefix}*`)).map(async (key) => {
      if ((await client.pttl(key)) !== -1) return [];
      const type = await client.type(key);
      const content =
        type === "set"
          ? (await client.smembers(key)).toSorted()
          : type === "hash"
            ? (await client.hkeys(key)).map((field) => field.replace(keyPrefix, "")).toSorted()
            : null;
      return [{ key: key.slice(keyPrefix.length), type, content }];
    }),
  );
  return entries.flat().toSorted((a, b) => a.key.localeCompare(b.key));
};

describe("Redis state adapter migrations", () => {
  it("fences writes until migrateToLatest has run, while reads work", async ({ setup }) => {
    await using stateAdapter = setup.createStateAdapter();
    const jobId = stateAdapter.config.generateJobId();

    const error = await stateAdapter
      .withTransaction(async (txCtx) =>
        stateAdapter.createJobs({ txCtx, jobs: [{ id: jobId, typeName: "task", input: null }] }),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SchemaFencedError);
    expect((error as SchemaFencedError).codeVersion).toBe(2);
    expect((error as Error).message).toContain("migrateToLatest()");
    expect(await stateAdapter.getJobs({ jobIds: [jobId] })).toEqual([undefined]);
  });

  it("applies the schema migrations once and skips them on the next run", async ({ setup }) => {
    await using stateAdapter = setup.createStateAdapter();

    const first = await stateAdapter.migrateToLatest();
    const second = await stateAdapter.migrateToLatest();

    expect(first.applied).toEqual(ALL);
    expect(second).toEqual({
      skipped: ALL,
      applied: [],
      reverted: [],
      unrecognized: [],
    });
    expect((await setup.client.smembers(`${setup.keyPrefix}migrations`)).toSorted()).toEqual(ALL);
    expect(await setup.client.smembers(`${setup.keyPrefix}schema-fences`)).toEqual(["2"]);
    expect(await setup.client.exists(`${setup.keyPrefix}migration-lock`)).toBe(0);
  });

  it("sets up a fresh keyspace in one step with the keys the migration history leaves", async ({
    setup,
  }) => {
    await using stateAdapter = setup.createStateAdapter();
    const historyPrefix = `{queuert-${crypto.randomUUID()}}:`;

    const fresh = await stateAdapter.migrateToLatest();
    const history = await migrateThroughHistory(setup.client, historyPrefix);

    expect(fresh).toEqual({ applied: ALL, skipped: [], reverted: [], unrecognized: [] });
    expect(history).toEqual(fresh);
    expect(await persistentKeyspace(setup.client, setup.keyPrefix)).toEqual(
      await persistentKeyspace(setup.client, historyPrefix),
    );
    expect(await persistentKeyspace(setup.client, setup.keyPrefix)).toEqual([
      { key: "migrations", type: "set", content: ALL },
      { key: "schema-fences", type: "set", content: ["2"] },
      { key: "sequence", type: "string", content: null },
      {
        key: "set-versions",
        type: "hash",
        content: ["migrations", "schema-fences"],
      },
    ]);
  });

  it("applies each migration once when processes migrate at the same time", async ({ setup }) => {
    const adapters = Array.from({ length: 4 }, () => setup.createStateAdapter());

    const results = await Promise.all(adapters.map(async (adapter) => adapter.migrateToLatest()));
    await Promise.all(adapters.map(async (adapter) => adapter.close()));

    expect(results.flatMap((result) => result.applied)).toEqual(ALL);
  });

  it("writes once migrateToLatest has run", async ({ setup }) => {
    await using stateAdapter = setup.createStateAdapter();
    await stateAdapter.migrateToLatest();

    const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
      }),
    );

    expect((await stateAdapter.getJobs({ jobIds: [chain.head.id] }))[0]?.id).toBe(chain.head.id);
  });

  it("rejects at commit a transaction that wrote before its writes were fenced", async ({
    setup,
  }) => {
    await using stateAdapter = setup.createStateAdapter();
    await stateAdapter.migrateToLatest();
    const jobId = stateAdapter.config.generateJobId();

    const error = await stateAdapter
      .withTransaction(async (txCtx) => {
        await stateAdapter.createJobs({
          txCtx,
          jobs: [{ id: jobId, typeName: "task", input: null }],
        });
        await setup.client.srem(`${setup.keyPrefix}schema-fences`, "2");
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SchemaFencedError);
    expect(await stateAdapter.getJobs({ jobIds: [jobId] })).toEqual([undefined]);
  });

  it("releases job locks when a fenced commit is rejected", async ({ setup }) => {
    await using stateAdapter = setup.createStateAdapter();
    await stateAdapter.migrateToLatest();
    const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
      }),
    );

    await expect(
      stateAdapter.withTransaction(async (txCtx) => {
        await stateAdapter.getJobs({ txCtx, jobIds: [chain.head.id], lock: "exclusive" });
        await setup.client.srem(`${setup.keyPrefix}schema-fences`, "2");
        await stateAdapter.completeJobs({ txCtx, jobs: [{ jobId: chain.head.id, output: null }] });
      }),
    ).rejects.toThrow(SchemaFencedError);

    expect(await setup.client.exists(`${setup.keyPrefix}job-lock:${chain.head.id}`)).toBe(0);
  });

  it("flags the chains blocker entries reference when upgrading from 001_schema_fence_v1", async ({
    setup,
  }) => {
    const { client, keyPrefix } = setup;
    await using stateAdapter = setup.createStateAdapter();
    await stateAdapter.migrateToLatest();
    const chains = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: ["blocker", "dependent", "unreferenced"].map((typeName) => ({
          id: stateAdapter.config.generateJobId(),
          typeName,
          input: null,
        })),
      }),
    );
    const [blockerChain, dependentChain] = chains;
    const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.continueJobs({
        txCtx,
        jobs: [
          {
            id: stateAdapter.config.generateJobId(),
            typeName: "blocker",
            input: null,
            continueFromId: blockerChain.head.id,
          },
        ],
      }),
    );
    await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.addJobsBlockers({
        txCtx,
        jobBlockers: [{ jobId: dependentChain.head.id, blockedByChainIds: [blockerChain.id] }],
      }),
    );
    const listDependentChains = async () =>
      (
        await stateAdapter.listChains({
          typeName: "blocker",
          orderBy: "createdAt",
          blocking: true,
          orderDirection: "desc",
          page: { limit: 10 },
        })
      ).items.map((chain) => chain.id);
    expect(await listDependentChains()).toEqual([blockerChain.id]);

    const jobIds = [...chains.map((chain) => chain.id), continued!.continuation.id];
    for (const jobId of jobIds) {
      const { blocking, ...data } = JSON.parse(
        (await client.hget(`${keyPrefix}job:${jobId}`, "d"))!,
      );
      await client.hset(`${keyPrefix}job:${jobId}`, "d", JSON.stringify(data));
    }
    await client.del(...(await client.keys(`${keyPrefix}blocking-chains:*`)));
    await client.srem(`${keyPrefix}migrations`, "002_schema_v2");
    await client.srem(`${keyPrefix}schema-fences`, "2");
    await client.sadd(`${keyPrefix}schema-fences`, "1");
    expect(await listDependentChains()).toEqual([]);

    expect(await stateAdapter.migrateToLatest()).toEqual({
      applied: ["002_schema_v2"],
      skipped: ["001_schema_fence_v1"],
      reverted: [],
      unrecognized: [],
    });

    expect(await client.smembers(`${keyPrefix}schema-fences`)).toEqual(["2"]);
    const flags = await Promise.all(
      jobIds.map(
        async (jobId) =>
          JSON.parse((await client.hget(`${keyPrefix}job:${jobId}`, "d"))!).blocking ?? false,
      ),
    );
    expect(flags).toEqual([true, false, false, false]);
    expect(await listDependentChains()).toEqual([blockerChain.id]);
    const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.completeJobs({
        txCtx,
        jobs: [{ jobId: continued!.continuation.id, output: null }],
      }),
    );
    expect(completed!.chain.blocking).toBe(true);
  });

  it("counts one failure for a v1 job that kept an attempt error", async ({ setup }) => {
    const { client, keyPrefix } = setup;
    await using stateAdapter = setup.createStateAdapter();
    const v1Job = (id: string) => ({
      id,
      typeName: "charge-card",
      chainId: id,
      chainIndex: 0,
      chainStatus: "running",
      status: "pending",
      createdAt: 0,
      scheduledAt: 0,
      attempt: 1,
      lastAttemptAt: 0,
      seq: `0000000000${id}`,
    });
    await client.hset(`${keyPrefix}job:failed`, {
      v: "1",
      d: JSON.stringify(v1Job("failed")),
      u: JSON.stringify({ input: null, lastAttemptError: "card declined", blockers: [] }),
    });
    await client.hset(`${keyPrefix}job:waiting`, {
      v: "1",
      d: JSON.stringify(v1Job("waiting")),
      u: JSON.stringify({ input: [], blockers: [] }),
    });
    await client.zadd(`${keyPrefix}jobs:createdAt:all:charge-card`, 0, "failed", 0, "waiting");
    await client.hset(`${keyPrefix}job-type-names`, "charge-card", "2");
    await client.sadd(`${keyPrefix}schema-fences`, "1");
    await client.sadd(`${keyPrefix}migrations`, "001_schema_fence_v1");

    const result = await stateAdapter.migrateToLatest();

    expect(result.applied).toEqual(["002_schema_v2"]);
    expect(await client.smembers(`${keyPrefix}schema-fences`)).toEqual(["2"]);
    expect(await stateAdapter.getJobs({ jobIds: ["failed", "waiting"] })).toMatchObject([
      { consecutiveFailures: 1, lastAttemptError: "card declined", lastRescheduleReason: null },
      { consecutiveFailures: 0, lastAttemptError: null, lastRescheduleReason: null, input: [] },
    ]);
  });

  it("keeps a job write that lands while 002_schema_v2 rewrites consecutive failures", async ({
    setup,
  }) => {
    const { client, keyPrefix } = setup;
    const jobKey = `${keyPrefix}job:failed`;
    const jobData = (consecutiveFailures?: number) =>
      JSON.stringify({
        id: "failed",
        typeName: "charge-card",
        chainId: "failed",
        chainIndex: 0,
        chainStatus: "running",
        status: "pending",
        createdAt: 0,
        scheduledAt: 0,
        attempt: 2,
        lastAttemptAt: 0,
        seq: "0000000000failed",
        ...(consecutiveFailures === undefined ? {} : { consecutiveFailures }),
      });
    await client.hset(jobKey, {
      v: "1",
      d: jobData(),
      u: JSON.stringify({ input: null, lastAttemptError: "card declined", blockers: [] }),
    });
    await client.zadd(`${keyPrefix}jobs:createdAt:all:charge-card`, 0, "failed");
    await client.hset(`${keyPrefix}job-type-names`, "charge-card", "1");
    await client.sadd(`${keyPrefix}schema-fences`, "1");
    await client.sadd(`${keyPrefix}migrations`, "001_schema_fence_v1");
    const base = createIoredisStateProvider({ client });
    let writeBetween = true;
    await using stateAdapter = setup.createStateAdapter({
      eval: async (script, keys, args) => {
        const reply = await base.eval(script, keys, args);
        if (writeBetween && args[3] === `${keyPrefix}job:`) {
          writeBetween = false;
          await client.hset(jobKey, {
            v: String(await client.incr(`${keyPrefix}sequence`)),
            d: jobData(2),
          });
        }
        return reply;
      },
    });

    expect((await stateAdapter.migrateToLatest()).applied).toEqual(["002_schema_v2"]);

    expect(writeBetween).toBe(false);
    expect(await stateAdapter.getJobs({ jobIds: ["failed"] })).toMatchObject([
      { consecutiveFailures: 2, lastAttemptError: "card declined" },
    ]);
  });

  it("leaves the records that hold consecutiveFailures untouched when 002_schema_v2 runs again", async ({
    setup,
  }) => {
    const { client, keyPrefix } = setup;
    await using stateAdapter = setup.createStateAdapter();
    await stateAdapter.migrateToLatest();
    const chains = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: ["charge-card", "send-receipt"].map((typeName) => ({
          id: stateAdapter.config.generateJobId(),
          typeName,
          input: null,
        })),
      }),
    );
    const readVersions = async () =>
      Promise.all(chains.map(async (chain) => client.hget(`${keyPrefix}job:${chain.id}`, "v")));
    const versions = await readVersions();
    await client.srem(`${keyPrefix}migrations`, "002_schema_v2");

    expect((await stateAdapter.migrateToLatest()).applied).toEqual(["002_schema_v2"]);

    expect(await readVersions()).toEqual(versions);
  });
});
