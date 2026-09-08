import { sleep } from "../../helpers/sleep.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const reclaimExpiredJobAttemptGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "reclaimExpiredJobAttempt",
  cases: [
    {
      name: "removes expired attempt and resets job to pending",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "expire-test", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "worker-1", typeNames: ["expire-test"] }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: createdChain.head.id,
            workerId: "worker-1",
            timeoutMs: 1,
          }),
        );

        await sleep(10);

        const expired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.reclaimExpiredJobAttempt({ txCtx, typeNames: ["expire-test"] }),
        );

        expect(expired).toBeDefined();
        expect(expired!.id).toBe(createdChain.head.id);
        expect(expired!.completedAt).toBeNull();
        expect(expired!.attemptAt).toBeNull();
        expect(expired!.attemptBy).toBeNull();
        expect(expired!.attemptUntil).toBeNull();
        expect(expired!.attemptAt).toBeNull();
      },
    },
    {
      name: "returns undefined when no expired attempts exist",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "no-expire-test", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["no-expire-test"],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: createdChain.head.id,
            workerId: "worker-1",
            timeoutMs: 60_000,
          }),
        );

        const expired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.reclaimExpiredJobAttempt({ txCtx, typeNames: ["no-expire-test"] }),
        );

        expect(expired).toBeUndefined();
      },
    },
    {
      name: "respects ignoredJobIds in reclaimExpiredJobAttempt",
      run: async ({ stateAdapter }, expect) => {
        const [chainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "ignore-test", input: { order: "a" } }],
          }),
        );

        const [chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "ignore-test", input: { order: "b" } }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "worker-1", typeNames: ["ignore-test"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "worker-1", typeNames: ["ignore-test"] }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: chainA.head.id,
            workerId: "worker-1",
            timeoutMs: 1,
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: chainB.head.id,
            workerId: "worker-1",
            timeoutMs: 1,
          }),
        );

        await sleep(10);

        const expired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.reclaimExpiredJobAttempt({
            txCtx,
            typeNames: ["ignore-test"],
            ignoredJobIds: [chainA.head.id],
          }),
        );

        expect(expired).toBeDefined();
        expect(expired!.id).toBe(chainB.head.id);
      },
    },
  ],
};
