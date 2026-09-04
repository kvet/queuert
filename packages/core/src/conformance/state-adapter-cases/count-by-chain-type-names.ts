import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const countByChainTypeNamesGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "countByChainTypeNames",
  cases: [
    {
      name: "countByChainTypeNames returns empty array for empty input",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.countByChainTypeNames({ typeNames: [] });
        expect(result).toEqual([]);
      },
    },
    {
      name: "countByChainTypeNames returns zeros for unknown type names",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.countByChainTypeNames({ typeNames: ["nonexistent"] });
        expect(result).toEqual([
          {
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
        ]);
      },
    },
    {
      name: "countByChainTypeNames counts running chains",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              { typeName: "chain-count-a", input: null },
              { typeName: "chain-count-a", input: null },
              { typeName: "chain-count-b", input: null },
            ],
          }),
        );

        const result = await stateAdapter.countByChainTypeNames({
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
      name: "countByChainTypeNames counts completed chains",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "chain-done", input: null }],
          }),
        );

        const { job } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, typeNames: ["chain-done"], workerId: "w1" }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: job!.id,
            workerId: "w1",
            outcome: { output: null },
          }),
        );

        const result = await stateAdapter.countByChainTypeNames({ typeNames: ["chain-done"] });

        expect(result).toEqual([
          { running: { count: 0, hasMore: false }, completed: { count: 1, hasMore: false } },
        ]);
      },
    },
    {
      name: "countByChainTypeNames preserves input order",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              { typeName: "chain-z", input: null },
              { typeName: "chain-a", input: null },
              { typeName: "chain-a", input: null },
            ],
          }),
        );

        const result = await stateAdapter.countByChainTypeNames({
          typeNames: ["chain-z", "chain-a"],
        });

        expect(result[0].running.count).toBe(1);
        expect(result[1].running.count).toBe(2);
      },
    },
  ],
};
