import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const countWorkersGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "countWorkers",
  cases: [
    {
      name: "returns zeros when no worker has a row",
      run: async ({ stateAdapter }, expect) => {
        expect(await stateAdapter.countWorkers({})).toEqual({ live: 0, expired: 0 });
      },
    },
    {
      name: "counts the workers with a live lease and the expired ones",
      run: async ({ stateAdapter }, expect) => {
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

        expect(await stateAdapter.countWorkers({})).toEqual({ live: 2, expired: 1 });
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

        expect(await stateAdapter.countWorkers({})).toEqual({ live: 0, expired: 0 });
      },
    },
  ],
};
