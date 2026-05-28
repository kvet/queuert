import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const rescheduleJobGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "rescheduleJob",
  cases: [
    {
      name: "reschedules a running job to pending with afterMs",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "resched-test",
                chainTypeName: "resched-test",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["resched-test"] }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.renewJobLease({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            leaseDurationMs: 10_000,
          }),
        );

        const before = Date.now();
        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJob({
            txCtx,
            jobId: created.id,
            schedule: { afterMs: 5000 },
            error: "transient failure",
          }),
        );

        expect(rescheduled.status).toBe("pending");
        expect(rescheduled.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 4000);
        expect(rescheduled.lastAttemptError).toBe("transient failure");
        expect(rescheduled.lastAttemptAt).toBeInstanceOf(Date);
        expect(rescheduled.leasedBy).toBeNull();
        expect(rescheduled.leasedUntil).toBeNull();
      },
    },
    {
      name: "reschedules a running job to pending with absolute date",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "resched-at-test",
                chainTypeName: "resched-at-test",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["resched-at-test"] }),
        );

        const futureDate = new Date(Date.now() + 30_000);
        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJob({
            txCtx,
            jobId: created.id,
            schedule: { at: futureDate },
            error: "retry later",
          }),
        );

        expect(rescheduled.status).toBe("pending");
        expect(Math.abs(rescheduled.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(
          1000,
        );
      },
    },
    {
      name: "clamps past schedule.at to now",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "resched-past-test",
                chainTypeName: "resched-past-test",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["resched-past-test"] }),
        );

        const past = new Date(Date.now() - 60 * 60 * 1000);
        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJob({
            txCtx,
            jobId: created.id,
            schedule: { at: past },
            error: "retry",
          }),
        );

        expect(rescheduled.scheduledAt.getTime() - past.getTime()).toBeGreaterThan(30 * 60 * 1000);
        expect(Math.abs(rescheduled.scheduledAt.getTime() - Date.now())).toBeLessThan(60 * 1000);
      },
    },
  ],
};
