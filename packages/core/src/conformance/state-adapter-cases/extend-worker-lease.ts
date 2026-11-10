import { sleep } from "@queuert/helpers";

import type { ConformanceGroup } from "../runner.ts";
import type { StateAdapterConformanceContext } from "./types.ts";

export const extendWorkerLeaseGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "extendWorkerLease",
  cases: [
    {
      name: "renews a live worker's lease to leaseMs from now",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const started = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["render-invoice-pdf"],
          concurrency: 3,
          leaseMs: 10_000,
        });

        const before = Date.now();
        const renewed = await stateAdapter.extendWorkerLease({
          workerId: started.id,
          workerToken: started.token,
          leaseMs: 120_000,
        });
        const after = Date.now();

        expect(renewed!.id).toBe(started.id);
        expect(renewed!.typeNames).toEqual(["render-invoice-pdf"]);
        expect(renewed!.concurrency).toBe(3);
        expect(renewed!.startedAt.getTime()).toBe(started.startedAt.getTime());
        expect(renewed!.leaseUntil.getTime()).toBeGreaterThanOrEqual(before + 120_000 - 1_000);
        expect(renewed!.leaseUntil.getTime()).toBeLessThanOrEqual(after + 120_000 + 1_000);
      },
    },
    {
      name: "renews inside a transaction",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: [],
          concurrency: 1,
          leaseMs: 10_000,
        });

        const renewed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendWorkerLease({
            txCtx,
            workerId: worker.id,
            workerToken: worker.token,
            leaseMs: 60_000,
          }),
        );

        expect(renewed!.id).toBe(worker.id);
      },
    },
    {
      name: "an expired lease cannot be renewed",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: [],
          concurrency: 1,
          leaseMs: 1,
        });
        await sleep(20);

        expect(
          await stateAdapter.extendWorkerLease({
            workerId: worker.id,
            workerToken: worker.token,
            leaseMs: 60_000,
          }),
        ).toBeUndefined();
      },
    },
    {
      name: "returns undefined for a stale registration of the worker",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const workerId = stateAdapter.config.generateWorkerId();
        const staleRun = await stateAdapter.startWorker({
          workerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 10_000,
        });
        await stateAdapter.stopWorker({ workerId, workerToken: staleRun.token });
        await sleep(5);
        const currentRun = await stateAdapter.startWorker({
          workerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 10_000,
        });
        expect(currentRun.startedAt.getTime()).not.toBe(staleRun.startedAt.getTime());

        expect(
          await stateAdapter.extendWorkerLease({
            workerId,
            workerToken: staleRun.token,
            leaseMs: 120_000,
          }),
        ).toBeUndefined();
        const [stored] = await stateAdapter.getWorkers({ workerIds: [workerId] });
        expect(stored!.leaseUntil.getTime()).toBe(currentRun.leaseUntil.getTime());

        const renewed = await stateAdapter.extendWorkerLease({
          workerId,
          workerToken: currentRun.token,
          leaseMs: 120_000,
        });
        expect(renewed!.id).toBe(workerId);
        expect(renewed!.startedAt.getTime()).toBe(currentRun.startedAt.getTime());
        expect(renewed!.leaseUntil.getTime()).toBeGreaterThan(currentRun.leaseUntil.getTime());
      },
    },
    {
      name: "a missing worker renews to undefined",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        expect(
          await stateAdapter.extendWorkerLease({
            workerId: stateAdapter.config.generateWorkerId(),
            workerToken: crypto.randomUUID(),
            leaseMs: 60_000,
          }),
        ).toBeUndefined();
      },
    },
  ],
};
