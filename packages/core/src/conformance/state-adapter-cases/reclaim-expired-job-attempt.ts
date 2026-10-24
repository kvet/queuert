import { sleep } from "@queuert/helpers";

import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const reclaimExpiredJobAttemptGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "reclaimExpiredJobAttempt",
  cases: [
    {
      name: "resets an expired attempt to pending and stamps the last-attempt fields",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "expire-test", input: null }],
          }),
        );

        const acquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "expire-test": 30_000 },
          }),
        );
        expect(acquired!.lastAttemptAt).toBeNull();
        expect(acquired!.lastAttemptError).toBeNull();

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: createdChain.head.id,
            fence: { attempt: 1, workerId: "worker-1" },
            timeoutMs: 1,
          }),
        );

        await sleep(10);

        const before = Date.now();
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
        expect(expired!.attempt).toBe(1);
        expect(expired!.completedAt).toBeNull();
        expect(expired!.attemptAt).toBeNull();
        expect(expired!.attemptBy).toBeNull();
        expect(expired!.attemptUntil).toBeNull();
        expect(expired!.lastAttemptError).toBe("JobAttemptExpiredError: test");
        expect(expired!.lastAttemptAt).toBeInstanceOf(Date);
        expect(expired!.lastAttemptAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);

        const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(stored!.lastAttemptError).toBe("JobAttemptExpiredError: test");
        expect(stored!.lastAttemptAt!.getTime()).toBe(expired!.lastAttemptAt!.getTime());
      },
    },
    {
      name: "returns undefined when no expired attempts exist",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "no-expire-test", input: null },
            ],
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
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "ignore-test",
                input: { order: "a" },
              },
            ],
          }),
        );

        const [chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "ignore-test",
                input: { order: "b" },
              },
            ],
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
            ignoredJobIds: [chainA.head.id],
            lastAttemptError: "JobAttemptExpiredError: test",
          }),
        );

        expect(expired).toBeDefined();
        expect(expired!.id).toBe(chainB.head.id);
      },
    },
    {
      name: "reclaims without a txCtx, committing the release on its own",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "reclaim-autocommit", input: null },
            ],
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
