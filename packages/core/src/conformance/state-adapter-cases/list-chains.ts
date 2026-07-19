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
            jobs: [
              {
                typeName: "main-chain",
                chainTypeName: "main-chain",
                input: null,
              },
            ],
          }),
        );

        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "blocker-chain",
                chainTypeName: "blocker-chain",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );

        const independentOnly = await stateAdapter.listChains({
          orderBy: "createdAt",
          independent: true,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(independentOnly.items).toHaveLength(1);
        expect(independentOnly.items[0][0].typeName).toBe("main-chain");

        const all = await stateAdapter.listChains({
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
            jobs: [
              {
                typeName: "test-chain",
                chainTypeName: "test-chain",
                input: { step: 1 },
              },
            ],
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
      name: "listChains filters by typeName",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "send-email",
                chainTypeName: "send-email",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "process-payment",
                chainTypeName: "process-payment",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "send-email",
                chainTypeName: "send-email",
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listChains({
          orderBy: "createdAt",
          typeName: ["send-email"],
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(2);
        for (const [headJob] of result.items) {
          expect(headJob.typeName).toBe("send-email");
        }
      },
    },
    {
      name: "listChains sorts by createdAt desc by default",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: job1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-a",
                chainTypeName: "type-a",
                input: { order: 1 },
              },
            ],
          }),
        );
        await sleep(5);
        const [{ job: job2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-b",
                chainTypeName: "type-b",
                input: { order: 2 },
              },
            ],
          }),
        );
        await sleep(5);
        const [{ job: job3 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-c",
                chainTypeName: "type-c",
                input: { order: 3 },
              },
            ],
          }),
        );

        const result = await stateAdapter.listChains({
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
              jobs: [
                {
                  typeName: `type-${i}`,
                  chainTypeName: `type-${i}`,
                  input: null,
                },
              ],
            }),
          );
          jobs.push(job);
        }

        const page1 = await stateAdapter.listChains({
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listChains({
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).not.toBeNull();

        const page3 = await stateAdapter.listChains({
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
      name: "listChains filters by id matching chain ID",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: chain1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-a",
                chainTypeName: "type-a",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-b",
                chainTypeName: "type-b",
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listChains({
          orderBy: "createdAt",
          chainId: [chain1.chainId],
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0][0].id).toBe(chain1.id);
      },
    },
    {
      name: "listChains sorts asc when orderDirection is asc",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: job1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-a",
                chainTypeName: "type-a",
                input: null,
              },
            ],
          }),
        );
        await sleep(5);
        const [{ job: job2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-b",
                chainTypeName: "type-b",
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listChains({
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
              jobs: [
                {
                  typeName: `type-${i}`,
                  chainTypeName: `type-${i}`,
                  input: null,
                },
              ],
            }),
          );
          await sleep(5);
        }

        const page1 = await stateAdapter.listChains({
          orderBy: "createdAt",
          orderDirection: "asc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listChains({
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
            jobs: [
              {
                typeName: "type-a",
                chainTypeName: "type-a",
                input: null,
              },
            ],
          }),
        );
        await sleep(50);
        const [{ job: jobB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-b",
                chainTypeName: "type-b",
                input: null,
              },
            ],
          }),
        );
        const midpoint = new Date((jobA.createdAt.getTime() + jobB.createdAt.getTime()) / 2);

        const after = await stateAdapter.listChains({
          orderBy: "createdAt",
          from: midpoint,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(after.items).toHaveLength(1);
        expect(after.items[0][0].typeName).toBe("type-b");

        const before = await stateAdapter.listChains({
          orderBy: "createdAt",
          to: midpoint,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(before.items).toHaveLength(1);
        expect(before.items[0][0].typeName).toBe("type-a");
      },
    },
    {
      name: "listChains sorts completed chains by completedAt when orderBy is completedAt",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: chainA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-a",
                chainTypeName: "type-a",
                input: null,
              },
            ],
          }),
        );
        await sleep(5);
        const [{ job: chainB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-b",
                chainTypeName: "type-b",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["type-b"] }),
        );
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
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["type-a"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: chainA.id,
            workerId: "w1",
            outcome: { output: null },
          }),
        );

        const byCreatedAt = await stateAdapter.listChains({
          status: "completed",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(byCreatedAt.items[0][0].id).toBe(chainB.id);
        expect(byCreatedAt.items[1][0].id).toBe(chainA.id);

        const byCompletedAt = await stateAdapter.listChains({
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
              jobs: [
                {
                  typeName: `type-${i}`,
                  chainTypeName: `type-${i}`,
                  input: null,
                },
              ],
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
              typeNames: [`type-${chainIds.indexOf(id)}`],
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
              jobs: [
                {
                  typeName: `type-${i}`,
                  chainTypeName: `type-${i}`,
                  input: null,
                },
              ],
            }),
          );
          chainIds.push(job.id);
        }

        for (const id of chainIds) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({
              txCtx,
              workerId: "w1",
              typeNames: [`type-${chainIds.indexOf(id)}`],
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
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listChains({
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
            jobs: [
              {
                typeName: "test-type",
                chainTypeName: "test-type",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "test-type",
                chainTypeName: "test-type",
                input: null,
              },
            ],
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
          orderBy: "completedAt",
          status: "completed",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(completed.items).toHaveLength(1);
        expect(completed.items[0][0].id).toBe(chain1.id);

        const running = await stateAdapter.listChains({
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
            jobs: [
              {
                typeName: "main-chain",
                chainTypeName: "main-chain",
                input: null,
              },
            ],
          }),
        );

        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "blocker-chain",
                chainTypeName: "blocker-chain",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );

        const nonIndependent = await stateAdapter.listChains({
          orderBy: "createdAt",
          independent: false,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(nonIndependent.items).toHaveLength(1);
        expect(nonIndependent.items[0][0].typeName).toBe("blocker-chain");

        const independent = await stateAdapter.listChains({
          orderBy: "createdAt",
          independent: true,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(independent.items).toHaveLength(1);
        expect(independent.items[0][0].typeName).toBe("main-chain");
      },
    },
    {
      name: "listChains filters by typeName and independent",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: chainA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "combo-a",
                chainTypeName: "combo-a",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "combo-b",
                chainTypeName: "combo-b",
                input: null,
              },
            ],
          }),
        );
        const [{ job: chainC }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "combo-a",
                chainTypeName: "combo-a",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: chainA.id, blockedByChainIds: [chainC.chainId] }],
          }),
        );

        const independent = await stateAdapter.listChains({
          orderBy: "createdAt",
          typeName: ["combo-a"],
          independent: true,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(independent.items).toHaveLength(1);
        expect(independent.items[0][0].id).toBe(chainA.id);

        const nonIndependent = await stateAdapter.listChains({
          orderBy: "createdAt",
          typeName: ["combo-a"],
          independent: false,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(nonIndependent.items).toHaveLength(1);
        expect(nonIndependent.items[0][0].id).toBe(chainC.id);
      },
    },
    {
      name: "listChains filters running by typeName",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "run-a",
                chainTypeName: "run-a",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "run-b",
                chainTypeName: "run-b",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["run-a"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["run-b"] }),
        );

        const result = await stateAdapter.listChains({
          status: "running",
          typeName: ["run-a"],
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0][0].typeName).toBe("run-a");
      },
    },
    {
      name: "listChains filters running by independent",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: mainChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "main-run",
                chainTypeName: "main-run",
                input: null,
              },
            ],
          }),
        );
        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "blocker-run",
                chainTypeName: "blocker-run",
                input: null,
              },
            ],
          }),
        );
        const [{ job: otherChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "other-run",
                chainTypeName: "other-run",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["main-run"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["blocker-run"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["other-run"] }),
        );

        const independent = await stateAdapter.listChains({
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
      name: "listChains filters running by typeName and independent",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: chainA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "ri-type",
                chainTypeName: "ri-type",
                input: null,
              },
            ],
          }),
        );
        const [{ job: chainB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "ri-type",
                chainTypeName: "ri-type",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "other",
                chainTypeName: "other",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: chainA.id, blockedByChainIds: [chainB.chainId] }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["ri-type"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["ri-type"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["other"] }),
        );

        const independent = await stateAdapter.listChains({
          status: "running",
          typeName: ["ri-type"],
          independent: true,
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(independent.items).toHaveLength(1);
        expect(independent.items[0][0].id).toBe(chainA.id);

        const nonIndependent = await stateAdapter.listChains({
          status: "running",
          typeName: ["ri-type"],
          independent: false,
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(nonIndependent.items).toHaveLength(1);
        expect(nonIndependent.items[0][0].id).toBe(chainB.id);
      },
    },
    {
      name: "listChains filters running by non-independent",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: mainChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "main-nr",
                chainTypeName: "main-nr",
                input: null,
              },
            ],
          }),
        );
        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "blocker-nr",
                chainTypeName: "blocker-nr",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["main-nr"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["blocker-nr"] }),
        );

        const result = await stateAdapter.listChains({
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
              jobs: [
                {
                  typeName: `run-page-${i}`,
                  chainTypeName: `run-page-${i}`,
                  input: null,
                },
              ],
            }),
          );
          chainIds.push(job.id);
          await sleep(5);
        }

        for (let i = 0; i < 4; i++) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: [`run-page-${i}`] }),
          );
        }

        const page1 = await stateAdapter.listChains({
          status: "running",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listChains({
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
      name: "listChains filters completed by typeName",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: chainA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "comp-a",
                chainTypeName: "comp-a",
                input: null,
              },
            ],
          }),
        );
        const [{ job: chainB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "comp-b",
                chainTypeName: "comp-b",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["comp-a"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: chainA.id,
            workerId: "w1",
            outcome: { output: null },
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["comp-b"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: chainB.id,
            workerId: "w1",
            outcome: { output: null },
          }),
        );

        const result = await stateAdapter.listChains({
          status: "completed",
          typeName: ["comp-a"],
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0][0].id).toBe(chainA.id);
      },
    },
    {
      name: "listChains filters completed by independent",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: mainChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "main-comp",
                chainTypeName: "main-comp",
                input: null,
              },
            ],
          }),
        );
        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "blocker-comp",
                chainTypeName: "blocker-comp",
                input: null,
              },
            ],
          }),
        );
        const [{ job: otherChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "other-comp",
                chainTypeName: "other-comp",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );

        for (const [id, typeName] of [
          [mainChain.id, "main-comp"],
          [blockerChain.id, "blocker-comp"],
          [otherChain.id, "other-comp"],
        ] as const) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: [typeName] }),
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
            jobs: [
              {
                typeName: "main-comp-nr",
                chainTypeName: "main-comp-nr",
                input: null,
              },
            ],
          }),
        );
        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "blocker-comp-nr",
                chainTypeName: "blocker-comp-nr",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );

        for (const [id, typeName] of [
          [mainChain.id, "main-comp-nr"],
          [blockerChain.id, "blocker-comp-nr"],
        ] as const) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: [typeName] }),
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
      name: "listChains filters completed by typeName and independent",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: chainA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "ci-type",
                chainTypeName: "ci-type",
                input: null,
              },
            ],
          }),
        );
        const [{ job: chainB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "ci-type",
                chainTypeName: "ci-type",
                input: null,
              },
            ],
          }),
        );
        const [{ job: chainC }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "other",
                chainTypeName: "other",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: chainA.id, blockedByChainIds: [chainB.chainId] }],
          }),
        );

        for (const [id, typeName] of [
          [chainA.id, "ci-type"],
          [chainB.id, "ci-type"],
          [chainC.id, "other"],
        ] as const) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: [typeName] }),
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
          status: "completed",
          typeName: ["ci-type"],
          independent: true,
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(independent.items).toHaveLength(1);
        expect(independent.items[0][0].id).toBe(chainA.id);

        const nonIndependent = await stateAdapter.listChains({
          status: "completed",
          typeName: ["ci-type"],
          independent: false,
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(nonIndependent.items).toHaveLength(1);
        expect(nonIndependent.items[0][0].id).toBe(chainB.id);
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
              jobs: [
                {
                  typeName: `comp-page-${i}`,
                  chainTypeName: `comp-page-${i}`,
                  input: null,
                },
              ],
            }),
          );
          chainIds.push(job.id);
        }

        for (let i = 0; i < 4; i++) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: [`comp-page-${i}`] }),
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
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listChains({
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
            jobs: [
              {
                typeName: "multi-a",
                chainTypeName: "multi-a",
                input: null,
              },
            ],
          }),
        );
        await sleep(5);
        const [{ job: headB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "multi-b",
                chainTypeName: "multi-b",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["multi-a"] }),
        );
        const { job: tailA } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: { typeName: "multi-a-step2", continueFromId: headA.id, input: null },
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["multi-b"] }),
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
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(completedBeforeTail.items).toHaveLength(1);
        expect(completedBeforeTail.items[0][0].id).toBe(headB.id);

        const running = await stateAdapter.listChains({
          status: "running",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(running.items.some(([head]) => head.id === headA.id)).toBe(true);

        // Now complete chainA's tail — it should appear in completed with a later completedAt
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["multi-a-step2"] }),
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
              jobs: [
                {
                  typeName: "iso-list-chains",
                  chainTypeName: "iso-list-chains",
                  input: null,
                },
              ],
            });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const listPromise = stateAdapter.listChains({
          orderBy: "createdAt",
          typeName: ["iso-list-chains"],
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
