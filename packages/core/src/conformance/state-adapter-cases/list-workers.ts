import { sleep } from "@queuert/helpers";

import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const listWorkersGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "listWorkers",
  cases: [
    {
      name: "returns an empty array when no worker has a row",
      run: async ({ stateAdapter }, expect) => {
        expect(await stateAdapter.listWorkers({})).toEqual([]);
      },
    },
    {
      name: "orders workers by startedAt",
      run: async ({ stateAdapter }, expect) => {
        const firstWorkerId = stateAdapter.config.generateWorkerId();
        const secondWorkerId = stateAdapter.config.generateWorkerId();
        const thirdWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: firstWorkerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: secondWorkerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: thirdWorkerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });

        const workers = await stateAdapter.listWorkers({});

        expect(workers.map((worker) => worker.id)).toEqual([
          firstWorkerId,
          secondWorkerId,
          thirdWorkerId,
        ]);
      },
    },
    {
      name: "keeps only the workers that process typeName",
      run: async ({ stateAdapter }, expect) => {
        const emailWorkerId = stateAdapter.config.generateWorkerId();
        const bothWorkerId = stateAdapter.config.generateWorkerId();
        const crmWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: emailWorkerId,
          name: null,
          typeNames: ["send-welcome-email"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: bothWorkerId,
          name: null,
          typeNames: ["sync-to-crm", "send-welcome-email"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: crmWorkerId,
          name: null,
          typeNames: ["sync-to-crm"],
          concurrency: 1,
          leaseMs: 60_000,
        });

        const workers = await stateAdapter.listWorkers({ typeName: "send-welcome-email" });

        expect(workers.map((worker) => worker.id)).toEqual([emailWorkerId, bothWorkerId]);
        expect(await stateAdapter.listWorkers({ typeName: "ship-order" })).toEqual([]);
      },
    },
    {
      name: "includes an unreclaimed worker whose lease is no longer live",
      run: async ({ stateAdapter }, expect) => {
        const liveWorkerId = stateAdapter.config.generateWorkerId();
        const expiredWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: liveWorkerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: expiredWorkerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 0,
        });

        const workers = await stateAdapter.listWorkers({});

        expect(workers.map((worker) => worker.id)).toEqual([liveWorkerId, expiredWorkerId]);
        expect(workers[1].leaseUntil.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
      },
    },
    {
      name: "excludes stopped and reclaimed workers",
      run: async ({ stateAdapter }, expect) => {
        const liveWorkerId = stateAdapter.config.generateWorkerId();
        const stoppedWorkerId = stateAdapter.config.generateWorkerId();
        const reclaimedWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: liveWorkerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: stoppedWorkerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: reclaimedWorkerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 0,
        });
        await stateAdapter.stopWorker({
          workerId: stoppedWorkerId,
          lastAttemptError: "JobAttemptReclaimedError",
        });
        await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError",
          limit: 1,
        });

        const workers = await stateAdapter.listWorkers({});

        expect(workers.map((worker) => worker.id)).toEqual([liveWorkerId]);
      },
    },
    {
      name: "counts the jobs running under each worker",
      run: async ({ stateAdapter }, expect) => {
        const busyWorkerId = stateAdapter.config.generateWorkerId();
        const idleWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: busyWorkerId,
          name: null,
          typeNames: ["list-count"],
          concurrency: 2,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: idleWorkerId,
          name: null,
          typeNames: ["list-count"],
          concurrency: 2,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "list-count", input: null },
              { id: stateAdapter.config.generateId(), typeName: "list-count", input: null },
            ],
          }),
        );
        await stateAdapter.startJobAttempts({
          workerId: busyWorkerId,
          typeNames: ["list-count"],
          limit: 2,
        });

        const workers = await stateAdapter.listWorkers({});

        expect(workers.map((worker) => [worker.id, worker.runningJobCount])).toEqual([
          [busyWorkerId, 2],
          [idleWorkerId, 0],
        ]);
      },
    },
  ],
};
