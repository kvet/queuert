import assert from "node:assert/strict";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const countWorkersGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "countWorkers",
  cases: [
    {
      name: "returns zeros when no worker has a row",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        assert.deepEqual(await stateAdapter.countWorkers({}), { live: 0, expired: 0 });
      },
    },
    {
      name: "counts the workers with a live lease and the expired ones",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["reserve-stock"],
          concurrency: 3,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["ship-order"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["ship-order"],
          concurrency: 2,
          leaseMs: 0,
        });

        assert.deepEqual(await stateAdapter.countWorkers({}), { live: 2, expired: 1 });
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

        assert.deepEqual(await stateAdapter.countWorkers({}), { live: 0, expired: 0 });
      },
    },
  ],
};
