import assert from "node:assert/strict";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const countRunningJobsByWorkerIdGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "countRunningJobsByWorkerId",
  cases: [
    {
      name: "returns an empty array for empty ids",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        assert.deepEqual(await stateAdapter.countRunningJobsByWorkerId({ workerIds: [] }), []);
      },
    },
    {
      name: "counts only the jobs running under each worker, in input order",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["get-count"],
          concurrency: 5,
          leaseMs: 60_000,
        });
        const otherWorker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["get-count-other"],
          concurrency: 5,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "get-count", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "get-count", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "get-count", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "get-count-other", input: null },
            ],
          }),
        );
        const [completed] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["get-count"],
          limit: 3,
        });
        await stateAdapter.startJobAttempts({
          workerId: otherWorker.id,
          workerToken: otherWorker.token,
          typeNames: ["get-count-other"],
          limit: 1,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [
              {
                jobId: completed.id,
                output: null,
                attemptToken: completed.attemptToken!,
                workerId: completed.attemptBy!,
              },
            ],
          }),
        );

        assert.deepEqual(
          await stateAdapter.countRunningJobsByWorkerId({
            workerIds: [worker.id, otherWorker.id, stateAdapter.config.generateWorkerId()],
          }),
          [2, 1, 0],
        );
      },
    },
    {
      name: "counts a running job whose worker row is gone",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["provision-account"],
          concurrency: 2,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "provision-account",
                input: null,
              },
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "provision-account",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["provision-account"],
          limit: 2,
        });
        await stateAdapter.stopWorker({
          workerId: worker.id,
          workerToken: worker.token,
        });

        assert.deepEqual(await stateAdapter.getWorkers({ workerIds: [worker.id] }), [undefined]);
        assert.deepEqual(
          await stateAdapter.countRunningJobsByWorkerId({ workerIds: [worker.id] }),
          [2],
        );
      },
    },
  ],
};
