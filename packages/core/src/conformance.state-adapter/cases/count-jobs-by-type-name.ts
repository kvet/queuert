import assert from "node:assert/strict";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const countJobsByTypeNameGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "countJobsByTypeName",
  cases: [
    {
      name: "countJobsByTypeName returns empty array for empty input",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const result = await stateAdapter.countJobsByTypeName({ typeNames: [] });
        assert.deepEqual(result, []);
      },
    },
    {
      name: "countJobsByTypeName returns zeros for unknown type names",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const result = await stateAdapter.countJobsByTypeName({ typeNames: ["nonexistent"] });
        assert.deepEqual(result, [
          {
            blocked: { count: 0, hasMore: false },
            pending: { count: 0, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
        ]);
      },
    },
    {
      name: "countJobsByTypeName counts pending jobs",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "count-a", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "count-a", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "count-b", input: null },
            ],
          }),
        );

        const result = await stateAdapter.countJobsByTypeName({
          typeNames: ["count-a", "count-b", "count-c"],
        });

        assert.deepEqual(result, [
          {
            blocked: { count: 0, hasMore: false },
            pending: { count: 2, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
          {
            blocked: { count: 0, hasMore: false },
            pending: { count: 1, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
          {
            blocked: { count: 0, hasMore: false },
            pending: { count: 0, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
        ]);
      },
    },
    {
      name: "countJobsByTypeName counts running jobs",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["count-run"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "count-run", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "count-run", input: null },
            ],
          }),
        );

        await stateAdapter.startJobAttempts({
          typeNames: ["count-run"],
          workerId: worker.id,
          workerToken: worker.token,
          limit: 1,
        });

        const result = await stateAdapter.countJobsByTypeName({ typeNames: ["count-run"] });

        assert.equal(result[0].pending.count, 1);
        assert.equal(result[0].running.count, 1);
      },
    },
    {
      name: "countJobsByTypeName counts blocked jobs apart from pending ones",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerChain, blockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "count-blocker", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "count-blocked", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "count-blocked", input: null },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: blockedChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        const result = await stateAdapter.countJobsByTypeName({ typeNames: ["count-blocked"] });

        assert.equal(result[0].blocked.count, 1);
        assert.equal(result[0].pending.count, 1);
      },
    },
    {
      name: "countJobsByTypeName counts completed jobs",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["count-done"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "count-done", input: null },
            ],
          }),
        );

        const [acquired] = await stateAdapter.startJobAttempts({
          typeNames: ["count-done"],
          workerId: worker.id,
          workerToken: worker.token,
          limit: 1,
        });

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: acquired.id, output: null }],
          }),
        );

        const result = await stateAdapter.countJobsByTypeName({ typeNames: ["count-done"] });

        assert.deepEqual(result, [
          {
            blocked: { count: 0, hasMore: false },
            pending: { count: 0, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 1, hasMore: false },
          },
        ]);
      },
    },
    {
      name: "countJobsByTypeName preserves input order",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "count-z", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "count-a", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "count-a", input: null },
            ],
          }),
        );

        const result = await stateAdapter.countJobsByTypeName({
          typeNames: ["count-z", "count-a"],
        });

        assert.equal(result[0].pending.count, 1);
        assert.equal(result[1].pending.count, 2);
      },
    },
  ],
};
