import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const triggerJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "triggerJobs",
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
                chainTypeName: "trigger-test",
                input: null,
                schedule: { at: futureDate },
              },
            ],
          }),
        );

        expect(Math.abs(created.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(1000);

        const before = Date.now();
        const { triggered } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.triggerJobs({ txCtx, jobIds: [created.id] }),
        );

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
          stateAdapter.triggerJobs({ txCtx, jobIds: [created.id] }),
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
                chainTypeName: "trigger-fields",
                input: { key: "value" },
                schedule: { at: futureDate },
              },
            ],
          }),
        );

        const { triggered } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.triggerJobs({ txCtx, jobIds: [created.id] }),
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
                chainTypeName: "trigger-batch",
                input: { i: 1 },
                schedule: { at: futureDate },
              },
              {
                typeName: "trigger-batch",
                chainTypeName: "trigger-batch",
                input: { i: 2 },
                schedule: { at: futureDate },
              },
              {
                typeName: "trigger-batch",
                chainTypeName: "trigger-batch",
                input: { i: 3 },
                schedule: { at: futureDate },
              },
            ],
          }),
        );
        const ids = created.map((c) => c.job.id);

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.triggerJobs({ txCtx, jobIds: ids }),
        );

        expect(result.triggered.map((j) => j.id)).toEqual(ids);
        expect(result.notFound).toEqual([]);
        expect(result.notTriggerable).toEqual([]);

        // Also preserves input order when input order differs from insertion order.
        const reversed = [...ids].reverse();
        const resultReversed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.triggerJobs({ txCtx, jobIds: reversed }),
        );
        expect(resultReversed.triggered.map((j) => j.id)).toEqual(reversed);
      },
    },
    {
      name: "returns empty buckets for empty jobIds",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.triggerJobs({ txCtx, jobIds: [] }),
        );

        expect(result).toEqual({ triggered: [], notFound: [], notTriggerable: [] });
      },
    },
    {
      name: "reports missing ids in notFound and does not trigger eligible jobs",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "trigger-missing",
                chainTypeName: "trigger-missing",
                input: null,
                schedule: { at: futureDate },
              },
            ],
          }),
        );

        const missingId = crypto.randomUUID();
        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.triggerJobs({ txCtx, jobIds: [created.id, missingId] }),
        );

        expect(result.triggered).toEqual([]);
        expect(result.notFound).toEqual([missingId]);
        expect(result.notTriggerable).toEqual([]);

        const after = await stateAdapter.getJob({ jobId: created.id });
        expect(Math.abs(after!.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(1000);
      },
    },
    {
      name: "reports non-pending jobs in notTriggerable and does not trigger eligible jobs",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const created = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "trigger-not-pending",
                chainTypeName: "trigger-not-pending",
                input: null,
                schedule: { at: futureDate },
              },
              {
                typeName: "trigger-not-pending",
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

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.triggerJobs({ txCtx, jobIds: [pending.id, toComplete.id] }),
        );

        expect(result.triggered).toEqual([]);
        expect(result.notFound).toEqual([]);
        expect(result.notTriggerable).toEqual([{ id: toComplete.id, status: "completed" }]);

        const after = await stateAdapter.getJob({ jobId: pending.id });
        expect(Math.abs(after!.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(1000);
      },
    },
  ],
};
