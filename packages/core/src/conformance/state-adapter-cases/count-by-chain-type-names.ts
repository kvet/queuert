import { type ConformanceGroup } from "../runner.js";
import { transaction } from "../transaction.js";
import { type StateConformanceFixture } from "./types.js";

export const countByChainTypeNamesGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "countByChainTypeNames",
  cases: [
    {
      name: "countByChainTypeNames and countByJobTypeNames stop counting at config.countCap",
      run: async ({ stateAdapter }, expect) => {
        const { countCap } = stateAdapter.config;
        if (countCap > 50) {
          expect.skip("countCap too large to exercise");
          return;
        }
        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              ...Array.from({ length: countCap + 1 }, () => ({
                id: stateAdapter.config.generateId(),
                typeName: "over-cap",
                input: null,
              })),
              ...Array.from({ length: countCap }, () => ({
                id: stateAdapter.config.generateId(),
                typeName: "at-cap",
                input: null,
              })),
            ],
          }),
        );

        expect(
          await stateAdapter.countByChainTypeNames({ typeNames: ["over-cap", "at-cap"] }),
        ).toEqual([
          { running: { count: countCap, hasMore: true }, completed: { count: 0, hasMore: false } },
          { running: { count: countCap, hasMore: false }, completed: { count: 0, hasMore: false } },
        ]);

        const [over, at] = await stateAdapter.countByJobTypeNames({
          typeNames: ["over-cap", "at-cap"],
        });
        expect(over.pending).toEqual({ count: countCap, hasMore: true });
        expect(at.pending).toEqual({ count: countCap, hasMore: false });
      },
    },
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
        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "chain-count-a", input: null },
              { id: stateAdapter.config.generateId(), typeName: "chain-count-a", input: null },
              { id: stateAdapter.config.generateId(), typeName: "chain-count-b", input: null },
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
        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "chain-done", input: null }],
          }),
        );

        const [acquired] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            timeoutMsByTypeName: { "chain-done": 30_000 },
            workerId: "w1",
            limit: 1,
          }),
        );

        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: acquired.id, output: null }],
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
        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "chain-z", input: null },
              { id: stateAdapter.config.generateId(), typeName: "chain-a", input: null },
              { id: stateAdapter.config.generateId(), typeName: "chain-a", input: null },
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
