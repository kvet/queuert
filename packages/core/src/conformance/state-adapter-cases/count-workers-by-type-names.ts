import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const countWorkersByTypeNamesGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "countWorkersByTypeNames",
  cases: [
    {
      name: "returns an empty array for empty type names",
      run: async ({ stateAdapter }, expect) => {
        expect(await stateAdapter.countWorkersByTypeNames({ typeNames: [] })).toEqual([]);
      },
    },
    {
      name: "counts the live workers processing each type, in input order",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          name: null,
          typeNames: ["send-welcome-email", "sync-to-crm"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          name: null,
          typeNames: ["sync-to-crm"],
          concurrency: 1,
          leaseMs: 60_000,
        });

        expect(
          await stateAdapter.countWorkersByTypeNames({
            typeNames: ["sync-to-crm", "ship-order", "send-welcome-email"],
          }),
        ).toEqual([2, 0, 1]);
      },
    },
    {
      name: "does not count a worker whose lease is no longer live",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          name: null,
          typeNames: ["render-invoice-pdf"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          name: null,
          typeNames: ["render-invoice-pdf"],
          concurrency: 1,
          leaseMs: 0,
        });

        expect(
          await stateAdapter.countWorkersByTypeNames({ typeNames: ["render-invoice-pdf"] }),
        ).toEqual([1]);
      },
    },
    {
      name: "does not count a stopped worker",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: ["capture-payment"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.stopWorker({ workerId, lastAttemptError: "JobAttemptReclaimedError" });

        expect(
          await stateAdapter.countWorkersByTypeNames({ typeNames: ["capture-payment"] }),
        ).toEqual([0]);
      },
    },
  ],
};
