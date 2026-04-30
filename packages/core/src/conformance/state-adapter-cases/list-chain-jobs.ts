import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

export const listChainJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
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
      name: "returns jobs ordered by chainIndex asc by default",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "step-1",
                chainId: undefined,
                chainTypeName: "chain-type",
                input: null,
                chainIndex: 0,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "step-2",
                chainId: root.chainId,
                chainTypeName: "chain-type",
                input: null,
                chainIndex: 1,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "step-3",
                chainId: root.chainId,
                chainTypeName: "chain-type",
                input: null,
                chainIndex: 2,
              },
            ],
          }),
        );

        const result = await stateAdapter.listChainJobs({
          chainId: root.chainId,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(3);
        expect(result.items[0].chainIndex).toBe(0);
        expect(result.items[1].chainIndex).toBe(1);
        expect(result.items[2].chainIndex).toBe(2);
      },
    },
    {
      name: "respects orderDirection desc",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "step-1",
                chainId: undefined,
                chainTypeName: "chain-type",
                input: null,
                chainIndex: 0,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "step-2",
                chainId: root.chainId,
                chainTypeName: "chain-type",
                input: null,
                chainIndex: 1,
              },
            ],
          }),
        );

        const result = await stateAdapter.listChainJobs({
          chainId: root.chainId,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(2);
        expect(result.items[0].chainIndex).toBe(1);
        expect(result.items[1].chainIndex).toBe(0);
      },
    },
    {
      name: "paginates with cursor",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "step-0",
                chainId: undefined,
                chainTypeName: "chain-type",
                input: null,
                chainIndex: 0,
              },
            ],
          }),
        );
        for (let i = 1; i < 5; i++) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: `step-${i}`,
                  chainId: root.chainId,
                  chainTypeName: "chain-type",
                  input: null,
                  chainIndex: i,
                },
              ],
            }),
          );
        }

        const page1 = await stateAdapter.listChainJobs({
          chainId: root.chainId,
          orderDirection: "asc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();
        expect(page1.items[0].chainIndex).toBe(0);
        expect(page1.items[1].chainIndex).toBe(1);

        const page2 = await stateAdapter.listChainJobs({
          chainId: root.chainId,
          orderDirection: "asc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).not.toBeNull();
        expect(page2.items[0].chainIndex).toBe(2);
        expect(page2.items[1].chainIndex).toBe(3);

        const page3 = await stateAdapter.listChainJobs({
          chainId: root.chainId,
          orderDirection: "asc",
          page: { limit: 2, cursor: page2.nextCursor! },
        });
        expect(page3.items).toHaveLength(1);
        expect(page3.nextCursor).toBeNull();
      },
    },
    {
      name: "only returns jobs from specified chain",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: chain1Root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "step-1",
                chainId: undefined,
                chainTypeName: "chain-type",
                input: null,
                chainIndex: 0,
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
                chainId: undefined,
                chainTypeName: "other-type",
                input: null,
                chainIndex: 0,
              },
            ],
          }),
        );

        const result = await stateAdapter.listChainJobs({
          chainId: chain1Root.chainId,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].id).toBe(chain1Root.id);
      },
    },
  ],
};
