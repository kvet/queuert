import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const countByJobTypeNamesGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "countByJobTypeNames",
  cases: [
    {
      name: "countByJobTypeNames returns empty array for empty input",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.countByJobTypeNames({ typeNames: [] });
        expect(result).toEqual([]);
      },
    },
    {
      name: "countByJobTypeNames returns zeros for unknown type names",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.countByJobTypeNames({ typeNames: ["nonexistent"] });
        expect(result).toEqual([
          {
            pending: { count: 0, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
        ]);
      },
    },
    {
      name: "countByJobTypeNames counts pending jobs",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              { typeName: "count-a", input: null },
              { typeName: "count-a", input: null },
              { typeName: "count-b", input: null },
            ],
          }),
        );

        const result = await stateAdapter.countByJobTypeNames({
          typeNames: ["count-a", "count-b", "count-c"],
        });

        expect(result).toEqual([
          {
            pending: { count: 2, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
          {
            pending: { count: 1, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
          {
            pending: { count: 0, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
        ]);
      },
    },
    {
      name: "countByJobTypeNames counts running jobs",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              { typeName: "count-run", input: null },
              { typeName: "count-run", input: null },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, typeNames: ["count-run"], workerId: "w1" }),
        );

        const result = await stateAdapter.countByJobTypeNames({ typeNames: ["count-run"] });

        expect(result[0].pending.count).toBe(1);
        expect(result[0].running.count).toBe(1);
      },
    },
    {
      name: "countByJobTypeNames counts completed jobs",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "count-done", input: null }],
          }),
        );

        const { job } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, typeNames: ["count-done"], workerId: "w1" }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: job!.id,
            workerId: "w1",
            outcome: { output: null },
          }),
        );

        const result = await stateAdapter.countByJobTypeNames({ typeNames: ["count-done"] });

        expect(result).toEqual([
          {
            pending: { count: 0, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 1, hasMore: false },
          },
        ]);
      },
    },
    {
      name: "countByJobTypeNames preserves input order",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              { typeName: "count-z", input: null },
              { typeName: "count-a", input: null },
              { typeName: "count-a", input: null },
            ],
          }),
        );

        const result = await stateAdapter.countByJobTypeNames({
          typeNames: ["count-z", "count-a"],
        });

        expect(result[0].pending.count).toBe(1);
        expect(result[1].pending.count).toBe(2);
      },
    },
  ],
};
