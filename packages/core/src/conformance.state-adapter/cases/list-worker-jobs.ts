import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers/sleep";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const listWorkerJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "listWorkerJobs",
  cases: [
    {
      name: "lists the jobs running under the worker across types, ordered by attemptAt",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["reserve-stock", "ship-order"],
          concurrency: 3,
          leaseMs: 60_000,
        });
        const otherWorker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["reserve-stock"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "reserve-stock", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "ship-order", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "reserve-stock", input: null },
            ],
          }),
        );
        const [first] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["reserve-stock"],
          limit: 1,
        });
        await sleep(5);
        const [second] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["ship-order"],
          limit: 1,
        });
        await stateAdapter.startJobAttempts({
          workerId: otherWorker.id,
          workerToken: otherWorker.token,
          typeNames: ["reserve-stock"],
          limit: 1,
        });

        const { items: jobs } = await stateAdapter.listWorkerJobs({
          workerId: worker.id,
          orderDirection: "asc",
          page: { limit: 10 },
        });

        assert.deepEqual(
          jobs.map((job) => job.id),
          [first.id, second.id],
        );
        assert.deepEqual(
          jobs.map((job) => [job.status, job.attemptBy, job.chain.id]),
          [
            ["running", worker.id, first.chainId],
            ["running", worker.id, second.chainId],
          ],
        );
      },
    },
    {
      name: "orders jobs attempted at the same time by id",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["daily-digest"],
          concurrency: 3,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
            ],
          }),
        );
        const claimed = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["daily-digest"],
          limit: 3,
        });

        const { items: jobs } = await stateAdapter.listWorkerJobs({
          workerId: worker.id,
          orderDirection: "asc",
          page: { limit: 10 },
        });

        assert.deepEqual(
          jobs.map((job) => job.id),
          claimed.map((job) => job.id).toSorted(),
        );
      },
    },
    {
      name: "paginates jobs attempted at the same time by id in both directions",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["daily-digest"],
          concurrency: 3,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [0, 1, 2].map(() => ({
              id: stateAdapter.config.generateJobId(),
              typeName: "daily-digest",
              input: null,
            })),
          }),
        );
        const claimed = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["daily-digest"],
          limit: 3,
        });
        const [firstId, secondId, thirdId] = claimed.map((job) => job.id).toSorted();
        const listSameTimeWorkerJobs = async (orderDirection: "asc" | "desc", cursor?: string) =>
          stateAdapter.listWorkerJobs({
            workerId: worker.id,
            orderDirection,
            page: { limit: 2, cursor },
          });

        const ascPage = await listSameTimeWorkerJobs("asc");
        assert.deepEqual(
          ascPage.items.map((job) => job.id),
          [firstId, secondId],
        );
        assert.deepEqual(
          (await listSameTimeWorkerJobs("asc", ascPage.nextCursor!)).items.map((job) => job.id),
          [thirdId],
        );

        const descPage = await listSameTimeWorkerJobs("desc");
        assert.deepEqual(
          descPage.items.map((job) => job.id),
          [thirdId, secondId],
        );
        assert.deepEqual(
          (await listSameTimeWorkerJobs("desc", descPage.nextCursor!)).items.map((job) => job.id),
          [firstId],
        );
      },
    },
    {
      name: "excludes jobs the worker completed and jobs reclaimed from it",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["capture-payment"],
          concurrency: 3,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "capture-payment", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "capture-payment", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "capture-payment", input: null },
            ],
          }),
        );
        const [completed, rescheduled, running] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
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
                attemptToken: completed.attemptToken!,
                workerId: completed.attemptBy!,
              },
            ],
          }),
        );
        await stateAdapter.rescheduleJobs({
          jobs: [
            {
              jobId: rescheduled.id,
              error: "JobAttemptReclaimedError",
              attemptToken: rescheduled.attemptToken!,
            },
          ],
        });

        const { items: jobs } = await stateAdapter.listWorkerJobs({
          workerId: worker.id,
          orderDirection: "asc",
          page: { limit: 10 },
        });

        assert.deepEqual(
          jobs.map((job) => job.id),
          [running.id],
        );
      },
    },
    {
      name: "lists a running job whose worker row is gone",
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
        const claimed = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["provision-account"],
          limit: 2,
        });
        await stateAdapter.stopWorker({
          workerId: worker.id,
          workerToken: worker.token,
        });

        const { items: jobs } = await stateAdapter.listWorkerJobs({
          workerId: worker.id,
          orderDirection: "asc",
          page: { limit: 10 },
        });

        assert.deepEqual(await stateAdapter.getWorkers({ workerIds: [worker.id] }), [undefined]);
        assert.deepEqual(
          jobs.map((job) => job.id).toSorted(),
          claimed.map((job) => job.id).toSorted(),
        );
      },
    },
    {
      name: "returns an empty page for an unknown worker",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        assert.deepEqual(
          await stateAdapter.listWorkerJobs({
            workerId: stateAdapter.config.generateWorkerId(),
            orderDirection: "asc",
            page: { limit: 10 },
          }),
          { items: [], nextCursor: null },
        );
      },
    },
    {
      name: "orders jobs descending when orderDirection is desc",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["daily-digest"],
          concurrency: 3,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
            ],
          }),
        );
        const claimed = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["daily-digest"],
          limit: 3,
        });
        const [firstJobId, secondJobId, thirdJobId] = claimed.map((job) => job.id).toSorted();

        const { items: jobs } = await stateAdapter.listWorkerJobs({
          workerId: worker.id,
          orderDirection: "desc",
          page: { limit: 10 },
        });

        assert.deepEqual(
          jobs.map((job) => job.id),
          [thirdJobId, secondJobId, firstJobId],
        );
      },
    },
    {
      name: "paginates with cursor",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["daily-digest"],
          concurrency: 3,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
            ],
          }),
        );
        const claimed = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["daily-digest"],
          limit: 3,
        });
        const [firstJobId, secondJobId, thirdJobId] = claimed.map((job) => job.id).toSorted();

        const firstPage = await stateAdapter.listWorkerJobs({
          workerId: worker.id,
          orderDirection: "asc",
          page: { limit: 2 },
        });
        assert.deepEqual(
          firstPage.items.map((job) => job.id),
          [firstJobId, secondJobId],
        );
        assert.notEqual(firstPage.nextCursor, null);

        const secondPage = await stateAdapter.listWorkerJobs({
          workerId: worker.id,
          orderDirection: "asc",
          page: { limit: 2, cursor: firstPage.nextCursor! },
        });
        assert.deepEqual(
          secondPage.items.map((job) => job.id),
          [thirdJobId],
        );
        assert.equal(secondPage.nextCursor, null);
      },
    },
    {
      name: "paginates with cursor in desc order",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["daily-digest"],
          concurrency: 3,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
            ],
          }),
        );
        const claimed = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["daily-digest"],
          limit: 3,
        });
        const [firstJobId, secondJobId, thirdJobId] = claimed.map((job) => job.id).toSorted();

        const firstPage = await stateAdapter.listWorkerJobs({
          workerId: worker.id,
          orderDirection: "desc",
          page: { limit: 2 },
        });
        assert.deepEqual(
          firstPage.items.map((job) => job.id),
          [thirdJobId, secondJobId],
        );
        assert.notEqual(firstPage.nextCursor, null);

        const secondPage = await stateAdapter.listWorkerJobs({
          workerId: worker.id,
          orderDirection: "desc",
          page: { limit: 2, cursor: firstPage.nextCursor! },
        });
        assert.deepEqual(
          secondPage.items.map((job) => job.id),
          [firstJobId],
        );
        assert.equal(secondPage.nextCursor, null);
      },
    },
  ],
};
