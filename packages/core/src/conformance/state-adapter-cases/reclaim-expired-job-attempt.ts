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
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "expire-test": 30_000 },
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: createdChain.head.id,
            fence: { attempt: 1, workerId: "worker-1" },
            timeoutMs: 1,
          }),
        );

        await sleep(10);

        const expired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.reclaimExpiredJobAttempt({
            txCtx,
            typeNames: ["expire-test"],
            lastAttemptError: "JobAttemptExpiredError: test",
          }),
        );

        expect(expired).toBeDefined();
        expect(expired!.id).toBe(createdChain.head.id);
        expect(expired!.status).toBe("pending");
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
            timeoutMsByTypeName: { "no-expire-test": 30_000 },
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: createdChain.head.id,
            fence: { attempt: 1, workerId: "worker-1" },
            timeoutMs: 60_000,
          }),
        );

        const expired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.reclaimExpiredJobAttempt({
            txCtx,
            typeNames: ["no-expire-test"],
            lastAttemptError: "JobAttemptExpiredError: test",
          }),
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
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "ignore-test": 30_000 },
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "ignore-test": 30_000 },
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: chainA.head.id,
            fence: { attempt: 1, workerId: "worker-1" },
            timeoutMs: 1,
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: chainB.head.id,
            fence: { attempt: 1, workerId: "worker-1" },
            timeoutMs: 1,
          }),
        );

        await sleep(10);

        const expired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.reclaimExpiredJobAttempt({
            txCtx,
            typeNames: ["ignore-test"],
            lastAttemptError: "JobAttemptExpiredError: test",
            ignoredJobIds: [chainA.head.id],
          }),
        );

        expect(expired).toBeDefined();
        expect(expired!.id).toBe(chainB.head.id);
      },
    },
    {
      name: "stamps lastAttemptAt and lastAttemptError on the reclaimed job",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({ txCtx, jobs: [{ typeName: "reclaim-stamp", input: null }] }),
        );
        const acquired = await stateAdapter.startJobAttempt({
          workerId: "worker-1",
          timeoutMsByTypeName: { "reclaim-stamp": 1 },
        });
        expect(acquired!.lastAttemptError).toBeNull();

        await sleep(10);
        const before = Date.now();
        const reclaimed = await stateAdapter.reclaimExpiredJobAttempt({
          typeNames: ["reclaim-stamp"],
          lastAttemptError: "JobAttemptExpiredError: the attempt lease expired",
        });

        expect(reclaimed!.id).toBe(createdChain.head.id);
        expect(reclaimed!.status).toBe("pending");
        expect(reclaimed!.attempt).toBe(acquired!.attempt);
        expect(reclaimed!.lastAttemptError).toBe(
          "JobAttemptExpiredError: the attempt lease expired",
        );
        expect(reclaimed!.lastAttemptAt).toBeInstanceOf(Date);
        expect(reclaimed!.lastAttemptAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);

        const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(stored!.lastAttemptError).toBe("JobAttemptExpiredError: the attempt lease expired");
        expect(stored!.lastAttemptAt!.getTime()).toBe(reclaimed!.lastAttemptAt!.getTime());
      },
    },
    {
      name: "reclaims without a txCtx, committing the release on its own",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "reclaim-autocommit", input: null }],
          }),
        );
        await stateAdapter.startJobAttempt({
          workerId: "worker-1",
          timeoutMsByTypeName: { "reclaim-autocommit": 1 },
        });
        await sleep(10);

        const reclaimed = await stateAdapter.reclaimExpiredJobAttempt({
          typeNames: ["reclaim-autocommit"],
          lastAttemptError: "JobAttemptExpiredError: test",
        });
        expect(reclaimed!.id).toBe(createdChain.head.id);

        const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(stored!.status).toBe("pending");
        expect(stored!.attemptBy).toBeNull();

        const reacquired = await stateAdapter.startJobAttempt({
          workerId: "worker-2",
          timeoutMsByTypeName: { "reclaim-autocommit": 30_000 },
        });
        expect(reacquired!.id).toBe(createdChain.head.id);
        expect(reacquired!.attempt).toBe(2);
      },
    },
  ],
};
