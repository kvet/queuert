// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { randomUUID } from "node:crypto";

import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { it as baseIt, describe, expect } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import { createPgPoolProvider } from "../state-provider/state-provider.pg-pool.ts";

const pg = await acquirePostgres("postgres:14", import.meta.url);

const it = baseIt
  .extend("pool", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    onCleanup(async () => pool.end());
    await createPgStateAdapter({ stateProvider: createPgPoolProvider({ pool }) }).migrateToLatest();
    return pool;
  })
  .extend("recorded", { scope: "test" }, async ({ pool }) => {
    const stateProvider = createPgPoolProvider({ pool });
    const batchSizes: number[] = [];
    const stateAdapter = createPgStateAdapter({
      stateProvider: {
        ...stateProvider,
        executeStatements: async (options) => {
          batchSizes.push(options.statements.length);
          return stateProvider.executeStatements(options);
        },
      },
      generateJobId: (): string => randomUUID(),
    });
    return { stateAdapter, batchSizes };
  });

baseIt("index");

describe("PostgreSQL state adapter batching", () => {
  it("unblockJobs locks and unblocks the dependents in one statement", async ({ recorded }) => {
    const { stateAdapter, batchSizes } = recorded;
    const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [
          { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
          { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
        ],
      }),
    );
    await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.addJobsBlockers({
        txCtx,
        jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] }],
      }),
    );
    await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.completeJobs({ txCtx, jobs: [{ jobId: blockerChain.head.id, output: null }] }),
    );
    batchSizes.length = 0;

    const dependents = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.head.chainId }),
    );

    expect(dependents.map((dependent) => [dependent.job.id, dependent.job.status])).toEqual([
      [mainChain.head.id, "pending"],
    ]);
    expect(batchSizes).toEqual([1]);
  });

  it("unblockJobs sends the same statement for a chain nothing references", async ({
    recorded,
  }) => {
    const { stateAdapter, batchSizes } = recorded;
    const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "lonely", input: null }],
      }),
    );
    batchSizes.length = 0;

    const dependents = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.unblockJobs({ txCtx, blockedByChainId: chain.head.chainId }),
    );

    expect(dependents).toEqual([]);
    expect(batchSizes).toEqual([1]);
  });

  it("deleteChains reads the chain heights, then locks and deletes in one batch", async ({
    recorded,
  }) => {
    const { stateAdapter, batchSizes } = recorded;
    const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "deleted", input: null }],
      }),
    );
    batchSizes.length = 0;

    const [deleted] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.deleteChains({ txCtx, chainIds: [chain.head.chainId] }),
    );

    expect(deleted).toMatchObject({ head: { id: chain.head.id } });
    expect(batchSizes).toEqual([1, 2]);
  });
});
