import { sleep } from "../../helpers/sleep.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

export const reapExpiredJobLeaseGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "reapExpiredJobLease",
  cases: [
    {
      name: "removes expired lease and resets job to pending",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "expire-test",
                chainTypeName: "expire-test",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["expire-test"] }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.renewJobLease({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            leaseDurationMs: 1,
          }),
        );

        await sleep(10);

        const expired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.reapExpiredJobLease({ txCtx, typeNames: ["expire-test"] }),
        );

        expect(expired).toBeDefined();
        expect(expired!.id).toBe(created.id);
        expect(expired!.status).toBe("pending");
        expect(expired!.leasedBy).toBeNull();
        expect(expired!.leasedUntil).toBeNull();
      },
    },
    {
      name: "returns undefined when no expired leases exist",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "no-expire-test",
                chainTypeName: "no-expire-test",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["no-expire-test"] }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.renewJobLease({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            leaseDurationMs: 60_000,
          }),
        );

        const expired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.reapExpiredJobLease({ txCtx, typeNames: ["no-expire-test"] }),
        );

        expect(expired).toBeUndefined();
      },
    },
    {
      name: "respects ignoredJobIds in reapExpiredJobLease",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: jobA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "ignore-test",
                chainTypeName: "ignore-test",
                input: { order: "a" },
              },
            ],
          }),
        );

        const [{ job: jobB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "ignore-test",
                chainTypeName: "ignore-test",
                input: { order: "b" },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["ignore-test"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["ignore-test"] }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.renewJobLease({
            txCtx,
            jobId: jobA.id,
            workerId: "worker-1",
            leaseDurationMs: 1,
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.renewJobLease({
            txCtx,
            jobId: jobB.id,
            workerId: "worker-2",
            leaseDurationMs: 1,
          }),
        );

        await sleep(10);

        const expired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.reapExpiredJobLease({
            txCtx,
            typeNames: ["ignore-test"],
            ignoredJobIds: [jobA.id],
          }),
        );

        expect(expired).toBeDefined();
        expect(expired!.id).toBe(jobB.id);
      },
    },
  ],
};
