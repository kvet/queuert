import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const completeJobGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "completeJob",
  cases: [
    {
      name: "completes a job with output",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "complete-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "complete-test",
                input: { value: 1 },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["complete-test"] }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.renewJobLease({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            leaseDurationMs: 10_000,
          }),
        );

        const completed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJob({
            txCtx,
            jobId: created.id,
            output: { result: 42 },
            workerId: "worker-1",
          }),
        );

        expect(completed.status).toBe("completed");
        expect(completed.output).toEqual({ result: 42 });
        expect(completed.completedAt).toBeInstanceOf(Date);
        expect(completed.completedBy).toBe("worker-1");
        expect(completed.leasedBy).toBeNull();
        expect(completed.leasedUntil).toBeNull();
      },
    },
    {
      name: "clears lastAttemptError when completing a job that previously failed",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "complete-clears-error",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "complete-clears-error",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["complete-clears-error"] }),
        );

        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJob({
            txCtx,
            jobId: created.id,
            schedule: { afterMs: 0 },
            error: "first attempt failed",
          }),
        );
        expect(rescheduled.lastAttemptError).toBe("first attempt failed");

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["complete-clears-error"] }),
        );

        const completed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJob({
            txCtx,
            jobId: created.id,
            output: { ok: true },
            workerId: "worker-1",
          }),
        );

        expect(completed.status).toBe("completed");
        expect(completed.lastAttemptError).toBeNull();
      },
    },
    {
      name: "completes a job with null workerId (workerless)",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "workerless-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "workerless-test",
                input: null,
              },
            ],
          }),
        );

        const completed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJob({
            txCtx,
            jobId: created.id,
            output: { done: true },
            workerId: null,
          }),
        );

        expect(completed.status).toBe("completed");
        expect(completed.completedBy).toBeNull();
      },
    },
  ],
};
