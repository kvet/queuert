import { sleep } from "../../helpers/sleep.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const listBlockedJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "listBlockedJobs",
  cases: [
    {
      name: "listBlockedJobs returns jobs blocked by a chain",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker-type",
                chainTypeName: "blocker-type",
                input: null,
              },
            ],
          }),
        );
        const [{ job: blockedJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocked-type",
                chainTypeName: "blocked-type",
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
                typeName: "unrelated-type",
                chainTypeName: "unrelated-type",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: blockedJob.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );

        const result = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.chainId,
          orderDirection: "desc",
          page: { limit: 10 },
        });

        expect(result.items).toHaveLength(1);
        expect(result.items[0].id).toBe(blockedJob.id);
      },
    },
    {
      name: "listBlockedJobs returns empty page when no jobs are blocked",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: chain }] = await stateAdapter.withTransaction(async (txCtx) =>
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
        const result = await stateAdapter.listBlockedJobs({
          chainId: chain.chainId,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toEqual([]);
        expect(result.nextCursor).toBeNull();
      },
    },
    {
      name: "listBlockedJobs sorts asc when orderDirection is asc",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker-type",
                chainTypeName: "blocker-type",
                input: null,
              },
            ],
          }),
        );
        const [{ job: blockedJob1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocked-a",
                chainTypeName: "blocked-a",
                input: null,
              },
            ],
          }),
        );
        await sleep(5);
        const [{ job: blockedJob2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocked-b",
                chainTypeName: "blocked-b",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: blockedJob1.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: blockedJob2.id, blockedByChainIds: [blockerChain.chainId] }],
          }),
        );

        const desc = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.chainId,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        const asc = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.chainId,
          orderDirection: "asc",
          page: { limit: 10 },
        });

        expect(desc.items).toHaveLength(2);
        expect(asc.items).toHaveLength(2);
        expect(desc.items[0].id).toBe(blockedJob2.id);
        expect(desc.items[1].id).toBe(blockedJob1.id);
        expect(asc.items[0].id).toBe(blockedJob1.id);
        expect(asc.items[1].id).toBe(blockedJob2.id);
      },
    },
    {
      name: "listBlockedJobs paginates with cursor",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker-type",
                chainTypeName: "blocker-type",
                input: null,
              },
            ],
          }),
        );
        const blockedJobs = [];
        for (let i = 0; i < 4; i++) {
          const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: `blocked-${i}`,
                  chainTypeName: `blocked-${i}`,
                  input: null,
                },
              ],
            }),
          );
          blockedJobs.push(job);
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: job.id, blockedByChainIds: [blockerChain.chainId] }],
            }),
          );
        }

        const page1 = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.chainId,
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.chainId,
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).toBeNull();

        const allIds = [...page1.items.map((j) => j.id), ...page2.items.map((j) => j.id)];
        expect(new Set(allIds).size).toBe(4);
      },
    },
  ],
};
