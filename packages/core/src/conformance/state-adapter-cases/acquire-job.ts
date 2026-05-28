import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const acquireJobGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "acquireJob",
  cases: [
    {
      name: "acquires oldest eligible pending job",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "acquire-test",
                chainTypeName: "acquire-test",
                input: { order: 1 },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "acquire-test",
                chainTypeName: "acquire-test",
                input: { order: 2 },
              },
            ],
          }),
        );

        const { job } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({
            txCtx,
            typeNames: ["acquire-test"],
            workerId: "conformance-worker",
            leaseDurationMs: 30_000,
          }),
        );

        expect(job).toBeDefined();
        expect(job!.input).toEqual({ order: 1 });
        expect(job!.completedAt).toBeNull();
        expect(job!.leasedUntil).not.toBeNull();
        expect(job!.attempt).toBe(1);
      },
    },
    {
      name: "returns hasMore when additional eligible jobs exist",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "hasmore-test",
                chainTypeName: "hasmore-test",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "hasmore-test",
                chainTypeName: "hasmore-test",
                input: null,
              },
            ],
          }),
        );

        const { job: job1, hasMore: hasMore1 } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({
            txCtx,
            typeNames: ["hasmore-test"],
            workerId: "conformance-worker",
            leaseDurationMs: 30_000,
          }),
        );
        expect(job1).toBeDefined();
        expect(hasMore1).toBe(true);

        const { job: job2 } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({
            txCtx,
            typeNames: ["hasmore-test"],
            workerId: "conformance-worker",
            leaseDurationMs: 30_000,
          }),
        );
        expect(job2).toBeDefined();
      },
    },
    {
      name: "returns undefined when no eligible jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const { job, hasMore } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({
            txCtx,
            typeNames: ["nonexistent-type"],
            workerId: "conformance-worker",
            leaseDurationMs: 30_000,
          }),
        );

        expect(job).toBeUndefined();
        expect(hasMore).toBe(false);
      },
    },
    {
      name: "does not acquire jobs scheduled in the future",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "future-acquire",
                chainTypeName: "future-acquire",
                input: null,
                schedule: { afterMs: 60_000 },
              },
            ],
          }),
        );

        const { job } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({
            txCtx,
            typeNames: ["future-acquire"],
            workerId: "conformance-worker",
            leaseDurationMs: 30_000,
          }),
        );

        expect(job).toBeUndefined();
      },
    },
  ],
};
