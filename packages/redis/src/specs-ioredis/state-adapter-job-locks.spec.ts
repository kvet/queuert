// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
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
  const stateAdapter = createRedisStateAdapter({
    stateProvider: createIoredisStateProvider({ client }),
    keyPrefix,
  });
  await stateAdapter.migrateToLatest();
  const createJob = async () => {
    const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
      }),
    );
    return chain.head.id;
  };
  const startWorker = async () =>
    stateAdapter.startWorker({
      workerId: stateAdapter.config.generateWorkerId(),
      typeNames: ["task"],
      concurrency: 1,
      leaseMs: 60_000,
    });
  const lockExists = async (jobId: string) =>
    (await client.exists(`${keyPrefix}job-lock:${jobId}`)) === 1;
  return { stateAdapter, createJob, startWorker, lockExists };
});

describe("Redis state adapter job locks", () => {
  it("releases the lock of a pending job when the transaction commits", async ({ setup }) => {
    const { stateAdapter, createJob, lockExists } = setup;
    const jobId = await createJob();

    const heldInside = await stateAdapter.withTransaction(async (txCtx) => {
      await stateAdapter.getJobs({ txCtx, jobIds: [jobId], lock: "exclusive" });
      return lockExists(jobId);
    });

    expect(heldInside).toBe(true);
    expect(await lockExists(jobId)).toBe(false);
  });

  it("releases the lock when the transaction callback throws", async ({ setup }) => {
    const { stateAdapter, createJob, lockExists } = setup;
    const jobId = await createJob();

    await expect(
      stateAdapter.withTransaction(async (txCtx) => {
        await stateAdapter.getJobs({ txCtx, jobIds: [jobId], lock: "exclusive" });
        throw new Error("handler failed");
      }),
    ).rejects.toThrow("handler failed");

    expect(await lockExists(jobId)).toBe(false);
  });

  it("takes no lock for a running job", async ({ setup }) => {
    const { stateAdapter, createJob, startWorker, lockExists } = setup;
    const jobId = await createJob();
    const worker = await startWorker();
    await stateAdapter.startJobAttempts({
      workerId: worker.id,
      workerToken: worker.token,
      typeNames: ["task"],
      limit: 1,
    });

    const heldInside = await stateAdapter.withTransaction(async (txCtx) => {
      await stateAdapter.getJobs({ txCtx, jobIds: [jobId], lock: "exclusive" });
      return lockExists(jobId);
    });

    expect(heldInside).toBe(false);
  });

  it("skips a locked job when claiming inside a transaction", async ({ setup }) => {
    const { stateAdapter, createJob, startWorker } = setup;
    const lockedJobId = await createJob();
    const freeJobId = await createJob();
    const worker = await startWorker();

    const { promise: locked, resolve: signalLocked } = Promise.withResolvers<void>();
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const locker = stateAdapter.withTransaction(async (txCtx) => {
      await stateAdapter.getJobs({ txCtx, jobIds: [lockedJobId], lock: "exclusive" });
      signalLocked();
      await gate;
    });
    await locked;

    try {
      const acquired = await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.startJobAttempts({
          txCtx,
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["task"],
          limit: 1,
        }),
      );
      expect(acquired.map((job) => job.id)).toEqual([freeJobId]);
    } finally {
      release();
      await locker;
    }
  });
});
