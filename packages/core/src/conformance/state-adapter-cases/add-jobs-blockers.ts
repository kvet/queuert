import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

export const addJobsBlockersGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "addJobsBlockers",
  cases: [
    {
      name: "adds blockers and returns incomplete blocker chain IDs",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "blocker",
                input: null,
              },
            ],
          }),
        );

        const [{ job: mainJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "main",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "main",
                input: null,
              },
            ],
          }),
        );

        const [{ job: updatedMain, incompleteBlockerChainIds, blockerChainTraceContexts }] =
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainJob.id, blockedByChainIds: [blockerJob.chainId] }],
            }),
          );

        expect(updatedMain.status).toBe("blocked");
        expect(incompleteBlockerChainIds).toContain(blockerJob.chainId);
        expect(blockerChainTraceContexts).toHaveLength(1);
        expect(blockerChainTraceContexts[0]).toBeNull();
      },
    },
    {
      name: "returns empty incompleteBlockerChainIds when all blockers are completed",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "blocker",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJob({
            txCtx,
            jobId: blockerJob.id,
            output: null,
            workerId: null,
          }),
        );

        const [{ job: mainJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "main",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "main",
                input: null,
              },
            ],
          }),
        );

        const [{ job: updatedMain, incompleteBlockerChainIds, blockerChainTraceContexts }] =
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainJob.id, blockedByChainIds: [blockerJob.chainId] }],
            }),
          );

        expect(updatedMain.status).toBe("pending");
        expect(incompleteBlockerChainIds).toHaveLength(0);
        expect(blockerChainTraceContexts).toHaveLength(1);
        expect(blockerChainTraceContexts[0]).toBeNull();
      },
    },
    {
      name: "adds blockers to multiple jobs in a single batch",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blocker1 }, { job: blocker2 }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "blocker",
                  chainId: undefined,
                  chainIndex: 0,
                  chainTypeName: "blocker",
                  input: null,
                },
                {
                  typeName: "blocker",
                  chainId: undefined,
                  chainIndex: 0,
                  chainTypeName: "blocker",
                  input: null,
                },
              ],
            }),
        );

        const [{ job: main1 }, { job: main2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "main",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "main",
                input: null,
              },
              {
                typeName: "main",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "main",
                input: null,
              },
            ],
          }),
        );

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: main1.id, blockedByChainIds: [blocker1.chainId] },
              { jobId: main2.id, blockedByChainIds: [blocker1.chainId, blocker2.chainId] },
            ],
          }),
        );

        expect(results).toHaveLength(2);
        expect(results[0].job.id).toBe(main1.id);
        expect(results[0].job.status).toBe("blocked");
        expect(results[0].incompleteBlockerChainIds).toContain(blocker1.chainId);

        expect(results[1].job.id).toBe(main2.id);
        expect(results[1].job.status).toBe("blocked");
        expect(results[1].incompleteBlockerChainIds).toContain(blocker1.chainId);
        expect(results[1].incompleteBlockerChainIds).toContain(blocker2.chainId);
      },
    },
    {
      name: "batch handles mix of blocked and unblocked jobs",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: completedBlocker }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "blocker",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJob({
            txCtx,
            jobId: completedBlocker.id,
            output: null,
            workerId: "test",
          }),
        );

        const [{ job: incompleteBlocker }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "blocker",
                input: null,
              },
            ],
          }),
        );

        const [{ job: main1 }, { job: main2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "main",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "main",
                input: null,
              },
              {
                typeName: "main",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "main",
                input: null,
              },
            ],
          }),
        );

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: main1.id, blockedByChainIds: [completedBlocker.chainId] },
              { jobId: main2.id, blockedByChainIds: [incompleteBlocker.chainId] },
            ],
          }),
        );

        expect(results).toHaveLength(2);
        expect(results[0].job.id).toBe(main1.id);
        expect(results[0].job.status).toBe("pending");
        expect(results[0].incompleteBlockerChainIds).toHaveLength(0);

        expect(results[1].job.id).toBe(main2.id);
        expect(results[1].job.status).toBe("blocked");
        expect(results[1].incompleteBlockerChainIds).toContain(incompleteBlocker.chainId);
      },
    },
  ],
};
