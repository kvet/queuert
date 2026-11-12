import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers/sleep";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const listJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "listJobs",
  cases: [
    {
      name: "listJobs returns empty page when no jobs exist",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const result = await stateAdapter.listJobs({
          typeName: "task",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.deepEqual(result.items, []);
        assert.equal(result.nextCursor, null);
      },
    },
    {
      name: "listJobs returns all jobs across chains",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "chain-type",
                input: { step: 1 },
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "chain-type",
                continueFromId: headChain.head.id,
                input: { step: 2 },
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "chain-type", input: null },
            ],
          }),
        );

        const result = await stateAdapter.listJobs({
          typeName: "chain-type",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(result.items.length, 3);
      },
    },
    {
      name: "listJobs filters by status completed",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["test-type"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "test-type", input: null }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "test-type", input: null }],
          }),
        );

        await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["test-type"],
          limit: 1,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: stateChain.head.id, output: null }],
          }),
        );

        const result = await stateAdapter.listJobs({
          typeName: "test-type",
          orderBy: "completedAt",
          status: "completed",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].id, stateChain.head.id);
      },
    },
    {
      name: "listJobs filters by status pending",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["pending-type"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "pending-type", input: null },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "pending-type", input: null },
            ],
          }),
        );
        await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["pending-type"],
          limit: 1,
        });

        const result = await stateAdapter.listJobs({
          typeName: "pending-type",
          orderBy: "scheduledAt",
          status: "pending",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].completedAt, null);
        assert.equal(result.items[0].attemptAt, null);
      },
    },
    {
      name: "listJobs filters by status running",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["running-type"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "running-type", input: null },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "running-type", input: null },
            ],
          }),
        );
        const [acquired] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["running-type"],
          limit: 1,
        });

        const result = await stateAdapter.listJobs({
          typeName: "running-type",
          orderBy: "attemptAt",
          status: "running",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].id, acquired.id);
        assert.notEqual(result.items[0].attemptAt, null);
      },
    },
    {
      name: "listJobs separates blocked jobs from pending ones by status",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "blocker-filter", input: null },
            ],
          }),
        );
        const [unblockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "blocked-filter",
                input: { kind: "unblocked" },
              },
            ],
          }),
        );
        const [blockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "blocked-filter",
                input: { kind: "blocked" },
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: blockedChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        const blockedResult = await stateAdapter.listJobs({
          orderBy: "scheduledAt",
          status: "blocked",
          typeName: "blocked-filter",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(blockedResult.items.length, 1);
        assert.equal(blockedResult.items[0].id, blockedChain.head.id);
        assert.equal(blockedResult.items[0].status, "blocked");

        const pendingResult = await stateAdapter.listJobs({
          orderBy: "scheduledAt",
          status: "pending",
          typeName: "blocked-filter",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(pendingResult.items.length, 1);
        assert.equal(pendingResult.items[0].id, unblockedChain.head.id);
        assert.equal(pendingResult.items[0].status, "pending");
      },
    },
    {
      name: "listJobs completed status includes both terminal and continued jobs",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["completed-mixed"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [stateChain1] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "completed-mixed", input: null },
            ],
          }),
        );
        const [stateChain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "completed-mixed", input: null },
            ],
          }),
        );

        await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["completed-mixed"],
          limit: 1,
        });
        await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["completed-mixed"],
          limit: 1,
        });

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: stateChain1.head.id, output: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "next-step",
                continueFromId: stateChain2.head.id,
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listJobs({
          typeName: "completed-mixed",
          orderBy: "completedAt",
          status: "completed",
          orderDirection: "asc",
          page: { limit: 10 },
        });
        const continuedById = new Map(
          result.items.map((job) => [job.id, job.continuedToId !== null]),
        );
        assert.equal(result.items.length, 2);
        assert.equal(continuedById.get(stateChain1.head.id), false);
        assert.equal(continuedById.get(stateChain2.head.id), true);
      },
    },
    {
      name: "listJobs sorts completed jobs by completedAt when orderBy is completedAt",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["sort-complete"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [chainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "sort-complete", input: null },
            ],
          }),
        );
        await sleep(5);
        const [chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "sort-complete", input: null },
            ],
          }),
        );

        await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["sort-complete"],
          limit: 1,
        });
        await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["sort-complete"],
          limit: 1,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: chainB.head.id, output: null }],
          }),
        );
        await sleep(5);
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: chainA.head.id, output: null }],
          }),
        );

        const byCreatedAt = await stateAdapter.listJobs({
          typeName: "sort-complete",
          status: "completed",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(byCreatedAt.items[0].id, chainB.head.id);
        assert.equal(byCreatedAt.items[1].id, chainA.head.id);

        const byCompletedAt = await stateAdapter.listJobs({
          typeName: "sort-complete",
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(byCompletedAt.items[0].id, chainA.head.id);
        assert.equal(byCompletedAt.items[1].id, chainB.head.id);
      },
    },
    {
      name: "listJobs sorts running jobs by attemptAt when orderBy is attemptAt",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["sort-running"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [chainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "sort-running", input: null },
            ],
          }),
        );
        await sleep(5);
        const [chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "sort-running", input: null },
            ],
          }),
        );

        await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["sort-running"],
          limit: 1,
        });
        await sleep(5);
        await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["sort-running"],
          limit: 1,
        });

        const byCreatedAt = await stateAdapter.listJobs({
          typeName: "sort-running",
          status: "running",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(byCreatedAt.items[0].id, chainB.head.id);
        assert.equal(byCreatedAt.items[1].id, chainA.head.id);

        const byAttemptAt = await stateAdapter.listJobs({
          typeName: "sort-running",
          status: "running",
          orderBy: "attemptAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(byAttemptAt.items[0].id, chainB.head.id);
        assert.equal(byAttemptAt.items[1].id, chainA.head.id);
      },
    },
    {
      name: "listJobs sorts pending jobs by scheduledAt when orderBy is scheduledAt",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const future1 = new Date(Date.now() + 60_000);
        const future2 = new Date(Date.now() + 120_000);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "sort-sched",
                input: null,
                schedule: { at: future2 },
              },
            ],
          }),
        );
        await sleep(5);
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "sort-sched",
                input: null,
                schedule: { at: future1 },
              },
            ],
          }),
        );

        const byCreatedAt = await stateAdapter.listJobs({
          typeName: "sort-sched",
          status: "pending",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(byCreatedAt.items[0].typeName, "sort-sched");
        assert.equal(byCreatedAt.items[1].typeName, "sort-sched");

        const byScheduledAt = await stateAdapter.listJobs({
          typeName: "sort-sched",
          status: "pending",
          orderBy: "scheduledAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(byScheduledAt.items.length, 2);
        // The job with future2 (later schedule) should appear first in desc order
        assert.ok(
          byScheduledAt.items[0].scheduledAt.getTime() >
            byScheduledAt.items[1].scheduledAt.getTime(),
        );
      },
    },
    {
      name: "listJobs paginates correctly with completedAt ordering",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["page-type"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const jobIds: string[] = [];
        for (let i = 0; i < 3; i++) {
          const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "page-type", input: null },
              ],
            }),
          );
          jobIds.push(stateChain.head.id);
        }

        for (const id of jobIds) {
          await stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["page-type"],
            limit: 1,
          });
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: id, output: null }],
            }),
          );
          await sleep(5);
        }

        const page1 = await stateAdapter.listJobs({
          typeName: "page-type",
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 2 },
        });
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);

        const page2 = await stateAdapter.listJobs({
          typeName: "page-type",
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        assert.equal(page2.items.length, 1);
        assert.equal(page2.nextCursor, null);

        const allIds = [
          ...page1.items.map((view) => view.id),
          ...page2.items.map((view) => view.id),
        ];
        assert.equal(new Set(allIds).size, 3);
      },
    },
    {
      name: "listJobs paginates with cursor",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        for (let i = 0; i < 4; i++) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "paginate-type",
                  input: { i },
                },
              ],
            }),
          );
        }

        const page1 = await stateAdapter.listJobs({
          typeName: "paginate-type",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2 },
        });
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);

        const page2 = await stateAdapter.listJobs({
          typeName: "paginate-type",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        assert.equal(page2.items.length, 2);
        assert.equal(page2.nextCursor, null);

        const allIds = [
          ...page1.items.map((view) => view.id),
          ...page2.items.map((view) => view.id),
        ];
        assert.equal(new Set(allIds).size, 4);
      },
    },
    {
      name: "listJobs sorts asc when orderDirection is asc",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [chain1] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "sort-asc", input: null }],
          }),
        );
        await sleep(5);
        const [chain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "sort-asc", input: null }],
          }),
        );

        const result = await stateAdapter.listJobs({
          typeName: "sort-asc",
          orderBy: "createdAt",
          orderDirection: "asc",
          page: { limit: 10 },
        });
        assert.equal(result.items.length, 2);
        assert.equal(result.items[0].id, chain1.head.id);
        assert.equal(result.items[1].id, chain2.head.id);
      },
    },
    {
      name: "listJobs filters by from/to date range",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [chainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "range-type", input: null },
            ],
          }),
        );
        await sleep(50);
        const [chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "range-type", input: null },
            ],
          }),
        );
        const midpoint = new Date(
          (chainA.head.createdAt.getTime() + chainB.head.createdAt.getTime()) / 2,
        );

        const after = await stateAdapter.listJobs({
          typeName: "range-type",
          orderBy: "createdAt",
          from: midpoint,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(after.items.length, 1);
        assert.equal(after.items[0].typeName, "range-type");

        const before = await stateAdapter.listJobs({
          typeName: "range-type",
          orderBy: "createdAt",
          to: midpoint,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(before.items.length, 1);
        assert.equal(before.items[0].typeName, "range-type");
      },
    },
    {
      name: "listJobs filters pending by from/to date range",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [chainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "pending-range", input: null },
            ],
          }),
        );
        await sleep(50);
        const [chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "pending-range", input: null },
            ],
          }),
        );
        const midpoint = new Date(
          (chainA.head.createdAt.getTime() + chainB.head.createdAt.getTime()) / 2,
        );

        const after = await stateAdapter.listJobs({
          typeName: "pending-range",
          status: "pending",
          from: midpoint,
          orderBy: "scheduledAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(after.items.length, 1);
        assert.equal(after.items[0].typeName, "pending-range");

        const before = await stateAdapter.listJobs({
          typeName: "pending-range",
          status: "pending",
          to: midpoint,
          orderBy: "scheduledAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(before.items.length, 1);
        assert.equal(before.items[0].typeName, "pending-range");
      },
    },
    {
      name: "listJobs returns continuation jobs with correct status in multi-job chains",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["multi-step"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "multi-step", input: null },
            ],
          }),
        );

        await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["multi-step"],
          limit: 1,
        });
        const [continuedTail] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "multi-step",
                continueFromId: headChain.head.id,
                input: null,
              },
            ],
          }),
        );
        const { continuation: tail } = continuedTail!;

        // Head is completed (continued), tail is pending
        const completed = await stateAdapter.listJobs({
          typeName: "multi-step",
          orderBy: "completedAt",
          status: "completed",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(completed.items.length, 1);
        assert.equal(completed.items[0].id, headChain.head.id);
        assert.equal(completed.items[0].continuedToId, tail.id);

        const pending = await stateAdapter.listJobs({
          typeName: "multi-step",
          orderBy: "createdAt",
          status: "pending",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(
          pending.items.some((item) => item.id === tail.id),
          true,
        );

        // Complete the tail and verify both jobs appear correctly
        await sleep(5);
        await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["multi-step"],
          limit: 1,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: tail.id, output: null }],
          }),
        );

        const allCompleted = await stateAdapter.listJobs({
          typeName: "multi-step",
          orderBy: "completedAt",
          status: "completed",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.equal(allCompleted.items.length, 2);
        // tail completed last, so it should be first in desc order
        assert.equal(allCompleted.items[0].id, tail.id);
        assert.equal(allCompleted.items[1].id, headChain.head.id);
      },
    },
    {
      name: "listJobs paginates jobs created at the same time by id in both directions",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const created = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [0, 1, 2].map(() => ({
              id: stateAdapter.config.generateJobId(),
              typeName: "same-time-job",
              input: null,
            })),
          }),
        );
        const [firstId, secondId, thirdId] = created.map((chain) => chain.head.id).toSorted();
        const listSameTimeJobs = async (orderDirection: "asc" | "desc", cursor?: string) =>
          stateAdapter.listJobs({
            typeName: "same-time-job",
            orderBy: "createdAt",
            orderDirection,
            page: { limit: 2, cursor },
          });

        const ascPage = await listSameTimeJobs("asc");
        assert.deepEqual(
          ascPage.items.map((job) => job.id),
          [firstId, secondId],
        );
        assert.deepEqual(
          (await listSameTimeJobs("asc", ascPage.nextCursor!)).items.map((job) => job.id),
          [thirdId],
        );

        const descPage = await listSameTimeJobs("desc");
        assert.deepEqual(
          descPage.items.map((job) => job.id),
          [thirdId, secondId],
        );
        assert.deepEqual(
          (await listSameTimeJobs("desc", descPage.nextCursor!)).items.map((job) => job.id),
          [firstId],
        );
      },
    },
  ],
};

export const listJobsConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "listJobs",
    cases: [
      {
        name: "non-transactional listJobs does not observe an uncommitted insert",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          let release: (() => void) | undefined;
          const gate = new Promise<void>((r) => {
            release = r;
          });
          let signalTxReady: (() => void) | undefined;
          const txReady = new Promise<void>((r) => {
            signalTxReady = r;
          });

          const txPromise = stateAdapter
            .withTransaction(async (txCtx) => {
              await stateAdapter.createJobs({
                txCtx,
                jobs: [
                  { id: stateAdapter.config.generateJobId(), typeName: "iso-list", input: null },
                ],
              });
              signalTxReady!();
              await gate;
              throw new Error("rollback");
            })
            .catch(() => {});

          await txReady;
          const listPromise = stateAdapter.listJobs({
            orderBy: "createdAt",
            typeName: "iso-list",
            orderDirection: "desc",
            page: { limit: 10 },
          });
          release!();
          await txPromise;

          const { items } = await listPromise;
          assert.equal(items.length, 0);
        },
      },
    ],
  };
