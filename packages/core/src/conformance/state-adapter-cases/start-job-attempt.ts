import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const startJobAttemptGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "startJobAttempt",
  cases: [
    {
      name: "acquires oldest eligible pending job",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "acquire-test", input: { order: 1 } }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "acquire-test", input: { order: 2 } }],
          }),
        );

        const { job } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["acquire-test"],
          }),
        );

        expect(job).toBeDefined();
        expect(job!.input).toEqual({ order: 1 });
        expect(job!.attemptAt).toBeInstanceOf(Date);
        expect(job!.attemptBy).toBe("worker-1");
        expect(job!.completedAt).toBeNull();
        expect(job!.attempt).toBe(1);
      },
    },
    {
      name: "returns undefined when no eligible jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const { job } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["nonexistent-type"],
          }),
        );

        expect(job).toBeUndefined();
      },
    },
    {
      name: "does not acquire blocked jobs",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "blocked-skip", input: null }],
          }),
        );

        const [{ job: mainJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "blocked-skip", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainJob.id, blockedByChainIds: [blockerJob.chainId] }],
          }),
        );

        const { job } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["blocked-skip"],
          }),
        );

        expect(job).toBeDefined();
        expect(job!.id).toBe(blockerJob.id);
      },
    },
    {
      name: "does not acquire blocked jobs when no unblocked jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "blocked-only", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: blockerJob.id,
            workerId: "worker-1",
            outcome: { output: null },
          }),
        );

        const [{ job: blockedJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "blocked-only", input: { value: "blocked" } }],
          }),
        );

        const [{ job: anotherBlocker }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "blocked-only", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: blockedJob.id, blockedByChainIds: [anotherBlocker.chainId] }],
          }),
        );

        const { job } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["blocked-only"],
          }),
        );

        expect(job).toBeDefined();
        expect(job!.id).toBe(anotherBlocker.id);

        const { job: job2 } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["blocked-only"],
          }),
        );

        expect(job2).toBeUndefined();
      },
    },
    {
      name: "does not acquire jobs scheduled in the future",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "future-acquire", input: null, schedule: { afterMs: 60_000 } }],
          }),
        );

        const { job } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["future-acquire"],
          }),
        );

        expect(job).toBeUndefined();
      },
    },
    {
      name: "parallel startJobAttempt calls return distinct jobs (no double-dispatch)",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const count = 5;
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: Array.from({ length: count }, (_, i) => ({
              typeName: "acquire-concurrency",
              input: { index: i },
            })),
          }),
        );

        const results = await Promise.all(
          Array.from({ length: count }, async () =>
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.startJobAttempt({
                txCtx,
                workerId: "worker-1",
                typeNames: ["acquire-concurrency"],
              }),
            ),
          ),
        );

        const acquiredJobs = results.filter((r) => r.job !== undefined);
        const acquiredIds = new Set(acquiredJobs.map((r) => r.job!.id));

        expect(acquiredJobs).toHaveLength(count);
        expect(acquiredIds.size).toBe(count);
      },
    },
  ],
};
