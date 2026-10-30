import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const startWorkerGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "startWorker",
  cases: [
    {
      name: "generates distinct worker ids that pass validateWorkerId",
      run: async ({ stateAdapter }, expect) => {
        const first = stateAdapter.config.generateWorkerId();
        const second = stateAdapter.config.generateWorkerId();

        expect(first).not.toBe(second);
        expect(stateAdapter.config.validateWorkerId(first)).toBe(true);
        expect(stateAdapter.config.validateWorkerId(second)).toBe(true);
      },
    },
    {
      name: "starts a worker with a lease leaseMs from now",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        const before = Date.now();
        const worker = await stateAdapter.startWorker({
          workerId,
          name: "lifecycle-start",
          typeNames: ["send-welcome-email", "sync-to-crm"],
          concurrency: 4,
          leaseMs: 60_000,
        });
        const after = Date.now();

        expect(worker.id).toBe(workerId);
        expect(worker.name).toBe("lifecycle-start");
        expect(worker.typeNames).toEqual(["send-welcome-email", "sync-to-crm"]);
        expect(worker.concurrency).toBe(4);
        expect(worker.startedAt).toBeInstanceOf(Date);
        expect(worker.startedAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
        expect(worker.startedAt.getTime()).toBeLessThanOrEqual(after + 1_000);
        expect(worker.leaseUntil.getTime()).toBeGreaterThanOrEqual(before + 60_000 - 1_000);
        expect(worker.leaseUntil.getTime()).toBeLessThanOrEqual(after + 60_000 + 1_000);
      },
    },
    {
      name: "starts a worker without a name",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });

        expect(worker.name).toBeNull();
      },
    },
    {
      name: "rejects a duplicate worker id",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });

        await expect(
          stateAdapter.startWorker({
            workerId,
            name: null,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        ).rejects.toThrow();
      },
    },
    {
      name: "a worker started in a rolled-back transaction does not exist",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();

        await expect(
          stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.startWorker({
              txCtx,
              workerId,
              name: null,
              typeNames: [],
              concurrency: 1,
              leaseMs: 60_000,
            });
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");

        expect(await stateAdapter.extendWorkerLease({ workerId, leaseMs: 60_000 })).toBeUndefined();
      },
    },
  ],
};
