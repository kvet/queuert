import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const getWorkersGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "getWorkers",
  cases: [
    {
      name: "returns an empty array for empty ids",
      run: async ({ stateAdapter }, expect) => {
        expect(await stateAdapter.getWorkers({ workerIds: [] })).toEqual([]);
      },
    },
    {
      name: "returns undefined for an unknown id",
      run: async ({ stateAdapter }, expect) => {
        expect(
          await stateAdapter.getWorkers({ workerIds: [stateAdapter.config.generateWorkerId()] }),
        ).toEqual([undefined]);
      },
    },
    {
      name: "returns workers in input order with their type names and concurrency",
      run: async ({ stateAdapter }, expect) => {
        const firstWorkerId = stateAdapter.config.generateWorkerId();
        const secondWorkerId = stateAdapter.config.generateWorkerId();
        const missingWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: firstWorkerId,
          name: "get-first",
          typeNames: ["send-welcome-email"],
          concurrency: 2,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: secondWorkerId,
          name: null,
          typeNames: ["sync-to-crm", "render-invoice-pdf"],
          concurrency: 5,
          leaseMs: 60_000,
        });

        const workers = await stateAdapter.getWorkers({
          workerIds: [secondWorkerId, missingWorkerId, firstWorkerId],
        });

        expect(
          workers.map((worker) =>
            worker
              ? {
                  id: worker.id,
                  name: worker.name,
                  typeNames: worker.typeNames,
                  concurrency: worker.concurrency,
                }
              : undefined,
          ),
        ).toEqual([
          {
            id: secondWorkerId,
            name: null,
            typeNames: ["sync-to-crm", "render-invoice-pdf"],
            concurrency: 5,
          },
          undefined,
          {
            id: firstWorkerId,
            name: "get-first",
            typeNames: ["send-welcome-email"],
            concurrency: 2,
          },
        ]);
        expect(workers[0]!.startedAt).toBeInstanceOf(Date);
        expect(workers[0]!.leaseUntil).toBeInstanceOf(Date);
      },
    },
    {
      name: "counts only the jobs running under the worker",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        const otherWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: ["get-count"],
          concurrency: 5,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: otherWorkerId,
          name: null,
          typeNames: ["get-count-other"],
          concurrency: 5,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "get-count", input: null },
              { id: stateAdapter.config.generateId(), typeName: "get-count", input: null },
              { id: stateAdapter.config.generateId(), typeName: "get-count", input: null },
              { id: stateAdapter.config.generateId(), typeName: "get-count-other", input: null },
            ],
          }),
        );
        const [completed] = await stateAdapter.startJobAttempts({
          workerId,
          typeNames: ["get-count"],
          limit: 3,
        });
        await stateAdapter.startJobAttempts({
          workerId: otherWorkerId,
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
                fence: { attempt: completed.attempt, workerId },
              },
            ],
          }),
        );

        const [worker, otherWorker] = await stateAdapter.getWorkers({
          workerIds: [workerId, otherWorkerId],
        });

        expect(worker!.runningJobCount).toBe(2);
        expect(otherWorker!.runningJobCount).toBe(1);
      },
    },
    {
      name: "returns an unreclaimed worker whose lease is no longer live, with its leaseUntil",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        const started = await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 0,
        });

        const [worker] = await stateAdapter.getWorkers({ workerIds: [workerId] });

        expect(worker!.leaseUntil.getTime()).toBe(started.leaseUntil.getTime());
        expect(worker!.leaseUntil.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
      },
    },
    {
      name: "returns undefined for a stopped worker",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.stopWorker({ workerId, lastAttemptError: "JobAttemptReclaimedError" });

        expect(await stateAdapter.getWorkers({ workerIds: [workerId] })).toEqual([undefined]);
      },
    },
  ],
};
