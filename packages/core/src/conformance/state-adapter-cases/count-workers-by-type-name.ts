import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const countWorkersByTypeNameGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "countWorkersByTypeName",
  cases: [
    {
      name: "returns an empty array for empty type names",
      run: async ({ stateAdapter }, expect) => {
        expect(await stateAdapter.countWorkersByTypeName({ typeNames: [] })).toEqual([]);
      },
    },
    {
      name: "counts the workers processing each type, in input order",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["send-welcome-email", "sync-to-crm"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["sync-to-crm"],
          concurrency: 1,
          leaseMs: 60_000,
        });

        expect(
          await stateAdapter.countWorkersByTypeName({
            typeNames: ["sync-to-crm", "ship-order", "send-welcome-email"],
          }),
        ).toEqual([
          { live: 2, expired: 0 },
          { live: 0, expired: 0 },
          { live: 1, expired: 0 },
        ]);
      },
    },
    {
      name: "counts a worker whose lease is no longer live as expired",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["render-invoice-pdf"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["render-invoice-pdf"],
          concurrency: 1,
          leaseMs: 0,
        });

        expect(
          await stateAdapter.countWorkersByTypeName({ typeNames: ["render-invoice-pdf"] }),
        ).toEqual([{ live: 1, expired: 1 }]);
      },
    },
    {
      name: "does not count a stopped worker",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["capture-payment"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.stopWorker({
          workerId: worker.id,
          workerToken: worker.token,
        });

        expect(
          await stateAdapter.countWorkersByTypeName({ typeNames: ["capture-payment"] }),
        ).toEqual([{ live: 0, expired: 0 }]);
      },
    },
  ],
};
