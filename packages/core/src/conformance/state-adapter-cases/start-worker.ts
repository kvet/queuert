import { sleep } from "@queuert/helpers";

import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const startWorkerGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "startWorker",
  cases: [
    {
      name: "config.generateWorkerId produces unique ids that pass config.validateWorkerId",
      run: async ({ stateAdapter }, expect) => {
        const ids = Array.from({ length: 10 }, () => stateAdapter.config.generateWorkerId());
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) {
          expect(stateAdapter.config.validateWorkerId(id)).toBe(true);
        }
      },
    },
    {
      name: "starts a worker with a lease leaseMs from now",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        const before = Date.now();
        const worker = await stateAdapter.startWorker({
          workerId,
          typeNames: ["send-welcome-email", "sync-to-crm"],
          concurrency: 4,
          leaseMs: 60_000,
        });
        const after = Date.now();

        expect(worker.id).toBe(workerId);
        expect(worker.typeNames).toEqual(["send-welcome-email", "sync-to-crm"]);
        expect(worker.concurrency).toBe(4);
        expect(worker.startedAt).toBeInstanceOf(Date);
        expect(typeof worker.token).toBe("string");
        expect(worker.startedAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
        expect(worker.startedAt.getTime()).toBeLessThanOrEqual(after + 1_000);
        expect(worker.leaseUntil.getTime()).toBeGreaterThanOrEqual(before + 60_000 - 1_000);
        expect(worker.leaseUntil.getTime()).toBeLessThanOrEqual(after + 60_000 + 1_000);
      },
    },
    {
      name: "rejects a worker id that already has a row, even one whose lease expired",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        const worker = await stateAdapter.startWorker({
          workerId,
          typeNames: ["send-welcome-email"],
          concurrency: 1,
          leaseMs: 1,
        });
        await sleep(20);

        await expect(
          stateAdapter.startWorker({
            workerId,
            typeNames: ["sync-to-crm"],
            concurrency: 2,
            leaseMs: 60_000,
          }),
        ).rejects.toThrow();

        const stopped = await stateAdapter.stopWorker({
          workerId,
          workerToken: worker.token,
        });
        expect(stopped!.typeNames).toEqual(["send-welcome-email"]);
        expect(stopped!.concurrency).toBe(1);
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
              typeNames: [],
              concurrency: 1,
              leaseMs: 60_000,
            });
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");

        expect(
          await stateAdapter.extendWorkerLease({
            workerId,
            workerToken: crypto.randomUUID(),
            leaseMs: 60_000,
          }),
        ).toBeUndefined();
      },
    },
  ],
};
