import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const extendJobAttemptGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "extendJobAttempt",
  cases: [
    {
      name: "extends attempt on a running job",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "attempt-test", input: null }],
          }),
        );

        const acquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "attempt-test": 30_000 },
          }),
        );
        expect(acquired!.attemptAt).toBeInstanceOf(Date);
        expect(acquired!.attemptBy).toBe("worker-1");

        const before = Date.now();
        const renewed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: createdChain.head.id,
            fence: { attempt: 1, workerId: "worker-1" },
            timeoutMs: 10_000,
          }),
        );

        expect(renewed!.attemptBy).toBe("worker-1");
        expect(renewed!.attemptUntil).toBeInstanceOf(Date);
        expect(renewed!.attemptUntil!.getTime()).toBeGreaterThanOrEqual(before + 9_000);
        expect(renewed!.attemptUntil!.getTime()).toBeLessThan(before + 11_000);
        expect(renewed!.attemptAt).toBeInstanceOf(Date);
        expect(renewed!.completedAt).toBeNull();
        expect(renewed!.attemptAt!.getTime()).toBe(acquired!.attemptAt!.getTime());
      },
    },
    {
      name: "updates attemptUntil on subsequent extensions",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "re-attempt-test", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "re-attempt-test": 30_000 },
          }),
        );

        const first = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: createdChain.head.id,
            fence: { attempt: 1, workerId: "worker-1" },
            timeoutMs: 5_000,
          }),
        );

        const second = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: createdChain.head.id,
            fence: { attempt: 1, workerId: "worker-1" },
            timeoutMs: 20_000,
          }),
        );

        expect(second!.attemptUntil!.getTime()).toBeGreaterThan(first!.attemptUntil!.getTime());
      },
    },
    {
      name: "reports an undefined result for an extension by a different worker",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "ownership-test", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "ownership-test": 30_000 },
          }),
        );

        const extended = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: createdChain.head.id,
            fence: { attempt: 1, workerId: "worker-2" },
            timeoutMs: 10_000,
          }),
        );

        expect(extended).toBeUndefined();

        const [unchanged] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(unchanged!.attemptBy).toBe("worker-1");
      },
    },
    {
      name: "extends without a txCtx, committing the new deadline on its own",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "extend-autocommit", input: null }],
          }),
        );
        const acquired = await stateAdapter.startJobAttempt({
          workerId: "worker-1",
          timeoutMsByTypeName: { "extend-autocommit": 1_000 },
        });

        const extended = await stateAdapter.extendJobAttempt({
          jobId: createdChain.head.id,
          fence: { attempt: acquired!.attempt, workerId: "worker-1" },
          timeoutMs: 60_000,
        });
        expect(extended!.attemptUntil!.getTime()).toBeGreaterThan(
          acquired!.attemptUntil!.getTime(),
        );

        const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(stored!.attemptUntil!.getTime()).toBe(extended!.attemptUntil!.getTime());
      },
    },
  ],
};
