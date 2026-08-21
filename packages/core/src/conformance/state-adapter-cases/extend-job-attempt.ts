import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const extendJobAttemptGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "extendJobAttempt",
  cases: [
    {
      name: "extends attempt on a running job",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "attempt-test", input: null }],
          }),
        );

        const { job: acquired } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["attempt-test"],
          }),
        );
        expect(acquired!.attemptAt).toBeInstanceOf(Date);
        expect(acquired!.attemptBy).toBe("worker-1");

        const before = Date.now();
        const renewed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            timeoutMs: 10_000,
          }),
        );

        expect(renewed.attemptBy).toBe("worker-1");
        expect(renewed.attemptUntil).toBeInstanceOf(Date);
        expect(renewed.attemptUntil!.getTime()).toBeGreaterThanOrEqual(before + 9_000);
        expect(renewed.attemptUntil!.getTime()).toBeLessThan(before + 11_000);
        expect(renewed.attemptAt).toBeInstanceOf(Date);
        expect(renewed.completedAt).toBeNull();
        expect(renewed.attemptAt!.getTime()).toBe(acquired!.attemptAt!.getTime());
      },
    },
    {
      name: "updates attemptUntil on subsequent extensions",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "re-attempt-test", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["re-attempt-test"],
          }),
        );

        const first = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            timeoutMs: 5_000,
          }),
        );

        const second = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            timeoutMs: 20_000,
          }),
        );

        expect(second.attemptUntil!.getTime()).toBeGreaterThan(first.attemptUntil!.getTime());
      },
    },
    {
      name: "rejects extension by a different worker",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "ownership-test", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["ownership-test"],
          }),
        );

        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.extendJobAttempt({
              txCtx,
              jobId: created.id,
              workerId: "worker-2",
              timeoutMs: 10_000,
            }),
          ),
        ).rejects.toThrow();
      },
    },
  ],
};
