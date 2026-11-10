import type { ConformanceGroup } from "../runner.ts";
import type { StateAdapterConformanceContext } from "./types.ts";

export const countChainsByTypeNameGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "countChainsByTypeName",
  cases: [
    {
      name: "countChainsByTypeName returns empty array for empty input",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const result = await stateAdapter.countChainsByTypeName({ typeNames: [] });
        expect(result).toEqual([]);
      },
    },
    {
      name: "countChainsByTypeName returns zeros for unknown type names",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const result = await stateAdapter.countChainsByTypeName({ typeNames: ["nonexistent"] });
        expect(result).toEqual([
          {
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
        ]);
      },
    },
    {
      name: "countChainsByTypeName counts running chains",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "chain-count-a", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "chain-count-a", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "chain-count-b", input: null },
            ],
          }),
        );

        const result = await stateAdapter.countChainsByTypeName({
          typeNames: ["chain-count-a", "chain-count-b", "chain-count-c"],
        });

        expect(result).toEqual([
          { running: { count: 2, hasMore: false }, completed: { count: 0, hasMore: false } },
          { running: { count: 1, hasMore: false }, completed: { count: 0, hasMore: false } },
          { running: { count: 0, hasMore: false }, completed: { count: 0, hasMore: false } },
        ]);
      },
    },
    {
      name: "countChainsByTypeName counts completed chains",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["chain-done"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "chain-done", input: null },
            ],
          }),
        );

        const [acquired] = await stateAdapter.startJobAttempts({
          typeNames: ["chain-done"],
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

        const result = await stateAdapter.countChainsByTypeName({ typeNames: ["chain-done"] });

        expect(result).toEqual([
          { running: { count: 0, hasMore: false }, completed: { count: 1, hasMore: false } },
        ]);
      },
    },
    {
      name: "countChainsByTypeName preserves input order",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "chain-z", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "chain-a", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "chain-a", input: null },
            ],
          }),
        );

        const result = await stateAdapter.countChainsByTypeName({
          typeNames: ["chain-z", "chain-a"],
        });

        expect(result[0].running.count).toBe(1);
        expect(result[1].running.count).toBe(2);
      },
    },
  ],
};
