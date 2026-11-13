// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import { it as baseIt, describe, expect } from "vitest";

import { createRedisStateAdapter } from "../state-adapter/state-adapter.redis.ts";
import { createIoredisStateProvider } from "./state-provider.ioredis.ts";

const redis = await acquireRedis("redis:6");

const it = baseIt.extend("setup", async ({}, { onCleanup }) => {
  const client = new Redis(redis.connectionUrl);
  const keyPrefix = `{queuert-${crypto.randomUUID()}}:`;
  const stateAdapter = createRedisStateAdapter({
    stateProvider: createIoredisStateProvider({ client }),
    keyPrefix,
  });
  onCleanup(async () => {
    await stateAdapter.close();
    await client.quit();
  });
  await stateAdapter.migrateToLatest();
  const createChain = async (typeName: string, deduplicationKey?: string) => {
    const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [
          {
            id: stateAdapter.config.generateJobId(),
            typeName,
            input: null,
            ...(deduplicationKey === undefined
              ? {}
              : { deduplication: { key: deduplicationKey, scope: "running" as const } }),
          },
        ],
      }),
    );
    return chain;
  };
  return { client, keyPrefix, stateAdapter, createChain };
});

describe("Redis state adapter storage", () => {
  it("versions a blocker set with the commit's version and drops it once the set is empty", async ({
    setup,
  }) => {
    const { client, keyPrefix, stateAdapter, createChain } = setup;
    const blocker = await createChain("capture-payment");
    const dependent = await createChain("ship-order");
    const setKey = `${keyPrefix}blocked-by:${blocker.head.id}`;

    await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.addJobsBlockers({
        txCtx,
        jobBlockers: [{ jobId: dependent.head.id, blockedByChainIds: [blocker.head.id] }],
      }),
    );
    const version = await client.hget(`${keyPrefix}set-versions`, setKey);
    expect(version).toBe(await client.get(`${keyPrefix}sequence`));

    await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.deleteChains({ txCtx, chainIds: [dependent.head.id] }),
    );

    expect(await client.exists(setKey)).toBe(0);
    expect(await client.hexists(`${keyPrefix}set-versions`, setKey)).toBe(0);
  });

  it("leaves null fields out of a job record and reads them back as null", async ({ setup }) => {
    const { client, keyPrefix, stateAdapter } = setup;
    const jobKey = (id: string) => `${keyPrefix}job:${id}`;
    const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [
          {
            id: stateAdapter.config.generateJobId(),
            typeName: "send-welcome-email",
            input: { to: "ada@example.com" },
          },
        ],
      }),
    );
    const jobId = chain.head.id;

    const created = await client.hgetall(jobKey(jobId));
    expect(created.d).not.toContain("null");
    expect(JSON.parse(created.u)).toEqual({ input: { to: "ada@example.com" }, blockers: [] });
    const [read] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.getJobs({ txCtx, jobIds: [jobId] }),
    );
    expect(read).toMatchObject({
      status: "pending",
      completedAt: null,
      completedBy: null,
      continuedToId: null,
      output: null,
      lastAttemptError: null,
      lastAttemptAt: null,
      attemptAt: null,
      attemptBy: null,
      attemptToken: null,
      traceContext: null,
    });

    const worker = await stateAdapter.startWorker({
      workerId: "00000000-0000-4000-8000-0000000000a1",
      typeNames: ["send-welcome-email"],
      concurrency: 1,
      leaseMs: 60_000,
    });
    const [claimed] = await stateAdapter.startJobAttempts({
      typeNames: ["send-welcome-email"],
      workerId: worker.id,
      workerToken: worker.token,
      limit: 1,
    });
    expect(claimed).toMatchObject({ id: jobId, status: "running", attemptBy: worker.id });
    expect(await client.zrange(`${keyPrefix}running:${worker.id}`, "0", "-1")).toEqual([jobId]);
    expect(
      await client.zrange(`${keyPrefix}jobs:attemptAt:running:send-welcome-email`, "0", "-1"),
    ).toEqual([jobId]);
    expect(await client.zcard(`${keyPrefix}due:send-welcome-email`)).toBe(0);
    expect((await client.hget(jobKey(jobId), "d"))!).not.toContain("null");
  });

  it("keeps only running chains and the newest one in a deduplication record", async ({
    setup,
  }) => {
    const { client, keyPrefix, stateAdapter, createChain } = setup;
    const recordKey = `${keyPrefix}deduplication:${JSON.stringify(["daily-digest", "today"])}`;
    const chainIds: string[] = [];
    for (let index = 0; index < 3; index++) {
      const chain = await createChain("daily-digest", "today");
      chainIds.push(chain.head.id);
      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.completeJobs({ txCtx, jobs: [{ jobId: chain.head.id, output: null }] }),
      );
    }
    const running = await createChain("daily-digest", "today");
    const deduplicated = await createChain("daily-digest", "today");

    expect(deduplicated).toMatchObject({ id: running.head.id, deduplicated: true });
    expect(JSON.parse((await client.hget(recordKey, "d"))!)).toEqual([running.head.id]);
  });
});
