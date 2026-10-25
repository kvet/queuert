import { type ConformanceGroup } from "../runner.js";
import { asyncOnly, transaction } from "../transaction.js";
import { type StateConformanceFixture } from "./types.js";

export const listChainJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "listChainJobs",
  cases: [
    {
      name: "returns empty page for nonexistent chain",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.listChainJobs({
          chainId: crypto.randomUUID(),
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(result.items).toEqual([]);
        expect(result.nextCursor).toBeNull();
      },
    },
    {
      name: "returns jobs in chain order asc by default",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "step-1", input: null }],
          }),
        );
        const [continuedStep2] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "step-2",
                continueFromId: headChain.head.id,
                input: null,
              },
            ],
          }),
        );
        const { continuation: step2 } = continuedStep2!;
        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "step-3",
                continueFromId: step2.id,
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listChainJobs({
          chainId: headChain.head.chainId,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(3);
        expect(result.items[0].typeName).toBe("step-1");
        expect(result.items[1].typeName).toBe("step-2");
        expect(result.items[2].typeName).toBe("step-3");
        expect(result.items.map((item) => item.chainIndex)).toEqual([0, 1, 2]);
        expect(result.items.map((item) => item.chain.id)).toEqual([
          headChain.head.chainId,
          headChain.head.chainId,
          headChain.head.chainId,
        ]);
        expect(result.items[0].chain.typeName).toBe("step-1");
      },
    },
    {
      name: "respects orderDirection desc",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "step-1", input: null }],
          }),
        );
        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "step-2",
                continueFromId: headChain.head.id,
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listChainJobs({
          chainId: headChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(2);
        expect(result.items[0].typeName).toBe("step-2");
        expect(result.items[1].typeName).toBe("step-1");
        expect(result.items.map((item) => item.chainIndex)).toEqual([1, 0]);
      },
    },
    {
      name: "paginates with cursor",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "step-0", input: null }],
          }),
        );
        let prevId = headChain.head.id;
        for (let i = 1; i < 5; i++) {
          const [continuedNext] = await transaction(stateAdapter, (txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateId(),
                  typeName: `step-${i}`,
                  continueFromId: prevId,
                  input: null,
                },
              ],
            }),
          );
          const { continuation: next } = continuedNext!;
          prevId = next.id;
        }

        const page1 = await stateAdapter.listChainJobs({
          chainId: headChain.head.chainId,
          orderDirection: "asc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();
        expect(page1.items[0].typeName).toBe("step-0");
        expect(page1.items[1].typeName).toBe("step-1");
        expect(page1.items.map((item) => item.chainIndex)).toEqual([0, 1]);

        const page2 = await stateAdapter.listChainJobs({
          chainId: headChain.head.chainId,
          orderDirection: "asc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).not.toBeNull();
        expect(page2.items[0].typeName).toBe("step-2");
        expect(page2.items[1].typeName).toBe("step-3");
        expect(page2.items.map((item) => item.chainIndex)).toEqual([2, 3]);

        const page3 = await stateAdapter.listChainJobs({
          chainId: headChain.head.chainId,
          orderDirection: "asc",
          page: { limit: 2, cursor: page2.nextCursor! },
        });
        expect(page3.items).toHaveLength(1);
        expect(page3.nextCursor).toBeNull();
      },
    },
    {
      name: "paginates with cursor in desc order",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "step-0", input: null }],
          }),
        );
        let prevId = headChain.head.id;
        for (let i = 1; i < 5; i++) {
          const [continuedNext] = await transaction(stateAdapter, (txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateId(),
                  typeName: `step-${i}`,
                  continueFromId: prevId,
                  input: null,
                },
              ],
            }),
          );
          const { continuation: next } = continuedNext!;
          prevId = next.id;
        }

        const page1 = await stateAdapter.listChainJobs({
          chainId: headChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();
        expect(page1.items[0].typeName).toBe("step-4");
        expect(page1.items[1].typeName).toBe("step-3");

        const page2 = await stateAdapter.listChainJobs({
          chainId: headChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).not.toBeNull();
        expect(page2.items[0].typeName).toBe("step-2");
        expect(page2.items[1].typeName).toBe("step-1");

        const page3 = await stateAdapter.listChainJobs({
          chainId: headChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 2, cursor: page2.nextCursor! },
        });
        expect(page3.items).toHaveLength(1);
        expect(page3.items[0].typeName).toBe("step-0");
        expect(page3.nextCursor).toBeNull();
      },
    },
    {
      name: "only returns jobs from specified chain",
      run: async ({ stateAdapter }, expect) => {
        const [chain1] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "step-1", input: null }],
          }),
        );
        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "other-type", input: null }],
          }),
        );

        const result = await stateAdapter.listChainJobs({
          chainId: chain1.head.chainId,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].id).toBe(chain1.head.id);
      },
    },
    {
      name: "non-transactional listChainJobs does not observe an uncommitted continuation",
      run: async ({ stateAdapter: fixtureStateAdapter, transactionConcurrency }, expect) => {
        const stateAdapter = asyncOnly(fixtureStateAdapter, expect);
        if (transactionConcurrency !== "concurrent") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const [seedChain] = await transaction(stateAdapter, async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "iso-chain-jobs-head",
                input: null,
              },
            ],
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
            await stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateId(),
                  typeName: "iso-chain-jobs-cont",
                  continueFromId: seedChain.head.id,
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
        const listPromise = stateAdapter.listChainJobs({
          chainId: seedChain.head.chainId,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        release!();
        await txPromise;

        const { items } = await listPromise;
        expect(items).toHaveLength(1);
        expect(items[0]?.id).toBe(seedChain.head.id);
      },
    },
  ],
};
