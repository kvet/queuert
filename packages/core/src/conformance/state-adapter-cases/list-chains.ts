import { sleep } from "../../helpers/sleep.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const listChainsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "listChains",
  cases: [
    {
      name: "listChains returns empty page when no jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.listChains({
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
      name: "listChains filters independent (excludes chains used as blockers)",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: mainChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );

        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );

        const independentOnly = await stateAdapter.listChains({
          typeName: "task",
          orderBy: "createdAt",
          independent: true,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(independentOnly.items).toHaveLength(1);
        expect(independentOnly.items[0][0].id).toBe(mainChain.id);

        const all = await stateAdapter.listChains({
          typeName: "task",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(all.items).toHaveLength(2);
      },
    },
    {
      name: "listChains returns chains as [headJob, tailJob] pairs",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "test-chain", input: { step: 1 } }],
          }),
        );

        const { job: continuation } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "test-chain-step2",
              continueFromId: root.id,
              input: { step: 2 },
            },
          }),
        );

        const result = await stateAdapter.listChains({
          typeName: "test-chain",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);

        const [headJob, tailJob] = result.items[0];
        expect(headJob.id).toBe(root.id);
        expect(tailJob).toBeDefined();
        expect(tailJob!.id).toBe(continuation.id);
      },
    },
    {
      name: "listChains sorts by createdAt desc by default",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: job1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: { order: 1 } }],
          }),
        );
        await sleep(5);
        const [{ job: job2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: { order: 2 } }],
          }),
        );
        await sleep(5);
        const [{ job: job3 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: { order: 3 } }],
          }),
        );

        const result = await stateAdapter.listChains({
          typeName: "task",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(3);
        expect(result.items[0][0].id).toBe(job3.id);
        expect(result.items[1][0].id).toBe(job2.id);
        expect(result.items[2][0].id).toBe(job1.id);
      },
    },
    {
      name: "listChains paginates with cursor",
      run: async ({ stateAdapter }, expect) => {
        const jobs = [];
        for (let i = 0; i < 5; i++) {
          const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: [{ typeName: "task", input: null }],
            }),
          );
          jobs.push(job);
        }

        const page1 = await stateAdapter.listChains({
          typeName: "task",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listChains({
          typeName: "task",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).not.toBeNull();

        const page3 = await stateAdapter.listChains({
          typeName: "task",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2, cursor: page2.nextCursor! },
        });
        expect(page3.items).toHaveLength(1);
        expect(page3.nextCursor).toBeNull();

        const allIds = [
          ...page1.items.map(([r]) => r.id),
          ...page2.items.map(([r]) => r.id),
          ...page3.items.map(([r]) => r.id),
        ];
        expect(new Set(allIds).size).toBe(5);
      },
    },
    {
      name: "listChains sorts asc when orderDirection is asc",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: job1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );
        await sleep(5);
        const [{ job: job2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );

        const result = await stateAdapter.listChains({
          typeName: "task",
          orderBy: "createdAt",
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(2);
        expect(result.items[0][0].id).toBe(job1.id);
        expect(result.items[1][0].id).toBe(job2.id);
      },
    },
    {
      name: "listChains paginates correctly in asc order",
      run: async ({ stateAdapter }, expect) => {
        for (let i = 0; i < 3; i++) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: [{ typeName: "task", input: null }],
            }),
          );
          await sleep(5);
        }

        const page1 = await stateAdapter.listChains({
          typeName: "task",
          orderBy: "createdAt",
          orderDirection: "asc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listChains({
          typeName: "task",
          orderBy: "createdAt",
          orderDirection: "asc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(1);
        expect(page2.nextCursor).toBeNull();

        const allIds = [...page1.items.map(([r]) => r.id), ...page2.items.map(([r]) => r.id)];
        expect(new Set(allIds).size).toBe(3);
      },
    },
    {
      name: "listChains filters by from/to date range",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: jobA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );
        await sleep(50);
        const [{ job: jobB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );
        const midpoint = new Date((jobA.createdAt.getTime() + jobB.createdAt.getTime()) / 2);

        const after = await stateAdapter.listChains({
          typeName: "task",
          orderBy: "createdAt",
          from: midpoint,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(after.items).toHaveLength(1);
        expect(after.items[0][0].id).toBe(jobB.id);

        const before = await stateAdapter.listChains({
          typeName: "task",
          orderBy: "createdAt",
          to: midpoint,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(before.items).toHaveLength(1);
        expect(before.items[0][0].id).toBe(jobA.id);
      },
    },
    {
      name: "listChains sorts completed chains by completedAt when orderBy is completedAt",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: chainA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );
        await sleep(5);
        const [{ job: chainB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );

        // Start both jobs (oldest first)
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["task"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["task"] }),
        );

        // Complete chainB first, then chainA, to get different completedAt order
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: chainB.id,
            workerId: "w1",
            outcome: { output: null },
          }),
        );
        await sleep(5);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: chainA.id,
            workerId: "w1",
            outcome: { output: null },
          }),
        );

        const byCreatedAt = await stateAdapter.listChains({
          typeName: "task",
          status: "completed",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(byCreatedAt.items[0][0].id).toBe(chainB.id);
        expect(byCreatedAt.items[1][0].id).toBe(chainA.id);

        const byCompletedAt = await stateAdapter.listChains({
          typeName: "task",
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(byCompletedAt.items[0][0].id).toBe(chainA.id);
        expect(byCompletedAt.items[1][0].id).toBe(chainB.id);
      },
    },
    {
      name: "listChains paginates completed chains with createdAt ordering",
      run: async ({ stateAdapter }, expect) => {
        const chainIds: string[] = [];
        for (let i = 0; i < 3; i++) {
          const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: [{ typeName: "task", input: null }],
            }),
          );
          chainIds.push(job.id);
          await sleep(5);
        }

        for (const id of chainIds) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({
              txCtx,
              workerId: "w1",
              typeNames: ["task"],
            }),
          );
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.finishJobAttempt({
              txCtx,
              jobId: id,
              workerId: "w1",
              outcome: { output: null },
            }),
          );
        }

        const page1 = await stateAdapter.listChains({
          typeName: "task",
          status: "completed",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();
        expect(page1.items[0][0].id).toBe(chainIds[2]);
        expect(page1.items[1][0].id).toBe(chainIds[1]);

        const page2 = await stateAdapter.listChains({
          typeName: "task",
          status: "completed",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(1);
        expect(page2.nextCursor).toBeNull();
        expect(page2.items[0][0].id).toBe(chainIds[0]);

        const allIds = [...page1.items.map(([r]) => r.id), ...page2.items.map(([r]) => r.id)];
        expect(new Set(allIds).size).toBe(3);
      },
    },
    {
      name: "listChains paginates correctly with completedAt ordering",
      run: async ({ stateAdapter }, expect) => {
        const chainIds: string[] = [];
        for (let i = 0; i < 3; i++) {
          const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: [{ typeName: "task", input: null }],
            }),
          );
          chainIds.push(job.id);
        }

        for (const id of chainIds) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({
              txCtx,
              workerId: "w1",
              typeNames: ["task"],
            }),
          );
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.finishJobAttempt({
              txCtx,
              jobId: id,
              workerId: "w1",
              outcome: { output: null },
            }),
          );
          await sleep(5);
        }

        const page1 = await stateAdapter.listChains({
          typeName: "task",
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listChains({
          typeName: "task",
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(1);
        expect(page2.nextCursor).toBeNull();

        const allIds = [...page1.items.map(([r]) => r.id), ...page2.items.map(([r]) => r.id)];
        expect(new Set(allIds).size).toBe(3);
      },
    },
    {
      name: "listChains filters by status",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: chain1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "test-type", input: null }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "test-type", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "worker-1", typeNames: ["test-type"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: chain1.id,
            workerId: "w1",
            outcome: { output: null },
          }),
        );

        const completed = await stateAdapter.listChains({
          typeName: "test-type",
          orderBy: "completedAt",
          status: "completed",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(completed.items).toHaveLength(1);
        expect(completed.items[0][0].id).toBe(chain1.id);

        const running = await stateAdapter.listChains({
          typeName: "test-type",
          orderBy: "createdAt",
          status: "running",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(running.items).toHaveLength(1);
      },
    },
    {
      name: "listChains filters by non-independent",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: mainChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );

        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );

        const nonIndependent = await stateAdapter.listChains({
          typeName: "task",
          orderBy: "createdAt",
          independent: false,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(nonIndependent.items).toHaveLength(1);
        expect(nonIndependent.items[0][0].id).toBe(blockerChain.id);

        const independent = await stateAdapter.listChains({
          typeName: "task",
          orderBy: "createdAt",
          independent: true,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(independent.items).toHaveLength(1);
        expect(independent.items[0][0].id).toBe(mainChain.id);
      },
    },
    {
      name: "listChains filters running by independent",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: mainChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );
        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );
        const [{ job: otherChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["task"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["task"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["task"] }),
        );

        const independent = await stateAdapter.listChains({
          typeName: "task",
          status: "running",
          independent: true,
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(independent.items).toHaveLength(2);
        const independentIds = independent.items.map(([job]) => job.id).sort();
        expect(independentIds).toEqual([mainChain.id, otherChain.id].sort());

        const nonIndependent = await stateAdapter.listChains({
          typeName: "task",
          status: "running",
          independent: false,
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(nonIndependent.items).toHaveLength(1);
        expect(nonIndependent.items[0][0].id).toBe(blockerChain.id);
      },
    },
    {
      name: "listChains filters running by non-independent",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: mainChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );
        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["task"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["task"] }),
        );

        const result = await stateAdapter.listChains({
          typeName: "task",
          status: "running",
          independent: false,
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0][0].id).toBe(blockerChain.id);
      },
    },
    {
      name: "listChains paginates running chains with cursor",
      run: async ({ stateAdapter }, expect) => {
        const chainIds: string[] = [];
        for (let i = 0; i < 4; i++) {
          const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: [{ typeName: "task", input: null }],
            }),
          );
          chainIds.push(job.id);
          await sleep(5);
        }

        for (let i = 0; i < 4; i++) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["task"] }),
          );
        }

        const page1 = await stateAdapter.listChains({
          typeName: "task",
          status: "running",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listChains({
          typeName: "task",
          status: "running",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).toBeNull();

        const allIds = [...page1.items.map(([r]) => r.id), ...page2.items.map(([r]) => r.id)];
        expect(new Set(allIds).size).toBe(4);
      },
    },
    {
      name: "listChains filters completed by independent",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: mainChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );
        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );
        const [{ job: otherChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );

        for (const id of [mainChain.id, blockerChain.id, otherChain.id]) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["task"] }),
          );
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.finishJobAttempt({
              txCtx,
              jobId: id,
              workerId: "w1",
              outcome: { output: null },
            }),
          );
        }

        const independent = await stateAdapter.listChains({
          typeName: "task",
          status: "completed",
          independent: true,
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(independent.items).toHaveLength(2);
        const independentIds = independent.items.map(([job]) => job.id).sort();
        expect(independentIds).toEqual([mainChain.id, otherChain.id].sort());

        const nonIndependent = await stateAdapter.listChains({
          typeName: "task",
          status: "completed",
          independent: false,
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(nonIndependent.items).toHaveLength(1);
        expect(nonIndependent.items[0][0].id).toBe(blockerChain.id);
      },
    },
    {
      name: "listChains filters completed by non-independent",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: mainChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );
        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );

        for (const id of [mainChain.id, blockerChain.id]) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["task"] }),
          );
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.finishJobAttempt({
              txCtx,
              jobId: id,
              workerId: "w1",
              outcome: { output: null },
            }),
          );
        }

        const result = await stateAdapter.listChains({
          typeName: "task",
          status: "completed",
          independent: false,
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0][0].id).toBe(blockerChain.id);
      },
    },
    {
      name: "listChains paginates completed chains with completedAt cursor",
      run: async ({ stateAdapter }, expect) => {
        const chainIds: string[] = [];
        for (let i = 0; i < 4; i++) {
          const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: [{ typeName: "task", input: null }],
            }),
          );
          chainIds.push(job.id);
        }

        for (let i = 0; i < 4; i++) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["task"] }),
          );
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.finishJobAttempt({
              txCtx,
              jobId: chainIds[i],
              workerId: "w1",
              outcome: { output: null },
            }),
          );
          await sleep(5);
        }

        const page1 = await stateAdapter.listChains({
          typeName: "task",
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listChains({
          typeName: "task",
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).toBeNull();

        const allIds = [...page1.items.map(([r]) => r.id), ...page2.items.map(([r]) => r.id)];
        expect(new Set(allIds).size).toBe(4);
      },
    },
    {
      name: "listChains uses tail job completedAt for multi-job chain ordering",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );
        await sleep(5);
        const [{ job: headB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "task", input: null }],
          }),
        );

        // Start headA (oldest pending "task")
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["task"] }),
        );
        const { job: tailA } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: { typeName: "task-step2", continueFromId: headA.id, input: null },
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: headA.id,
            workerId: "w1",
            outcome: { continuedToId: tailA.id },
          }),
        );

        // Start headB (next pending "task")
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["task"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: headB.id,
            workerId: "w1",
            outcome: { output: null },
          }),
        );
        await sleep(5);

        // chainB is completed (single job done), chainA is still running (tail pending)
        const completedBeforeTail = await stateAdapter.listChains({
          typeName: "task",
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(completedBeforeTail.items).toHaveLength(1);
        expect(completedBeforeTail.items[0][0].id).toBe(headB.id);

        const running = await stateAdapter.listChains({
          typeName: "task",
          status: "running",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(running.items.some(([head]) => head.id === headA.id)).toBe(true);

        // Now complete chainA's tail — it should appear in completed with a later completedAt
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["task-step2"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: tailA.id,
            workerId: "w1",
            outcome: { output: null },
          }),
        );

        const completedAfterTail = await stateAdapter.listChains({
          typeName: "task",
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(completedAfterTail.items).toHaveLength(2);
        // chainA completed last (tail finished after chainB), so it should be first in desc order
        expect(completedAfterTail.items[0][0].id).toBe(headA.id);
        expect(completedAfterTail.items[1][0].id).toBe(headB.id);
      },
    },
    {
      name: "non-transactional listChains does not observe an uncommitted chain creation",
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
            await stateAdapter.createChains({
              txCtx,
              jobs: [{ typeName: "iso-list-chains", input: null }],
            });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const listPromise = stateAdapter.listChains({
          typeName: "iso-list-chains",
          orderBy: "createdAt",
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
