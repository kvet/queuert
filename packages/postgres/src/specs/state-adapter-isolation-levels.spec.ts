import { raceWithSleep } from "@queuert/helpers/sleep";
import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import type { StateAdapter } from "queuert";
import { it as baseIt, describe, expect } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import { createPgPoolProvider } from "../state-provider/state-provider.pg-pool.ts";

const pg = await acquirePostgres("postgres:14", import.meta.url);

// oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
const it = baseIt.extend("stateAdapters", { scope: "file" }, async ({}, { onCleanup }) => {
  const pools = ["read\\ committed", "repeatable\\ read", "serializable"].map(
    (defaultTransactionIsolation) =>
      new Pool({
        connectionString: pg.connectionString,
        idleTimeoutMillis: 0,
        max: 5,
        options: `-c default_transaction_isolation=${defaultTransactionIsolation}`,
      }),
  );
  onCleanup(async () => {
    await Promise.all(pools.map(async (pool) => pool.end()));
  });
  const [readCommitted, repeatableRead, serializable] = pools.map((pool) =>
    createPgStateAdapter({ stateProvider: createPgPoolProvider({ pool }) }),
  );
  const stateAdapters: Record<
    "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE",
    StateAdapter<any, any, any, "async">
  > = {
    "READ COMMITTED": readCommitted,
    "REPEATABLE READ": repeatableRead,
    SERIALIZABLE: serializable,
  };
  await readCommitted.migrateToLatest();
  return stateAdapters;
});

describe.each([
  ["READ COMMITTED", "REPEATABLE READ"],
  ["READ COMMITTED", "SERIALIZABLE"],
  ["SERIALIZABLE", "REPEATABLE READ"],
] as const)("holder at %s, waiter at %s", (holderLevel, waiterLevel) => {
  it("a completion waiting on an attach to an already blocking chain unblocks the attached dependent", async ({
    stateAdapters,
  }) => {
    const holder = stateAdapters[holderLevel];
    const waiter = stateAdapters[waiterLevel];
    const [blockerChain, firstChain, secondChain] = await holder.withTransaction(async (txCtx) =>
      holder.createJobs({
        txCtx,
        jobs: ["blocker", "first-dependent", "second-dependent"].map((typeName) => ({
          id: holder.config.generateJobId(),
          typeName,
          input: null,
        })),
      }),
    );
    await holder.withTransaction(async (txCtx) =>
      holder.addJobsBlockers({
        txCtx,
        jobBlockers: [{ jobId: firstChain.head.id, blockedByChainIds: [blockerChain.id] }],
      }),
    );

    const attached = Promise.withResolvers<void>();
    const attacherGate = Promise.withResolvers<void>();
    const attach = holder.withTransaction(async (txCtx) => {
      await holder.addJobsBlockers({
        txCtx,
        jobBlockers: [{ jobId: secondChain.head.id, blockedByChainIds: [blockerChain.id] }],
      });
      attached.resolve();
      await attacherGate.promise;
    });
    await attached.promise;

    const completion = waiter.withTransaction(async (txCtx) => {
      await waiter.getJobs({ txCtx, jobIds: [firstChain.head.id] });
      const [completed] = await waiter.completeJobs({
        txCtx,
        jobs: [{ jobId: blockerChain.head.id, output: null }],
      });
      if (completed!.chain.blocking) {
        await waiter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id });
      }
    });
    expect(
      await raceWithSleep(
        completion.then(() => "settled"),
        100,
      ),
    ).toBeUndefined();

    attacherGate.resolve();
    await attach;
    await completion;

    const dependents = await holder.getJobs({
      jobIds: [firstChain.head.id, secondChain.head.id],
    });
    expect(dependents.map((job) => job?.status)).toEqual(["pending", "pending"]);
  });

  it("a reclaim waiting on an acquisition by the reclaimed worker reschedules the acquired job", async ({
    stateAdapters,
  }) => {
    const holder = stateAdapters[holderLevel];
    const waiter = stateAdapters[waiterLevel];
    const typeName = `reclaimed-${holderLevel}-${waiterLevel}`;
    const worker = await holder.startWorker({
      workerId: holder.config.generateWorkerId(),
      typeNames: [typeName],
      concurrency: 1,
      leaseMs: 60_000,
    });
    const [chain] = await holder.withTransaction(async (txCtx) =>
      holder.createJobs({
        txCtx,
        jobs: [{ id: holder.config.generateJobId(), typeName, input: null }],
      }),
    );

    const acquired = Promise.withResolvers<void>();
    const acquirerGate = Promise.withResolvers<void>();
    const acquisition = holder.withTransaction(async (txCtx) => {
      const jobs = await holder.startJobAttempts({
        txCtx,
        workerId: worker.id,
        workerToken: worker.token,
        typeNames: [typeName],
        limit: 1,
      });
      acquired.resolve();
      await acquirerGate.promise;
      return jobs;
    });
    await acquired.promise;

    const reclaim = waiter.withTransaction(async (txCtx) => {
      await waiter.getJobs({ txCtx, jobIds: [chain.head.id] });
      await waiter.getWorkers({ txCtx, workerIds: [worker.id], lock: "exclusive" });
      await waiter.stopWorker({ txCtx, workerId: worker.id, workerToken: worker.token });
      const { items: runningJobs } = await waiter.listWorkerJobs({
        txCtx,
        workerId: worker.id,
        orderDirection: "asc",
        page: { limit: 10 },
      });
      return waiter.rescheduleJobs({
        txCtx,
        jobs: runningJobs.map((job) => ({
          jobId: job.id,
          schedule: { afterMs: 0 },
          attemptToken: job.attemptToken!,
          error: "reclaimed",
        })),
      });
    });
    expect(
      await raceWithSleep(
        reclaim.then(() => "settled"),
        100,
      ),
    ).toBeUndefined();

    acquirerGate.resolve();
    expect((await acquisition).map((job) => job.id)).toEqual([chain.head.id]);
    expect((await reclaim).map((job) => job?.id)).toEqual([chain.head.id]);

    const [stored] = await holder.getJobs({ jobIds: [chain.head.id] });
    expect(stored!.status).toBe("pending");
    expect(stored!.attemptBy).toBeNull();
  });
});
