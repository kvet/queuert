import type { ConformanceGroup } from "../runner.ts";
import type { StateAdapterConformanceContext } from "./types.ts";

export const countJobsByTypeNameGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "countJobsByTypeName",
  cases: [
    {
      name: "countJobsByTypeName returns empty array for empty input",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const result = await stateAdapter.countJobsByTypeName({ typeNames: [] });
        expect(result).toEqual([]);
      },
    },
    {
      name: "countJobsByTypeName returns zeros for unknown type names",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const result = await stateAdapter.countJobsByTypeName({ typeNames: ["nonexistent"] });
        expect(result).toEqual([
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
      run: async ({ createStateAdapter }, expect) => {
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

        expect(result).toEqual([
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
      run: async ({ createStateAdapter }, expect) => {
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

        expect(result[0].pending.count).toBe(1);
        expect(result[0].running.count).toBe(1);
      },
    },
    {
      name: "countJobsByTypeName counts blocked jobs apart from pending ones",
      run: async ({ createStateAdapter }, expect) => {
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

        expect(result[0].blocked.count).toBe(1);
        expect(result[0].pending.count).toBe(1);
      },
    },
    {
      name: "countJobsByTypeName counts completed jobs",
      run: async ({ createStateAdapter }, expect) => {
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

        expect(result).toEqual([
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
      run: async ({ createStateAdapter }, expect) => {
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

        expect(result[0].pending.count).toBe(1);
        expect(result[1].pending.count).toBe(2);
      },
    },
  ],
};
