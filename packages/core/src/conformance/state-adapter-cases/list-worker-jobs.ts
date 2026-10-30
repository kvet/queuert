import { sleep } from "@queuert/helpers";

import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const listWorkerJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "listWorkerJobs",
  cases: [
    {
      name: "lists the jobs running under the worker across types, ordered by attemptAt",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        const otherWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: ["reserve-stock", "ship-order"],
          concurrency: 3,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: otherWorkerId,
          name: null,
          typeNames: ["reserve-stock"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "reserve-stock", input: null },
              { id: stateAdapter.config.generateId(), typeName: "ship-order", input: null },
              { id: stateAdapter.config.generateId(), typeName: "reserve-stock", input: null },
            ],
          }),
        );
        const [first] = await stateAdapter.startJobAttempts({
          workerId,
          typeNames: ["reserve-stock"],
          limit: 1,
        });
        await sleep(5);
        const [second] = await stateAdapter.startJobAttempts({
          workerId,
          typeNames: ["ship-order"],
          limit: 1,
        });
        await stateAdapter.startJobAttempts({
          workerId: otherWorkerId,
          typeNames: ["reserve-stock"],
          limit: 1,
        });

        const jobs = await stateAdapter.listWorkerJobs({ workerId });

        expect(jobs.map((job) => job.id)).toEqual([first.id, second.id]);
        expect(jobs.map((job) => [job.status, job.attemptBy, job.chain.id])).toEqual([
          ["running", workerId, first.chainId],
          ["running", workerId, second.chainId],
        ]);
      },
    },
    {
      name: "orders jobs attempted at the same time by id",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: ["daily-digest"],
          concurrency: 3,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "daily-digest", input: null },
              { id: stateAdapter.config.generateId(), typeName: "daily-digest", input: null },
              { id: stateAdapter.config.generateId(), typeName: "daily-digest", input: null },
            ],
          }),
        );
        const claimed = await stateAdapter.startJobAttempts({
          workerId,
          typeNames: ["daily-digest"],
          limit: 3,
        });

        const jobs = await stateAdapter.listWorkerJobs({ workerId });

        expect(jobs.map((job) => job.id)).toEqual(claimed.map((job) => job.id).toSorted());
      },
    },
    {
      name: "excludes jobs the worker completed and jobs reclaimed from it",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: ["capture-payment"],
          concurrency: 3,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "capture-payment", input: null },
              { id: stateAdapter.config.generateId(), typeName: "capture-payment", input: null },
              { id: stateAdapter.config.generateId(), typeName: "capture-payment", input: null },
            ],
          }),
        );
        const [completed, rescheduled, running] = await stateAdapter.startJobAttempts({
          workerId,
          typeNames: ["capture-payment"],
          limit: 3,
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
        await stateAdapter.rescheduleJobs({
          jobs: [
            {
              jobId: rescheduled.id,
              error: "JobAttemptReclaimedError",
              fence: { attempt: rescheduled.attempt, workerId },
            },
          ],
        });

        const jobs = await stateAdapter.listWorkerJobs({ workerId });

        expect(jobs.map((job) => job.id)).toEqual([running.id]);
      },
    },
    {
      name: "lists a running job whose worker row is gone",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: ["provision-account"],
          concurrency: 2,
          leaseMs: 0,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "provision-account", input: null },
              { id: stateAdapter.config.generateId(), typeName: "provision-account", input: null },
            ],
          }),
        );
        const claimed = await stateAdapter.startJobAttempts({
          workerId,
          typeNames: ["provision-account"],
          limit: 2,
        });
        const [reclaimed] = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError",
          limit: 1,
        });

        const jobs = await stateAdapter.listWorkerJobs({ workerId });

        expect(await stateAdapter.getWorkers({ workerIds: [workerId] })).toEqual([undefined]);
        expect(jobs.map((job) => job.id)).toEqual(
          claimed.map((job) => job.id).filter((jobId) => jobId !== reclaimed.id),
        );
      },
    },
    {
      name: "returns an empty array for an unknown worker",
      run: async ({ stateAdapter }, expect) => {
        expect(
          await stateAdapter.listWorkerJobs({ workerId: stateAdapter.config.generateWorkerId() }),
        ).toEqual([]);
      },
    },
  ],
};
