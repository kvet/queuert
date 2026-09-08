import { sleep } from "../../helpers/sleep.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const listJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "listJobs",
  cases: [
    {
      name: "listJobs returns empty page when no jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.listJobs({
          typeName: "task",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toEqual([]);
        expect(result.nextCursor).toBeNull();
      },
    },
    {
      name: "listJobs returns all jobs across chains",
      run: async ({ stateAdapter }, expect) => {
        const [rootChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "chain-type", input: { step: 1 } }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-type",
                continueFromId: rootChain.head.id,
                input: { step: 2 },
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "chain-type", input: null }],
          }),
        );

        const result = await stateAdapter.listJobs({
          typeName: "chain-type",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(3);
      },
    },
    {
      name: "listJobs filters by status completed",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "test-type", input: null }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "test-type", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "worker-1", typeNames: ["test-type"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "worker-1",
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
        expect(result.items).toHaveLength(1);
        expect(result.items[0].id).toBe(stateChain.head.id);
      },
    },
    {
      name: "listJobs filters by status pending",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "pending-type", input: null }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "pending-type", input: null }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["pending-type"],
          }),
        );

        const result = await stateAdapter.listJobs({
          typeName: "pending-type",
          orderBy: "scheduledAt",
          status: "pending",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].completedAt).toBeNull();
        expect(result.items[0].attemptAt).toBeNull();
      },
    },
    {
      name: "listJobs filters by status running",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "running-type", input: null }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "running-type", input: null }],
          }),
        );
        const acquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["running-type"],
          }),
        );

        const result = await stateAdapter.listJobs({
          typeName: "running-type",
          orderBy: "attemptAt",
          status: "running",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].id).toBe(acquired!.id);
        expect(result.items[0].attemptAt).not.toBeNull();
      },
    },
    {
      name: "listJobs filters pending jobs by blocked",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker-filter", input: null }],
          }),
        );
        const [unblockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocked-filter", input: { kind: "unblocked" } }],
          }),
        );
        const [blockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocked-filter", input: { kind: "blocked" } }],
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
          status: "pending",
          blocked: true,
          typeName: "blocked-filter",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(blockedResult.items).toHaveLength(1);
        expect(blockedResult.items[0].id).toBe(blockedChain.head.id);
        expect(blockedResult.items[0].blocked).toBe(true);

        const unblockedResult = await stateAdapter.listJobs({
          orderBy: "scheduledAt",
          status: "pending",
          blocked: false,
          typeName: "blocked-filter",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(unblockedResult.items).toHaveLength(1);
        expect(unblockedResult.items[0].id).toBe(unblockedChain.head.id);
        expect(unblockedResult.items[0].blocked).toBe(false);
      },
    },
    {
      name: "listJobs completed status includes both terminal and continued jobs",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain1] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "completed-mixed", input: null }],
          }),
        );
        const [stateChain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "completed-mixed", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["completed-mixed"],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["completed-mixed"],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "worker-1",
            jobs: [{ jobId: stateChain1.head.id, output: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            completedBy: "worker-1",
            jobs: [
              {
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
        expect(result.items).toHaveLength(2);
        expect(continuedById.get(stateChain1.head.id)).toBe(false);
        expect(continuedById.get(stateChain2.head.id)).toBe(true);
      },
    },
    {
      name: "listJobs sorts completed jobs by completedAt when orderBy is completedAt",
      run: async ({ stateAdapter }, expect) => {
        const [chainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sort-complete", input: null }],
          }),
        );
        await sleep(5);
        const [chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sort-complete", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["sort-complete"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["sort-complete"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "w1",
            jobs: [{ jobId: chainB.head.id, output: null }],
          }),
        );
        await sleep(5);
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "w1",
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
        expect(byCreatedAt.items[0].id).toBe(chainB.head.id);
        expect(byCreatedAt.items[1].id).toBe(chainA.head.id);

        const byCompletedAt = await stateAdapter.listJobs({
          typeName: "sort-complete",
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(byCompletedAt.items[0].id).toBe(chainA.head.id);
        expect(byCompletedAt.items[1].id).toBe(chainB.head.id);
      },
    },
    {
      name: "listJobs sorts running jobs by attemptAt when orderBy is attemptAt",
      run: async ({ stateAdapter }, expect) => {
        const [chainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sort-running", input: null }],
          }),
        );
        await sleep(5);
        const [chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sort-running", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["sort-running"] }),
        );
        await sleep(5);
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["sort-running"] }),
        );

        const byCreatedAt = await stateAdapter.listJobs({
          typeName: "sort-running",
          status: "running",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(byCreatedAt.items[0].id).toBe(chainB.head.id);
        expect(byCreatedAt.items[1].id).toBe(chainA.head.id);

        const byAttemptAt = await stateAdapter.listJobs({
          typeName: "sort-running",
          status: "running",
          orderBy: "attemptAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(byAttemptAt.items[0].id).toBe(chainB.head.id);
        expect(byAttemptAt.items[1].id).toBe(chainA.head.id);
      },
    },
    {
      name: "listJobs sorts pending jobs by scheduledAt when orderBy is scheduledAt",
      run: async ({ stateAdapter }, expect) => {
        const future1 = new Date(Date.now() + 60_000);
        const future2 = new Date(Date.now() + 120_000);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sort-sched", input: null, schedule: { at: future2 } }],
          }),
        );
        await sleep(5);
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sort-sched", input: null, schedule: { at: future1 } }],
          }),
        );

        const byCreatedAt = await stateAdapter.listJobs({
          typeName: "sort-sched",
          status: "pending",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(byCreatedAt.items[0].typeName).toBe("sort-sched");
        expect(byCreatedAt.items[1].typeName).toBe("sort-sched");

        const byScheduledAt = await stateAdapter.listJobs({
          typeName: "sort-sched",
          status: "pending",
          orderBy: "scheduledAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(byScheduledAt.items).toHaveLength(2);
        // The job with future2 (later schedule) should appear first in desc order
        expect(byScheduledAt.items[0].scheduledAt.getTime()).toBeGreaterThan(
          byScheduledAt.items[1].scheduledAt.getTime(),
        );
      },
    },
    {
      name: "listJobs paginates correctly with completedAt ordering",
      run: async ({ stateAdapter }, expect) => {
        const jobIds: string[] = [];
        for (let i = 0; i < 3; i++) {
          const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ typeName: "page-type", input: null }],
            }),
          );
          jobIds.push(stateChain.head.id);
        }

        for (const id of jobIds) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({
              txCtx,
              workerId: "w1",
              typeNames: ["page-type"],
            }),
          );
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              completedBy: "w1",
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
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listJobs({
          typeName: "page-type",
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(1);
        expect(page2.nextCursor).toBeNull();

        const allIds = [
          ...page1.items.map((view) => view.id),
          ...page2.items.map((view) => view.id),
        ];
        expect(new Set(allIds).size).toBe(3);
      },
    },
    {
      name: "listJobs paginates with cursor",
      run: async ({ stateAdapter }, expect) => {
        for (let i = 0; i < 4; i++) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ typeName: "paginate-type", input: { i } }],
            }),
          );
        }

        const page1 = await stateAdapter.listJobs({
          typeName: "paginate-type",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listJobs({
          typeName: "paginate-type",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).toBeNull();

        const allIds = [
          ...page1.items.map((view) => view.id),
          ...page2.items.map((view) => view.id),
        ];
        expect(new Set(allIds).size).toBe(4);
      },
    },
    {
      name: "listJobs sorts asc when orderDirection is asc",
      run: async ({ stateAdapter }, expect) => {
        const [chain1] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sort-asc", input: null }],
          }),
        );
        await sleep(5);
        const [chain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sort-asc", input: null }],
          }),
        );

        const result = await stateAdapter.listJobs({
          typeName: "sort-asc",
          orderBy: "createdAt",
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(2);
        expect(result.items[0].id).toBe(chain1.head.id);
        expect(result.items[1].id).toBe(chain2.head.id);
      },
    },
    {
      name: "listJobs filters by from/to date range",
      run: async ({ stateAdapter }, expect) => {
        const [chainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "range-type", input: null }],
          }),
        );
        await sleep(50);
        const [chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "range-type", input: null }],
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
        expect(after.items).toHaveLength(1);
        expect(after.items[0].typeName).toBe("range-type");

        const before = await stateAdapter.listJobs({
          typeName: "range-type",
          orderBy: "createdAt",
          to: midpoint,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(before.items).toHaveLength(1);
        expect(before.items[0].typeName).toBe("range-type");
      },
    },
    {
      name: "listJobs filters pending by from/to date range",
      run: async ({ stateAdapter }, expect) => {
        const [chainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "pending-range", input: null }],
          }),
        );
        await sleep(50);
        const [chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "pending-range", input: null }],
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
        expect(after.items).toHaveLength(1);
        expect(after.items[0].typeName).toBe("pending-range");

        const before = await stateAdapter.listJobs({
          typeName: "pending-range",
          status: "pending",
          to: midpoint,
          orderBy: "scheduledAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(before.items).toHaveLength(1);
        expect(before.items[0].typeName).toBe("pending-range");
      },
    },
    {
      name: "listJobs sorts running by attemptUntil",
      run: async ({ stateAdapter }, expect) => {
        const [chainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sort-until", input: null }],
          }),
        );
        const [chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sort-until", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["sort-until"],
          }),
        );
        await sleep(5);
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["sort-until"],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: chainA.head.id,
            workerId: "worker-1",
            timeoutMs: 5_000,
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: chainB.head.id,
            workerId: "worker-1",
            timeoutMs: 60_000,
          }),
        );

        const desc = await stateAdapter.listJobs({
          typeName: "sort-until",
          status: "running",
          orderBy: "attemptUntil",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(desc.items[0].id).toBe(chainB.head.id);
        expect(desc.items[1].id).toBe(chainA.head.id);

        const asc = await stateAdapter.listJobs({
          typeName: "sort-until",
          status: "running",
          orderBy: "attemptUntil",
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(asc.items[0].id).toBe(chainA.head.id);
        expect(asc.items[1].id).toBe(chainB.head.id);
      },
    },
    {
      name: "listJobs returns continuation jobs with correct status in multi-job chains",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "multi-step", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["multi-step"] }),
        );
        const [{ continuation: tail }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            completedBy: "w1",
            jobs: [{ typeName: "multi-step", continueFromId: headChain.head.id, input: null }],
          }),
        );

        // Head is completed (continued), tail is pending
        const completed = await stateAdapter.listJobs({
          typeName: "multi-step",
          orderBy: "completedAt",
          status: "completed",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(completed.items).toHaveLength(1);
        expect(completed.items[0].id).toBe(headChain.head.id);
        expect(completed.items[0].continuedToId).toBe(tail.id);

        const pending = await stateAdapter.listJobs({
          typeName: "multi-step",
          orderBy: "createdAt",
          status: "pending",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(pending.items.some((item) => item.id === tail.id)).toBe(true);

        // Complete the tail and verify both jobs appear correctly
        await sleep(5);
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["multi-step"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "w1",
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
        expect(allCompleted.items).toHaveLength(2);
        // tail completed last, so it should be first in desc order
        expect(allCompleted.items[0].id).toBe(tail.id);
        expect(allCompleted.items[1].id).toBe(headChain.head.id);
      },
    },
    {
      name: "non-transactional listJobs does not observe an uncommitted insert",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
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
              jobs: [{ typeName: "iso-list", input: null }],
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
        expect(items).toHaveLength(0);
      },
    },
  ],
};
