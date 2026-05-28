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
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "step-1",
                chainTypeName: "chain-type",
                input: null,
              },
            ],
          }),
        );
        const [{ job: step2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "step-2",
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
                typeName: "step-3",
                continueFromJobId: step2.id,
                input: null,
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
        expect(result.items[0].typeName).toBe("step-1");
        expect(result.items[1].typeName).toBe("step-2");
        expect(result.items[2].typeName).toBe("step-3");
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
                chainTypeName: "chain-type",
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
                typeName: "step-2",
                continueFromJobId: root.id,
                input: null,
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
        expect(result.items[0].typeName).toBe("step-2");
        expect(result.items[1].typeName).toBe("step-1");
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
                chainTypeName: "chain-type",
                input: null,
              },
            ],
          }),
        );
        let prevId = root.id;
        for (let i = 1; i < 5; i++) {
          const [{ job: next }] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: `step-${i}`,
                  continueFromJobId: prevId,
                  input: null,
                },
              ],
            }),
          );
          prevId = next.id;
        }

        const page1 = await stateAdapter.listChainJobs({
          chainId: root.chainId,
          orderDirection: "asc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();
        expect(page1.items[0].typeName).toBe("step-0");
        expect(page1.items[1].typeName).toBe("step-1");

        const page2 = await stateAdapter.listChainJobs({
          chainId: root.chainId,
          orderDirection: "asc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).not.toBeNull();
        expect(page2.items[0].typeName).toBe("step-2");
        expect(page2.items[1].typeName).toBe("step-3");

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
      name: "paginates with cursor in desc order",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "step-0",
                chainTypeName: "chain-type",
                input: null,
              },
            ],
          }),
        );
        let prevId = root.id;
        for (let i = 1; i < 5; i++) {
          const [{ job: next }] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: `step-${i}`,
                  continueFromJobId: prevId,
                  input: null,
                },
              ],
            }),
          );
          prevId = next.id;
        }

        const page1 = await stateAdapter.listChainJobs({
          chainId: root.chainId,
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();
        expect(page1.items[0].typeName).toBe("step-4");
        expect(page1.items[1].typeName).toBe("step-3");

        const page2 = await stateAdapter.listChainJobs({
          chainId: root.chainId,
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).not.toBeNull();
        expect(page2.items[0].typeName).toBe("step-2");
        expect(page2.items[1].typeName).toBe("step-1");

        const page3 = await stateAdapter.listChainJobs({
          chainId: root.chainId,
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
        const [{ job: chain1Root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "step-1",
                chainTypeName: "chain-type",
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
