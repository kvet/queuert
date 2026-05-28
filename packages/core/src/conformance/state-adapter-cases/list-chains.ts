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
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toEqual([]);
        expect(result.nextCursor).toBeNull();
      },
    },
    {
      name: "listChains filters rootOnly (excludes chains used as blockers)",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: mainChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
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
          stateAdapter.createJobs({
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

        const rootOnly = await stateAdapter.listChains({
          filter: { rootOnly: true },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(rootOnly.items).toHaveLength(1);
        expect(rootOnly.items[0][0].typeName).toBe("main-chain");

        const all = await stateAdapter.listChains({
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(all.items).toHaveLength(2);
      },
    },
    {
      name: "listChains returns chains as [rootJob, lastJob] pairs",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
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

        const [{ job: continuation }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "test-chain-step2",
                continueFromJobId: root.id,
                input: { step: 2 },
              },
            ],
          }),
        );

        const result = await stateAdapter.listChains({
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);

        const [rootJob, lastJob] = result.items[0];
        expect(rootJob.id).toBe(root.id);
        expect(lastJob).toBeDefined();
        expect(lastJob!.id).toBe(continuation.id);
      },
    },
    {
      name: "listChains filters by typeName",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
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
          stateAdapter.createJobs({
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
          stateAdapter.createJobs({
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
          filter: { typeName: ["send-email"] },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(2);
        for (const [rootJob] of result.items) {
          expect(rootJob.typeName).toBe("send-email");
        }
      },
    },
    {
      name: "listChains sorts by createdAt desc by default",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: job1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
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
          stateAdapter.createJobs({
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
          stateAdapter.createJobs({
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
            stateAdapter.createJobs({
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
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listChains({
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).not.toBeNull();

        const page3 = await stateAdapter.listChains({
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
          stateAdapter.createJobs({
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
          stateAdapter.createJobs({
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
          filter: { chainId: [chain1.chainId] },
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
          stateAdapter.createJobs({
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
          stateAdapter.createJobs({
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
            stateAdapter.createJobs({
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
          orderDirection: "asc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listChains({
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
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
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
        const midpoint = new Date();
        await sleep(50);
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
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

        const after = await stateAdapter.listChains({
          filter: { from: midpoint },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(after.items).toHaveLength(1);
        expect(after.items[0][0].typeName).toBe("type-b");

        const before = await stateAdapter.listChains({
          filter: { to: midpoint },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(before.items).toHaveLength(1);
        expect(before.items[0][0].typeName).toBe("type-a");
      },
    },
    {
      name: "listChains filters by jobId",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-type",
                chainTypeName: "chain-type",
                input: null,
              },
            ],
          }),
        );
        const [{ job: continuation }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-step2",
                continueFromJobId: root.id,
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "other-type",
                chainTypeName: "other-type",
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listChains({
          filter: { jobId: [continuation.id] },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0][0].id).toBe(root.id);
      },
    },
    {
      name: "listChains filters by status",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: chain1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
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
          stateAdapter.createJobs({
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
          stateAdapter.acquireJob({
            txCtx,
            typeNames: ["test-type"],
            workerId: "conformance-worker",
            leaseDurationMs: 30_000,
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJob({ txCtx, jobId: chain1.id, output: null, workerId: "w1" }),
        );

        const completed = await stateAdapter.listChains({
          filter: { closed: true },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(completed.items).toHaveLength(1);
        expect(completed.items[0][0].id).toBe(chain1.id);

        const open = await stateAdapter.listChains({
          filter: { closed: false },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(open.items).toHaveLength(1);
      },
    },
  ],
};
