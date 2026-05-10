import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

export const renewJobLeaseGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "renewJobLease",
  cases: [
    {
      name: "renews lease on a running job",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "lease-test",
                chainTypeName: "lease-test",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["lease-test"] }),
        );

        const before = Date.now();
        const renewed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.renewJobLease({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            leaseDurationMs: 10_000,
          }),
        );

        expect(renewed.leasedBy).toBe("worker-1");
        expect(renewed.leasedUntil).toBeInstanceOf(Date);
        expect(renewed.leasedUntil!.getTime()).toBeGreaterThanOrEqual(before + 9_000);
        expect(renewed.leasedUntil!.getTime()).toBeLessThan(before + 11_000);
        expect(renewed.status).toBe("running");
      },
    },
    {
      name: "updates leasedUntil on subsequent renewals",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "re-lease-test",
                chainTypeName: "re-lease-test",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["re-lease-test"] }),
        );

        const first = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.renewJobLease({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            leaseDurationMs: 5_000,
          }),
        );

        const second = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.renewJobLease({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            leaseDurationMs: 20_000,
          }),
        );

        expect(second.leasedUntil!.getTime()).toBeGreaterThan(first.leasedUntil!.getTime());
      },
    },
  ],
};
