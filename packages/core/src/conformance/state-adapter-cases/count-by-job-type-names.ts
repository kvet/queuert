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
            blocked: { count: 0, hasMore: false },
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
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "count-a", input: null },
              { id: stateAdapter.config.generateId(), typeName: "count-a", input: null },
              { id: stateAdapter.config.generateId(), typeName: "count-b", input: null },
            ],
          }),
        );

        const result = await stateAdapter.countByJobTypeNames({
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
      name: "countByJobTypeNames counts running jobs",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "count-run", input: null },
              { id: stateAdapter.config.generateId(), typeName: "count-run", input: null },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            timeoutMsByTypeName: { "count-run": 30_000 },
            workerId: "w1",
          }),
        );

        const result = await stateAdapter.countByJobTypeNames({ typeNames: ["count-run"] });

        expect(result[0].pending.count).toBe(1);
        expect(result[0].running.count).toBe(1);
      },
    },
    {
      name: "countByJobTypeNames counts blocked jobs apart from pending ones",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain, blockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "count-blocker", input: null },
              { id: stateAdapter.config.generateId(), typeName: "count-blocked", input: null },
              { id: stateAdapter.config.generateId(), typeName: "count-blocked", input: null },
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

        const result = await stateAdapter.countByJobTypeNames({ typeNames: ["count-blocked"] });

        expect(result[0].blocked.count).toBe(1);
        expect(result[0].pending.count).toBe(1);
      },
    },
    {
      name: "countByJobTypeNames counts completed jobs",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "count-done", input: null }],
          }),
        );

        const acquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            timeoutMsByTypeName: { "count-done": 30_000 },
            workerId: "w1",
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: acquired!.id, output: null }],
          }),
        );

        const result = await stateAdapter.countByJobTypeNames({ typeNames: ["count-done"] });

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
      name: "countByJobTypeNames preserves input order",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "count-z", input: null },
              { id: stateAdapter.config.generateId(), typeName: "count-a", input: null },
              { id: stateAdapter.config.generateId(), typeName: "count-a", input: null },
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
