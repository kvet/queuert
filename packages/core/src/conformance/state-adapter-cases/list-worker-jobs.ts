import { sleep } from "@queuert/helpers";

import type { ConformanceGroup } from "../runner.ts";
import type { StateAdapterConformanceContext } from "./types.ts";

export const listWorkerJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "listWorkerJobs",
  cases: [
    {
      name: "lists the jobs running under the worker across types, ordered by attemptAt",
      run: async ({ createStateAdapter }, expect) => {
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

        expect(jobs.map((job) => job.id)).toEqual([first.id, second.id]);
        expect(jobs.map((job) => [job.status, job.attemptBy, job.chain.id])).toEqual([
          ["running", worker.id, first.chainId],
          ["running", worker.id, second.chainId],
        ]);
      },
    },
    {
      name: "orders jobs attempted at the same time by id",
      run: async ({ createStateAdapter }, expect) => {
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

        expect(jobs.map((job) => job.id)).toEqual(claimed.map((job) => job.id).toSorted());
      },
    },
    {
      name: "paginates jobs attempted at the same time by id in both directions",
      run: async ({ createStateAdapter }, expect) => {
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
        expect(ascPage.items.map((job) => job.id)).toEqual([firstId, secondId]);
        expect(
          (await listSameTimeWorkerJobs("asc", ascPage.nextCursor!)).items.map((job) => job.id),
        ).toEqual([thirdId]);

        const descPage = await listSameTimeWorkerJobs("desc");
        expect(descPage.items.map((job) => job.id)).toEqual([thirdId, secondId]);
        expect(
          (await listSameTimeWorkerJobs("desc", descPage.nextCursor!)).items.map((job) => job.id),
        ).toEqual([firstId]);
      },
    },
    {
      name: "excludes jobs the worker completed and jobs reclaimed from it",
      run: async ({ createStateAdapter }, expect) => {
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

        expect(jobs.map((job) => job.id)).toEqual([running.id]);
      },
    },
    {
      name: "lists a running job whose worker row is gone",
      run: async ({ createStateAdapter }, expect) => {
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

        expect(await stateAdapter.getWorkers({ workerIds: [worker.id] })).toEqual([undefined]);
        expect(jobs.map((job) => job.id).toSorted()).toEqual(
          claimed.map((job) => job.id).toSorted(),
        );
      },
    },
    {
      name: "returns an empty page for an unknown worker",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        expect(
          await stateAdapter.listWorkerJobs({
            workerId: stateAdapter.config.generateWorkerId(),
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        ).toEqual({ items: [], nextCursor: null });
      },
    },
    {
      name: "orders jobs descending when orderDirection is desc",
      run: async ({ createStateAdapter }, expect) => {
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

        expect(jobs.map((job) => job.id)).toEqual([thirdJobId, secondJobId, firstJobId]);
      },
    },
    {
      name: "paginates with cursor",
      run: async ({ createStateAdapter }, expect) => {
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
        expect(firstPage.items.map((job) => job.id)).toEqual([firstJobId, secondJobId]);
        expect(firstPage.nextCursor).not.toBeNull();

        const secondPage = await stateAdapter.listWorkerJobs({
          workerId: worker.id,
          orderDirection: "asc",
          page: { limit: 2, cursor: firstPage.nextCursor! },
        });
        expect(secondPage.items.map((job) => job.id)).toEqual([thirdJobId]);
        expect(secondPage.nextCursor).toBeNull();
      },
    },
    {
      name: "paginates with cursor in desc order",
      run: async ({ createStateAdapter }, expect) => {
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
        expect(firstPage.items.map((job) => job.id)).toEqual([thirdJobId, secondJobId]);
        expect(firstPage.nextCursor).not.toBeNull();

        const secondPage = await stateAdapter.listWorkerJobs({
          workerId: worker.id,
          orderDirection: "desc",
          page: { limit: 2, cursor: firstPage.nextCursor! },
        });
        expect(secondPage.items.map((job) => job.id)).toEqual([firstJobId]);
        expect(secondPage.nextCursor).toBeNull();
      },
    },
  ],
};
