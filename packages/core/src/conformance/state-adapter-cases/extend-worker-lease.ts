import { sleep } from "@queuert/helpers";

import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const extendWorkerLeaseGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "extendWorkerLease",
  cases: [
    {
      name: "renews a live worker's lease to leaseMs from now",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        const started = await stateAdapter.startWorker({
          workerId,
          name: "lifecycle-renew",
          typeNames: ["render-invoice-pdf"],
          concurrency: 3,
          leaseMs: 10_000,
        });

        const before = Date.now();
        const renewed = await stateAdapter.extendWorkerLease({ workerId, leaseMs: 120_000 });
        const after = Date.now();

        expect(renewed!.id).toBe(workerId);
        expect(renewed!.name).toBe("lifecycle-renew");
        expect(renewed!.typeNames).toEqual(["render-invoice-pdf"]);
        expect(renewed!.concurrency).toBe(3);
        expect(renewed!.startedAt.getTime()).toBe(started.startedAt.getTime());
        expect(renewed!.leaseUntil.getTime()).toBeGreaterThanOrEqual(before + 120_000 - 1_000);
        expect(renewed!.leaseUntil.getTime()).toBeLessThanOrEqual(after + 120_000 + 1_000);
      },
    },
    {
      name: "renews inside a transaction",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 10_000,
        });

        const renewed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendWorkerLease({ txCtx, workerId, leaseMs: 60_000 }),
        );

        expect(renewed!.id).toBe(workerId);
      },
    },
    {
      name: "an expired lease cannot be renewed",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 1,
        });
        await sleep(20);

        expect(await stateAdapter.extendWorkerLease({ workerId, leaseMs: 60_000 })).toBeUndefined();
      },
    },
    {
      name: "a missing worker renews to undefined",
      run: async ({ stateAdapter }, expect) => {
        expect(
          await stateAdapter.extendWorkerLease({
            workerId: stateAdapter.config.generateWorkerId(),
            leaseMs: 60_000,
          }),
        ).toBeUndefined();
      },
    },
  ],
};
