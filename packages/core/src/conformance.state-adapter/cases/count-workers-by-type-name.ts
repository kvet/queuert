import assert from "node:assert/strict";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const countWorkersByTypeNameGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "countWorkersByTypeName",
  cases: [
    {
      name: "returns an empty array for empty type names",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        assert.deepEqual(await stateAdapter.countWorkersByTypeName({ typeNames: [] }), []);
      },
    },
    {
      name: "counts the workers processing each type, in input order",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.deepEqual(
          await stateAdapter.countWorkersByTypeName({
            typeNames: ["sync-to-crm", "ship-order", "send-welcome-email"],
          }),
          [
            { live: 2, expired: 0 },
            { live: 0, expired: 0 },
            { live: 1, expired: 0 },
          ],
        );
      },
    },
    {
      name: "counts a worker whose lease is no longer live as expired",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.deepEqual(
          await stateAdapter.countWorkersByTypeName({ typeNames: ["render-invoice-pdf"] }),
          [{ live: 1, expired: 1 }],
        );
      },
    },
    {
      name: "does not count a stopped worker",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.deepEqual(
          await stateAdapter.countWorkersByTypeName({ typeNames: ["capture-payment"] }),
          [{ live: 0, expired: 0 }],
        );
      },
    },
  ],
};
