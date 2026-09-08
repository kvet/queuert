import { type ConformanceGroup } from "../runner.js";
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
        const [rootChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "step-1", input: null }],
          }),
        );
        const [{ continuation: step2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "step-2",
                continueFromId: rootChain.head.id,
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "step-3",
                continueFromId: step2.id,
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listChainJobs({
          chainId: rootChain.head.chainId,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(3);
        expect(result.items[0].typeName).toBe("step-1");
        expect(result.items[1].typeName).toBe("step-2");
        expect(result.items[2].typeName).toBe("step-3");
        expect(result.items.map((item) => item.chain.id)).toEqual([
          rootChain.head.chainId,
          rootChain.head.chainId,
          rootChain.head.chainId,
        ]);
        expect(result.items[0].chain.typeName).toBe("step-1");
      },
    },
    {
      name: "respects orderDirection desc",
      run: async ({ stateAdapter }, expect) => {
        const [rootChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "step-1", input: null }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "step-2",
                continueFromId: rootChain.head.id,
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listChainJobs({
          chainId: rootChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(2);
        expect(result.items[0].typeName).toBe("step-2");
        expect(result.items[1].typeName).toBe("step-1");
      },
    },
    {
      name: "paginates with cursor",
      run: async ({ stateAdapter }, expect) => {
        const [rootChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "step-0", input: null }],
          }),
        );
        let prevId = rootChain.head.id;
        for (let i = 1; i < 5; i++) {
          const [{ continuation: next }] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  typeName: `step-${i}`,
                  continueFromId: prevId,
                  input: null,
                },
              ],
            }),
          );
          prevId = next.id;
        }

        const page1 = await stateAdapter.listChainJobs({
          chainId: rootChain.head.chainId,
          orderDirection: "asc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();
        expect(page1.items[0].typeName).toBe("step-0");
        expect(page1.items[1].typeName).toBe("step-1");

        const page2 = await stateAdapter.listChainJobs({
          chainId: rootChain.head.chainId,
          orderDirection: "asc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).not.toBeNull();
        expect(page2.items[0].typeName).toBe("step-2");
        expect(page2.items[1].typeName).toBe("step-3");

        const page3 = await stateAdapter.listChainJobs({
          chainId: rootChain.head.chainId,
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
        const [rootChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "step-0", input: null }],
          }),
        );
        let prevId = rootChain.head.id;
        for (let i = 1; i < 5; i++) {
          const [{ continuation: next }] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  typeName: `step-${i}`,
                  continueFromId: prevId,
                  input: null,
                },
              ],
            }),
          );
          prevId = next.id;
        }

        const page1 = await stateAdapter.listChainJobs({
          chainId: rootChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();
        expect(page1.items[0].typeName).toBe("step-4");
        expect(page1.items[1].typeName).toBe("step-3");

        const page2 = await stateAdapter.listChainJobs({
          chainId: rootChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).not.toBeNull();
        expect(page2.items[0].typeName).toBe("step-2");
        expect(page2.items[1].typeName).toBe("step-1");

        const page3 = await stateAdapter.listChainJobs({
          chainId: rootChain.head.chainId,
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
        const [chain1] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "step-1", input: null }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "other-type", input: null }],
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
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const [seedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "iso-chain-jobs-root", input: null }],
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
