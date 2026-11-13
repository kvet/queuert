// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import { SchemaFencedError } from "queuert";
import { it as baseIt, describe, expect } from "vitest";

import { createRedisStateAdapter } from "../state-adapter/state-adapter.redis.ts";
import { createIoredisStateProvider } from "./state-provider.ioredis.ts";

const redis = await acquireRedis("redis:6");

const it = baseIt.extend("setup", async ({}, { onCleanup }) => {
  const client = new Redis(redis.connectionUrl);
  onCleanup(async () => {
    await client.quit();
  });
  const keyPrefix = `{queuert-${crypto.randomUUID()}}:`;
  const createStateAdapter = () =>
    createRedisStateAdapter({ stateProvider: createIoredisStateProvider({ client }), keyPrefix });
  return { client, keyPrefix, createStateAdapter };
});

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
    expect((error as SchemaFencedError).codeVersion).toBe(1);
    expect((error as Error).message).toContain("migrateToLatest()");
    expect(await stateAdapter.getJobs({ jobIds: [jobId] })).toEqual([undefined]);
  });

  it("applies the schema migrations once and skips them on the next run", async ({ setup }) => {
    await using stateAdapter = setup.createStateAdapter();

    const first = await stateAdapter.migrateToLatest();
    const second = await stateAdapter.migrateToLatest();

    expect(first.applied).toEqual(["001_schema_fence_v1"]);
    expect(second).toEqual({
      skipped: ["001_schema_fence_v1"],
      applied: [],
      reverted: [],
      unrecognized: [],
    });
    expect(await setup.client.smembers(`${setup.keyPrefix}migrations`)).toEqual([
      "001_schema_fence_v1",
    ]);
    expect(await setup.client.exists(`${setup.keyPrefix}migration-lock`)).toBe(0);
  });

  it("applies each migration once when processes migrate at the same time", async ({ setup }) => {
    const adapters = Array.from({ length: 4 }, () => setup.createStateAdapter());

    const results = await Promise.all(adapters.map(async (adapter) => adapter.migrateToLatest()));
    await Promise.all(adapters.map(async (adapter) => adapter.close()));

    expect(results.flatMap((result) => result.applied)).toEqual(["001_schema_fence_v1"]);
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
        await setup.client.srem(`${setup.keyPrefix}schema-fences`, "1");
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
        await setup.client.srem(`${setup.keyPrefix}schema-fences`, "1");
        await stateAdapter.completeJobs({ txCtx, jobs: [{ jobId: chain.head.id, output: null }] });
      }),
    ).rejects.toThrow(SchemaFencedError);

    expect(await setup.client.exists(`${setup.keyPrefix}job-lock:${chain.head.id}`)).toBe(0);
  });
});
