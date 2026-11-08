import type { ConformanceGroup } from "../runner.ts";
import type { StateConformanceFixture } from "./types.ts";

export const countRunningJobsByWorkerIdGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "countRunningJobsByWorkerId",
  cases: [
    {
      name: "returns an empty array for empty ids",
      run: async ({ stateAdapter }, expect) => {
        expect(await stateAdapter.countRunningJobsByWorkerId({ workerIds: [] })).toEqual([]);
      },
    },
    {
      name: "counts only the jobs running under each worker, in input order",
      run: async ({ stateAdapter }, expect) => {
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

        expect(
          await stateAdapter.countRunningJobsByWorkerId({
            workerIds: [worker.id, otherWorker.id, stateAdapter.config.generateWorkerId()],
          }),
        ).toEqual([2, 1, 0]);
      },
    },
    {
      name: "counts a running job whose worker row is gone",
      run: async ({ stateAdapter }, expect) => {
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

        expect(await stateAdapter.getWorkers({ workerIds: [worker.id] })).toEqual([undefined]);
        expect(await stateAdapter.countRunningJobsByWorkerId({ workerIds: [worker.id] })).toEqual([
          2,
        ]);
      },
    },
  ],
};
