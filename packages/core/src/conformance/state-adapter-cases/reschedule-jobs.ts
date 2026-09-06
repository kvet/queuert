import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const rescheduleJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "rescheduleJobs",
  cases: [
    {
      name: "sets scheduledAt to now on a pending job",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "trigger-test", input: null, schedule: { at: futureDate } }],
          }),
        );

        expect(Math.abs(created.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(1000);

        const before = Date.now();
        const triggered = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: [{ jobId: created.id }] }),
        );

        expect(triggered).toHaveLength(1);
        expect(triggered[0].completedAt).toBeNull();
        expect(triggered[0].attemptAt).toBeNull();
        expect(triggered[0].scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(triggered[0].scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      },
    },
    {
      name: "makes a future-scheduled job acquirable",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "trigger-acquire", input: null, schedule: { at: futureDate } }],
          }),
        );

        const beforeTrigger = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["trigger-acquire"],
          }),
        );
        expect(beforeTrigger.job).toBeUndefined();

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: [{ jobId: created.id }] }),
        );

        const afterTrigger = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["trigger-acquire"],
          }),
        );
        expect(afterTrigger.job).toBeDefined();
        expect(afterTrigger.job!.id).toBe(created.id);
      },
    },
    {
      name: "preserves other job fields",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "trigger-fields", input: { key: "value" }, schedule: { at: futureDate } },
            ],
          }),
        );

        const triggered = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: [{ jobId: created.id }] }),
        );

        expect(triggered[0].id).toBe(created.id);
        expect(triggered[0].typeName).toBe("trigger-fields");
        expect(triggered[0].input).toEqual({ key: "value" });
        expect(triggered[0].chainId).toBe(created.chainId);
        expect(triggered[0].attempt).toBe(created.attempt);
      },
    },
    {
      name: "triggers multiple jobs in input order",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const created = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "trigger-batch", input: { i: 1 }, schedule: { at: futureDate } },
              { typeName: "trigger-batch", input: { i: 2 }, schedule: { at: futureDate } },
              { typeName: "trigger-batch", input: { i: 3 }, schedule: { at: futureDate } },
            ],
          }),
        );
        const ids = created.map((c) => c.job.id);

        const triggered = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: ids.map((jobId) => ({ jobId })) }),
        );

        expect(triggered.map((j) => j.id)).toEqual(ids);

        // Preserves input order when input order differs from insertion order.
        const reversed = [...ids].reverse();
        const reversedTriggered = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: reversed.map((jobId) => ({ jobId })) }),
        );
        expect(reversedTriggered.map((j) => j.id)).toEqual(reversed);
      },
    },
    {
      name: "returns empty array for empty jobIds",
      run: async ({ stateAdapter }, expect) => {
        const triggered = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: [] }),
        );
        expect(triggered).toEqual([]);
      },
    },
    {
      name: "skips missing ids",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "trigger-missing", input: null, schedule: { at: futureDate } }],
          }),
        );

        const missingId = crypto.randomUUID();
        const triggered = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: created.id }, { jobId: missingId }],
          }),
        );

        expect(triggered.map((j) => j.id)).toEqual([created.id]);
      },
    },
    {
      name: "skips completed ids",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const created = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "trigger-not-pending", input: null, schedule: { at: futureDate } },
              { typeName: "trigger-not-pending", input: null, schedule: { at: futureDate } },
            ],
          }),
        );
        const [pending, toComplete] = created.map((c) => c.job);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: toComplete.id, completedBy: null, output: null }],
          }),
        );

        const triggered = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: pending.id }, { jobId: toComplete.id }],
          }),
        );

        expect(triggered.map((j) => j.id)).toEqual([pending.id]);
      },
    },
    {
      name: "clears a running attempt and records the error",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "resched-fail-test", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["resched-fail-test"],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            timeoutMs: 10_000,
          }),
        );

        const before = Date.now();
        const [failed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: created.id, schedule: { afterMs: 5000 }, error: "transient failure" }],
          }),
        );

        expect(failed.completedAt).toBeNull();
        expect(failed.attemptAt).toBeNull();
        expect(failed.attemptBy).toBeNull();
        expect(failed.attemptUntil).toBeNull();
        expect(failed.lastAttemptError).toBe("transient failure");
        expect(failed.lastAttemptAt).toBeInstanceOf(Date);
        expect(failed.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 4000);
      },
    },
    {
      name: "clears a running attempt without recording an error",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "resched-running-test", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["resched-running-test"],
          }),
        );

        const before = Date.now();
        const [rescheduled] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: created.id, schedule: { afterMs: 5000 } }],
          }),
        );

        expect(rescheduled.completedAt).toBeNull();
        expect(rescheduled.attemptAt).toBeNull();
        expect(rescheduled.attemptBy).toBeNull();
        expect(rescheduled.attemptUntil).toBeNull();
        expect(rescheduled.lastAttemptError).toBeNull();
        expect(rescheduled.lastAttemptAt).toBeInstanceOf(Date);
        expect(rescheduled.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 4000);
      },
    },
    {
      name: "leaves attempt bookkeeping untouched when there is no attempt to clear",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "resched-no-attempt", input: null }],
          }),
        );

        const [rescheduled] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: created.id, schedule: { afterMs: 5000 }, error: "should-not-apply" }],
          }),
        );

        expect(rescheduled.lastAttemptError).toBeNull();
        expect(rescheduled.lastAttemptAt).toBeNull();
        expect(rescheduled.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 4000);
      },
    },
    {
      name: "reschedules to a future absolute date with schedule.at",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "resched-at", input: null }],
          }),
        );

        const futureDate = new Date(Date.now() + 60_000);
        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: created.id, schedule: { at: futureDate } }],
          }),
        );

        expect(rescheduled).toHaveLength(1);
        expect(rescheduled[0].completedAt).toBeNull();
        expect(rescheduled[0].attemptAt).toBeNull();
        expect(Math.abs(rescheduled[0].scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(
          1000,
        );
      },
    },
    {
      name: "reschedules into the future with schedule.afterMs",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "resched-after", input: null }],
          }),
        );

        const before = Date.now();
        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: created.id, schedule: { afterMs: 60_000 } }],
          }),
        );

        expect(rescheduled[0].scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 59_000);
      },
    },
    {
      name: "clamps a past schedule.at to now",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "resched-past",
                input: null,
                schedule: { at: new Date(Date.now() + 60_000) },
              },
            ],
          }),
        );

        const past = new Date(Date.now() - 60 * 60 * 1000);
        const before = Date.now();
        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: created.id, schedule: { at: past } }],
          }),
        );

        expect(rescheduled[0].scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(rescheduled[0].scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      },
    },
    {
      name: "reschedules a blocked job",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }, { job: blockedJob }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { typeName: "resched-blocker", input: null },
                {
                  typeName: "resched-blocked",
                  input: null,
                  schedule: { at: new Date(Date.now() + 60_000) },
                },
              ],
            }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: blockedJob.id, blockedByChainIds: [blockerJob.chainId] }],
          }),
        );

        const [refreshedBlockedJob] = await stateAdapter.getJobs({
          jobIds: [blockedJob.id],
        });
        expect(refreshedBlockedJob!.blocked).toBe(true);

        const futureDate = new Date(Date.now() + 120_000);
        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: blockedJob.id, schedule: { at: futureDate } }],
          }),
        );

        expect(rescheduled).toHaveLength(1);
        expect(rescheduled[0].blocked).toBe(true);
        expect(Math.abs(rescheduled[0].scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(
          1000,
        );
      },
    },
    {
      name: "omitted schedule reschedules to now",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "resched-now",
                input: null,
                schedule: { at: new Date(Date.now() + 60_000) },
              },
            ],
          }),
        );

        const before = Date.now();
        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: [{ jobId: created.id }] }),
        );

        expect(rescheduled[0].scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(rescheduled[0].scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      },
    },
  ],
};
