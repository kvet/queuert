import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const abandonJobGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "abandonJob",
  cases: [
    {
      name: "releases a running job back to pending and records the attempt error",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "abandon-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "abandon-test",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["abandon-test"] }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.renewJobLease({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            leaseDurationMs: 10_000,
          }),
        );

        const abandoned = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.abandonJob({
            txCtx,
            jobId: created.id,
            error: "transient failure",
          }),
        );

        expect(abandoned.status).toBe("pending");
        expect(abandoned.lastAttemptError).toBe("transient failure");
        expect(abandoned.lastAttemptAt).toBeInstanceOf(Date);
        expect(abandoned.leasedBy).toBeNull();
        expect(abandoned.leasedUntil).toBeNull();
      },
    },
    {
      name: "leaves a non-running job untouched",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "abandon-non-running",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "abandon-non-running",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.abandonJob({ txCtx, jobId: created.id, error: "should-not-apply" }),
          )
          .catch(() => {});

        const [after] = await stateAdapter.getJobs({ jobIds: [created.id] });
        expect(after!.status).toBe("pending");
        expect(after!.lastAttemptError).not.toBe("should-not-apply");
      },
    },
    {
      name: "composes with rescheduleJobs to set the next run time",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "abandon-then-reschedule",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "abandon-then-reschedule",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["abandon-then-reschedule"] }),
        );

        const before = Date.now();
        const [rescheduled] = await stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.abandonJob({ txCtx, jobId: created.id, error: "boom" });
          return stateAdapter.rescheduleJobs({
            txCtx,
            jobIds: [created.id],
            schedule: { afterMs: 5000 },
          });
        });

        expect(rescheduled.status).toBe("pending");
        expect(rescheduled.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 4000);
        expect(rescheduled.lastAttemptError).toBe("boom");
        expect(rescheduled.leasedBy).toBeNull();
        expect(rescheduled.leasedUntil).toBeNull();
      },
    },
  ],
};
