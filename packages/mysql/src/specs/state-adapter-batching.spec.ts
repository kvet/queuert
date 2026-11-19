// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { randomUUID } from "node:crypto";

import { acquireMysql } from "@queuert/testcontainers";
import { createPool } from "mysql2/promise";
import { it as baseIt, describe, expect } from "vitest";

import { createMysqlStateAdapter } from "../state-adapter/state-adapter.mysql.ts";
import {
  type Mysql2PoolContext,
  createMysql2PoolProvider,
} from "../state-provider/state-provider.mysql2-pool.ts";

const servers = [
  { image: "mysql:8.4", dialect: "mysql" as const },
  { image: "mariadb:11.4", dialect: "mariadb" as const },
];
const acquired = await Promise.all(
  servers.map(async (server) => ({
    ...server,
    ...(await acquireMysql(server.image, `${import.meta.url}-${server.dialect}`)),
  })),
);

// NOTE: hack for vitest plugin
baseIt("index");

for (const { image, dialect, connectionOptions } of acquired) {
  const it = baseIt.extend("adapter", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = createPool({ ...connectionOptions, connectionLimit: 5 });
    onCleanup(async () => pool.end());
    const stateProvider = createMysql2PoolProvider({ pool });
    let batchCount = 0;
    const stateAdapter = createMysqlStateAdapter<Mysql2PoolContext, string, string>({
      dialect,
      stateProvider: {
        ...stateProvider,
        executeStatements: async (options) => {
          batchCount++;
          return stateProvider.executeStatements(options);
        },
      },
    });
    await stateAdapter.migrateToLatest();
    const countBatches = async <T>(
      fn: () => Promise<T>,
    ): Promise<{ batches: number; result: T }> => {
      const before = batchCount;
      const result = await fn();
      return { batches: batchCount - before, result };
    };
    const createChains = async (typeNames: string[]) =>
      stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.createJobs({
          txCtx,
          jobs: typeNames.map((typeName) => ({ id: randomUUID(), typeName, input: null })),
        }),
      );
    return { stateAdapter, countBatches, createChains };
  });

  describe(`${image} statement batches per adapter method`, () => {
    it("createJobs sends one batch, two with deduplication", async ({ adapter }) => {
      const { stateAdapter, countBatches } = adapter;
      const plain = await countBatches(async () =>
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: randomUUID(), typeName: "batching-create", input: { value: 1 } }],
          }),
        ),
      );
      expect(plain.batches).toBe(1);
      expect(plain.result[0].head.input).toEqual({ value: 1 });

      const deduplicated = await countBatches(async () =>
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: randomUUID(),
                typeName: "batching-create",
                input: null,
                deduplication: { key: randomUUID(), scope: "any" },
              },
            ],
          }),
        ),
      );
      expect(deduplicated.batches).toBe(2);
    });

    it("getChains with an exclusive lock sends one batch", async ({ adapter }) => {
      const { stateAdapter, countBatches, createChains } = adapter;
      const [chain] = await createChains(["batching-get-chains"]);
      const { batches, result } = await countBatches(async () =>
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.getChains({ txCtx, chainIds: [chain.id], lock: "exclusive" }),
        ),
      );
      expect(batches).toBe(1);
      expect(result[0]?.id).toBe(chain.id);
    });

    it("startJobAttempts sends two batches, one when nothing is due", async ({ adapter }) => {
      const { stateAdapter, countBatches, createChains } = adapter;
      const typeName = `batching-start-${randomUUID()}`;
      const worker = await stateAdapter.startWorker({
        workerId: randomUUID(),
        typeNames: [typeName],
        concurrency: 1,
        leaseMs: 60_000,
      });
      const idle = await countBatches(async () =>
        stateAdapter.startJobAttempts({
          typeNames: [typeName],
          workerId: worker.id,
          workerToken: worker.token,
          limit: 1,
        }),
      );
      expect(idle.batches).toBe(1);
      expect(idle.result).toEqual([]);

      const [chain] = await createChains([typeName]);
      const started = await countBatches(async () =>
        stateAdapter.startJobAttempts({
          typeNames: [typeName],
          workerId: worker.id,
          workerToken: worker.token,
          limit: 1,
        }),
      );
      expect(started.batches).toBe(2);
      expect(started.result.map((job) => [job.id, job.status])).toEqual([
        [chain.head.id, "running"],
      ]);
    });

    it("getStartAttemptDelayMs sends one batch", async ({ adapter }) => {
      const { stateAdapter, countBatches, createChains } = adapter;
      const typeName = `batching-delay-${randomUUID()}`;
      await createChains([typeName]);
      const { batches, result } = await countBatches(async () =>
        stateAdapter.getStartAttemptDelayMs({ typeNames: [typeName] }),
      );
      expect(batches).toBe(1);
      expect(result).toBe(0);
    });

    it("completeJobs and continueJobs send one batch, rescheduleJobs two", async ({ adapter }) => {
      const { stateAdapter, countBatches, createChains } = adapter;
      const [completedChain, continuedChain, rescheduledChain] = await createChains([
        "batching-write",
        "batching-write",
        "batching-write",
      ]);

      const completed = await countBatches(async () =>
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: completedChain.head.id, output: { done: true } }],
          }),
        ),
      );
      expect(completed.batches).toBe(1);
      expect(completed.result[0]?.status).toBe("completed");
      expect(completed.result[0]?.output).toEqual({ done: true });
      expect(completed.result[0]?.chain.status).toBe("completed");

      const continuationId = randomUUID();
      const continued = await countBatches(async () =>
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: continuationId,
                typeName: "batching-write-next",
                input: null,
                continueFromId: continuedChain.head.id,
              },
            ],
          }),
        ),
      );
      expect(continued.batches).toBe(1);
      expect(continued.result[0]?.continuation.id).toBe(continuationId);

      const rescheduled = await countBatches(async () =>
        stateAdapter.rescheduleJobs({
          jobs: [{ jobId: rescheduledChain.head.id, schedule: { afterMs: 60_000 } }],
        }),
      );
      expect(rescheduled.batches).toBe(2);
      expect(rescheduled.result[0]?.status).toBe("pending");

      const notRescheduled = await countBatches(async () =>
        stateAdapter.rescheduleJobs({
          jobs: [{ jobId: completedChain.head.id, schedule: { afterMs: 60_000 } }],
        }),
      );
      expect(notRescheduled.batches).toBe(1);
      expect(notRescheduled.result).toEqual([undefined]);

      const missed = await countBatches(async () =>
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: completedChain.head.id, output: null }],
          }),
        ),
      );
      expect(missed.batches).toBe(1);
      expect(missed.result).toEqual([undefined]);
    });

    it("addJobsBlockers and unblockJobs send two batches each", async ({ adapter }) => {
      const { stateAdapter, countBatches, createChains } = adapter;
      const [blockerChain, dependentChain] = await createChains([
        "batching-blocker",
        "batching-dependent",
      ]);

      const blocked = await countBatches(async () =>
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: dependentChain.head.id, blockedByChainIds: [blockerChain.id] }],
          }),
        ),
      );
      expect(blocked.batches).toBe(2);
      expect(blocked.result[0].status).toBe("blocked");
      expect(blocked.result[0].blockers.map((blocker) => blocker?.blocking)).toEqual([true]);

      const unblocked = await countBatches(async () =>
        stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          });
          return stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id });
        }),
      );
      expect(unblocked.batches).toBe(1 + 2);
      expect(unblocked.result.map((dependent) => dependent.job.status)).toEqual(["pending"]);
    });

    it("deleteChains sends three batches, two when an outside job blocks", async ({ adapter }) => {
      const { stateAdapter, countBatches, createChains } = adapter;
      const [blockerChain, dependentChain, plainChain] = await createChains([
        "batching-delete",
        "batching-delete",
        "batching-delete",
      ]);
      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: [{ jobId: dependentChain.head.id, blockedByChainIds: [blockerChain.id] }],
        }),
      );

      const refused = await countBatches(async () =>
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.id] }),
        ),
      );
      expect(refused.batches).toBe(2);
      expect(Array.isArray(refused.result[0])).toBe(true);

      const plain = await countBatches(async () =>
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({ txCtx, chainIds: [plainChain.id] }),
        ),
      );
      expect(plain.batches).toBe(3);

      const withBlocker = await countBatches(async () =>
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({ txCtx, chainIds: [dependentChain.id] }),
        ),
      );
      expect(withBlocker.batches).toBe(4);
      const [remaining] = await stateAdapter.getChains({ chainIds: [blockerChain.id] });
      expect(remaining?.blocking).toBe(false);
    });

    it("startWorker and stopWorker send one batch, extendWorkerLease two", async ({ adapter }) => {
      const { stateAdapter, countBatches } = adapter;
      const started = await countBatches(async () =>
        stateAdapter.startWorker({
          workerId: randomUUID(),
          typeNames: ["batching-worker"],
          concurrency: 1,
          leaseMs: 60_000,
        }),
      );
      expect(started.batches).toBe(1);
      const worker = started.result;

      const extended = await countBatches(async () =>
        stateAdapter.extendWorkerLease({
          workerId: worker.id,
          workerToken: worker.token,
          leaseMs: 120_000,
        }),
      );
      expect(extended.batches).toBe(2);
      expect(extended.result!.leaseUntil.getTime()).toBeGreaterThan(worker.leaseUntil.getTime());

      const stopped = await countBatches(async () =>
        stateAdapter.stopWorker({ workerId: worker.id, workerToken: worker.token }),
      );
      expect(stopped.batches).toBe(1);
      expect(stopped.result?.id).toBe(worker.id);
      const [gone] = await stateAdapter.getWorkers({ workerIds: [worker.id] });
      expect(gone).toBeUndefined();
    });
  });
}
