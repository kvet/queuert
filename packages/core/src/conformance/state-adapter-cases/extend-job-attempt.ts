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
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "attempt-test", input: null }],
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
      name: "extends attempt by 30 days",
      run: async ({ stateAdapter }, expect) => {
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "far-attempt-test", input: null },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "far-attempt-test": 30_000 },
          }),
        );

        const before = Date.now();
        const renewed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: createdChain.head.id,
            fence: { attempt: 1, workerId: "worker-1" },
            timeoutMs: thirtyDaysMs,
          }),
        );

        const diff = renewed!.attemptUntil!.getTime() - before;
        expect(diff).toBeGreaterThanOrEqual(thirtyDaysMs - 1000);
        expect(diff).toBeLessThan(thirtyDaysMs + 1000);
      },
    },
    {
      name: "extends attempt by a fractional timeoutMs",
      run: async ({ stateAdapter }, expect) => {
        const fractionalMs = 60_000.5;
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "fractional-attempt-test",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "fractional-attempt-test": 30_000 },
          }),
        );

        const before = Date.now();
        const renewed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: createdChain.head.id,
            fence: { attempt: 1, workerId: "worker-1" },
            timeoutMs: fractionalMs,
          }),
        );

        const diff = renewed!.attemptUntil!.getTime() - before;
        expect(diff).toBeGreaterThanOrEqual(fractionalMs - 1000);
        expect(diff).toBeLessThan(fractionalMs + 1000);
      },
    },
    {
      name: "updates attemptUntil on subsequent extensions",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "re-attempt-test", input: null },
            ],
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
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "ownership-test", input: null },
            ],
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
      name: "reports an undefined result for a fence on an attempt the same worker has since replaced",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "extend-fence-replaced",
                input: null,
              },
            ],
          }),
        );
        const job = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "extend-fence-replaced": 30_000 },
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: [{ jobId: job!.id }] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "extend-fence-replaced": 30_000 },
          }),
        );
        const [before] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });

        const extended = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: job!.id,
            fence: { attempt: job!.attempt, workerId: "worker-1" },
            timeoutMs: 10_000,
          }),
        );

        expect(extended).toBeUndefined();
        const [after] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(after).toEqual(before);
      },
    },
    {
      name: "reports an undefined result for a completed job",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "extend-fence-completed",
                input: null,
              },
            ],
          }),
        );
        const job = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "extend-fence-completed": 30_000 },
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({ txCtx, jobs: [{ jobId: job!.id, output: null }] }),
        );

        const extended = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: job!.id,
            fence: { attempt: job!.attempt, workerId: "worker-1" },
            timeoutMs: 10_000,
          }),
        );

        expect(extended).toBeUndefined();
      },
    },
  ],
};
