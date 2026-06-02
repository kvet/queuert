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
            jobs: [
              {
                typeName: "trigger-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "trigger-test",
                input: null,
                schedule: { at: futureDate },
              },
            ],
          }),
        );

        expect(Math.abs(created.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(1000);

        const before = Date.now();
        const triggered = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobIds: [created.id] }),
        );

        expect(triggered).toHaveLength(1);
        expect(triggered[0].status).toBe("pending");
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
            jobs: [
              {
                typeName: "trigger-acquire",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "trigger-acquire",
                input: null,
                schedule: { at: futureDate },
              },
            ],
          }),
        );

        const beforeTrigger = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["trigger-acquire"] }),
        );
        expect(beforeTrigger.job).toBeUndefined();

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobIds: [created.id] }),
        );

        const afterTrigger = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["trigger-acquire"] }),
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
              {
                typeName: "trigger-fields",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "trigger-fields",
                input: { key: "value" },
                schedule: { at: futureDate },
              },
            ],
          }),
        );

        const triggered = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobIds: [created.id] }),
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
              {
                typeName: "trigger-batch",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "trigger-batch",
                input: { i: 1 },
                schedule: { at: futureDate },
              },
              {
                typeName: "trigger-batch",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "trigger-batch",
                input: { i: 2 },
                schedule: { at: futureDate },
              },
              {
                typeName: "trigger-batch",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "trigger-batch",
                input: { i: 3 },
                schedule: { at: futureDate },
              },
            ],
          }),
        );
        const ids = created.map((c) => c.job.id);

        const triggered = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobIds: ids }),
        );

        expect(triggered.map((j) => j.id)).toEqual(ids);

        // Preserves input order when input order differs from insertion order.
        const reversed = [...ids].reverse();
        const reversedTriggered = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobIds: reversed }),
        );
        expect(reversedTriggered.map((j) => j.id)).toEqual(reversed);
      },
    },
    {
      name: "returns empty array for empty jobIds",
      run: async ({ stateAdapter }, expect) => {
        const triggered = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobIds: [] }),
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
            jobs: [
              {
                typeName: "trigger-missing",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "trigger-missing",
                input: null,
                schedule: { at: futureDate },
              },
            ],
          }),
        );

        const missingId = crypto.randomUUID();
        const triggered = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobIds: [created.id, missingId] }),
        );

        expect(triggered.map((j) => j.id)).toEqual([created.id]);
      },
    },
    {
      name: "skips non-pending ids",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const created = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "trigger-not-pending",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "trigger-not-pending",
                input: null,
                schedule: { at: futureDate },
              },
              {
                typeName: "trigger-not-pending",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "trigger-not-pending",
                input: null,
                schedule: { at: futureDate },
              },
            ],
          }),
        );
        const [pending, toComplete] = created.map((c) => c.job);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJob({ txCtx, jobId: toComplete.id, output: null, workerId: null }),
        );

        const triggered = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobIds: [pending.id, toComplete.id] }),
        );

        expect(triggered.map((j) => j.id)).toEqual([pending.id]);
      },
    },
    {
      name: "reschedules to a future absolute date with schedule.at",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "resched-at",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "resched-at",
                input: null,
              },
            ],
          }),
        );

        const futureDate = new Date(Date.now() + 60_000);
        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobIds: [created.id],
            schedule: { at: futureDate },
          }),
        );

        expect(rescheduled).toHaveLength(1);
        expect(rescheduled[0].status).toBe("pending");
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
            jobs: [
              {
                typeName: "resched-after",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "resched-after",
                input: null,
              },
            ],
          }),
        );

        const before = Date.now();
        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobIds: [created.id],
            schedule: { afterMs: 60_000 },
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
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "resched-past",
                input: null,
                schedule: { at: new Date(Date.now() + 60_000) },
              },
            ],
          }),
        );

        const past = new Date(Date.now() - 60 * 60 * 1000);
        const before = Date.now();
        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobIds: [created.id], schedule: { at: past } }),
        );

        expect(rescheduled[0].scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(rescheduled[0].scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
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
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "resched-now",
                input: null,
                schedule: { at: new Date(Date.now() + 60_000) },
              },
            ],
          }),
        );

        const before = Date.now();
        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobIds: [created.id] }),
        );

        expect(rescheduled[0].scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(rescheduled[0].scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      },
    },
  ],
};
