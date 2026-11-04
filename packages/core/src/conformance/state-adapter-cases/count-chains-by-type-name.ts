import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const countChainsByTypeNameGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "countChainsByTypeName",
  cases: [
    {
      name: "countChainsByTypeName and countJobsByTypeName stop counting at config.countCap",
      run: async ({ stateAdapter }, expect) => {
        const { countCap } = stateAdapter.config;
        if (countCap > 50) {
          expect.skip("countCap too large to exercise");
          return;
        }
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              ...Array.from({ length: countCap + 1 }, () => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "over-cap",
                input: null,
              })),
              ...Array.from({ length: countCap }, () => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "at-cap",
                input: null,
              })),
            ],
          }),
        );

        expect(
          await stateAdapter.countChainsByTypeName({ typeNames: ["over-cap", "at-cap"] }),
        ).toEqual([
          { running: { count: countCap, hasMore: true }, completed: { count: 0, hasMore: false } },
          { running: { count: countCap, hasMore: false }, completed: { count: 0, hasMore: false } },
        ]);

        const [over, at] = await stateAdapter.countJobsByTypeName({
          typeNames: ["over-cap", "at-cap"],
        });
        expect(over.pending).toEqual({ count: countCap, hasMore: true });
        expect(at.pending).toEqual({ count: countCap, hasMore: false });
      },
    },
    {
      name: "countChainsByTypeName returns empty array for empty input",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.countChainsByTypeName({ typeNames: [] });
        expect(result).toEqual([]);
      },
    },
    {
      name: "countChainsByTypeName returns zeros for unknown type names",
      run: async ({ stateAdapter }, expect) => {
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
      run: async ({ stateAdapter }, expect) => {
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
      run: async ({ stateAdapter }, expect) => {
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
      run: async ({ stateAdapter }, expect) => {
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
