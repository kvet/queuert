import { sleep } from "../../helpers/sleep.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const listBlockedJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "listBlockedJobs",
  cases: [
    {
      name: "listBlockedJobs returns jobs blocked by a chain",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker-type", input: null }],
          }),
        );
        const [blockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocked-type", input: null }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "unrelated-type", input: null }],
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

        const result = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 10 },
        });

        expect(result.items).toHaveLength(1);
        expect(result.items[0].id).toBe(blockedChain.head.id);
      },
    },
    {
      name: "listBlockedJobs returns empty page when no jobs are blocked",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "test-type", input: null }],
          }),
        );
        const result = await stateAdapter.listBlockedJobs({
          chainId: stateChain.head.chainId,
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
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker-type", input: null }],
          }),
        );
        const [blockedChain1] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocked-a", input: null }],
          }),
        );
        await sleep(5);
        const [blockedChain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocked-b", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: blockedChain1.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: blockedChain2.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        const desc = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        const asc = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.head.chainId,
          orderDirection: "asc",
          page: { limit: 10 },
        });

        expect(desc.items).toHaveLength(2);
        expect(asc.items).toHaveLength(2);
        expect(desc.items[0].id).toBe(blockedChain2.head.id);
        expect(desc.items[1].id).toBe(blockedChain1.head.id);
        expect(asc.items[0].id).toBe(blockedChain1.head.id);
        expect(asc.items[1].id).toBe(blockedChain2.head.id);
      },
    },
    {
      name: "listBlockedJobs paginates with cursor",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker-type", input: null }],
          }),
        );
        const blockedChains = [];
        for (let i = 0; i < 4; i++) {
          const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ typeName: `blocked-${i}`, input: null }],
            }),
          );
          blockedChains.push(stateChain);
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: stateChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            }),
          );
        }

        const page1 = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).toBeNull();

        const allIds = [
          ...page1.items.map((item) => item.id),
          ...page2.items.map((item) => item.id),
        ];
        expect(new Set(allIds).size).toBe(4);
      },
    },
    {
      name: "non-transactional listBlockedJobs does not observe an uncommitted blocker insert",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "iso-listblocked-src", input: null }],
          }),
        );
        const [targetChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "iso-listblocked-target", input: null }],
          }),
        );

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
            await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: targetChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const listPromise = stateAdapter.listBlockedJobs({
          chainId: blockerChain.head.chainId,
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
