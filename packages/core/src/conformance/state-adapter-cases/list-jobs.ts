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
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-type",
                chainTypeName: "chain-type",
                input: { step: 1 },
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-step2",
                continueFromJobId: root.id,
                input: { step: 2 },
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

        const result = await stateAdapter.listJobs({
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(3);
      },
    },
    {
      name: "listJobs filters by chainId",
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
        await stateAdapter.withTransaction(async (txCtx) =>
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

        const result = await stateAdapter.listJobs({
          filter: { chainId: [root.chainId] },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(2);
        for (const job of result.items) {
          expect(job.chainId).toBe(root.chainId);
        }
      },
    },
    {
      name: "listJobs filters by status",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
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
          stateAdapter.completeJob({ txCtx, jobId: job.id, output: null, workerId: "w1" }),
        );

        const result = await stateAdapter.listJobs({
          filter: { statePredicates: [{ completed: true, succeeded: false }] },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].id).toBe(job.id);
      },
    },
    {
      name: "listJobs filters by typeName",
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

        const result = await stateAdapter.listJobs({
          filter: { typeName: ["type-a"] },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].typeName).toBe("type-a");
      },
    },
    {
      name: "listJobs filters by chainTypeName",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "root-a",
                chainTypeName: "root-a",
                input: null,
              },
            ],
          }),
        );
        const [{ job: rootB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "root-b",
                chainTypeName: "root-b",
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
                typeName: "child-b",
                continueFromJobId: rootB.id,
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listJobs({
          filter: { chainTypeName: ["root-b"] },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(2);
        for (const job of result.items) {
          expect(job.chainTypeName).toBe("root-b");
        }
      },
    },
    {
      name: "listJobs filters by id matching job ID",
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

        const result = await stateAdapter.listJobs({
          filter: { jobId: [job1.id] },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].id).toBe(job1.id);
      },
    },
    {
      name: "listJobs paginates with cursor",
      run: async ({ stateAdapter }, expect) => {
        for (let i = 0; i < 4; i++) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "paginate-type",
                  chainTypeName: "paginate-type",
                  input: { i },
                },
              ],
            }),
          );
        }

        const page1 = await stateAdapter.listJobs({ orderDirection: "desc", page: { limit: 2 } });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listJobs({
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).toBeNull();

        const allIds = [...page1.items.map((j) => j.id), ...page2.items.map((j) => j.id)];
        expect(new Set(allIds).size).toBe(4);
      },
    },
    {
      name: "listJobs sorts asc when orderDirection is asc",
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

        const result = await stateAdapter.listJobs({
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(2);
        expect(result.items[0].id).toBe(job1.id);
        expect(result.items[1].id).toBe(job2.id);
      },
    },
    {
      name: "listJobs filters by from/to date range",
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

        const after = await stateAdapter.listJobs({
          filter: { from: midpoint },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(after.items).toHaveLength(1);
        expect(after.items[0].typeName).toBe("type-b");

        const before = await stateAdapter.listJobs({
          filter: { to: midpoint },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(before.items).toHaveLength(1);
        expect(before.items[0].typeName).toBe("type-a");
      },
    },
  ],
};
