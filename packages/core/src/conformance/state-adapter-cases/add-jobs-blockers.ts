import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const addJobsBlockersGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "addJobsBlockers",
  cases: [
    {
      name: "adds blockers and returns incomplete blocker chain IDs",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [{ job: mainJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [{ job: updatedMain, incompleteBlockerChainIds, blockerChainTraceContexts }] =
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainJob.id, blockedByChainIds: [blockerJob.chainId] }],
            }),
          );

        expect(updatedMain.completedAt).toBeNull();
        expect(updatedMain.attemptAt).toBeNull();
        expect(updatedMain.blocked).toBe(true);
        expect(incompleteBlockerChainIds).toContain(blockerJob.chainId);
        expect(blockerChainTraceContexts).toHaveLength(1);
        expect(blockerChainTraceContexts[0]).toBeNull();
      },
    },
    {
      name: "returns empty incompleteBlockerChainIds when all blockers are completed",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: blockerJob.id,
            workerId: null,
            outcome: { output: null },
          }),
        );

        const [{ job: mainJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [{ job: updatedMain, incompleteBlockerChainIds, blockerChainTraceContexts }] =
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainJob.id, blockedByChainIds: [blockerJob.chainId] }],
            }),
          );

        expect(updatedMain.completedAt).toBeNull();
        expect(updatedMain.attemptAt).toBeNull();
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
            stateAdapter.createChains({
              txCtx,
              jobs: [
                { typeName: "blocker", input: null },
                { typeName: "blocker", input: null },
              ],
            }),
        );

        const [{ job: main1 }, { job: main2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              { typeName: "main", input: null },
              { typeName: "main", input: null },
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
        expect(results[0].job.completedAt).toBeNull();
        expect(results[0].job.attemptAt).toBeNull();
        expect(results[0].job.blocked).toBe(true);
        expect(results[0].incompleteBlockerChainIds).toContain(blocker1.chainId);

        expect(results[1].job.id).toBe(main2.id);
        expect(results[1].job.completedAt).toBeNull();
        expect(results[1].job.attemptAt).toBeNull();
        expect(results[1].job.blocked).toBe(true);
        expect(results[1].incompleteBlockerChainIds).toContain(blocker1.chainId);
        expect(results[1].incompleteBlockerChainIds).toContain(blocker2.chainId);
      },
    },
    {
      name: "batch handles mix of blocked and unblocked jobs",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: completedBlocker }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: completedBlocker.id,
            workerId: "test",
            outcome: { output: null },
          }),
        );

        const [{ job: incompleteBlocker }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [{ job: main1 }, { job: main2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              { typeName: "main", input: null },
              { typeName: "main", input: null },
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
        expect(results[0].job.completedAt).toBeNull();
        expect(results[0].job.attemptAt).toBeNull();
        expect(results[0].job.blocked).toBe(false);
        expect(results[0].incompleteBlockerChainIds).toHaveLength(0);

        expect(results[1].job.id).toBe(main2.id);
        expect(results[1].job.completedAt).toBeNull();
        expect(results[1].job.attemptAt).toBeNull();
        expect(results[1].job.blocked).toBe(true);
        expect(results[1].incompleteBlockerChainIds).toContain(incompleteBlocker.chainId);
      },
    },
    {
      name: "returns blocker chain trace contexts from chain root jobs",
      run: async ({ stateAdapter }, expect) => {
        const blockerChainTraceContext = "00-test123-chain456-01";
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                input: null,
                chainTraceContext: blockerChainTraceContext,
              },
            ],
          }),
        );

        const [{ job: mainJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [{ blockerChainTraceContexts }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainJob.id, blockedByChainIds: [blockerJob.chainId] }],
          }),
        );

        expect(blockerChainTraceContexts).toHaveLength(1);
        expect(blockerChainTraceContexts[0]).toEqual(blockerChainTraceContext);
      },
    },
    {
      name: "returns blocker chain trace contexts in the same order as blockedByChainIds",
      run: async ({ stateAdapter }, expect) => {
        const chainTraceA = "00-aaa111-chain-aaa-01";
        const chainTraceB = "00-bbb222-chain-bbb-01";

        const [{ job: blockerA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "blockerA",
                input: null,
                chainTraceContext: chainTraceA,
              },
            ],
          }),
        );

        const [{ job: blockerB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "blockerB",
                input: null,
                chainTraceContext: chainTraceB,
              },
            ],
          }),
        );

        const [{ job: mainJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [{ blockerChainTraceContexts }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainJob.id, blockedByChainIds: [blockerA.chainId, blockerB.chainId] },
            ],
          }),
        );

        expect(blockerChainTraceContexts).toHaveLength(2);
        expect(blockerChainTraceContexts[0]).toEqual(chainTraceA);
        expect(blockerChainTraceContexts[1]).toEqual(chainTraceB);
      },
    },
    {
      name: "duplicate blocker chain ids do not break addJobsBlockers",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [{ job: mainJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [{ job: updatedMain, incompleteBlockerChainIds }] =
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                {
                  jobId: mainJob.id,
                  blockedByChainIds: [blockerJob.chainId, blockerJob.chainId, blockerJob.chainId],
                },
              ],
            }),
          );

        expect(updatedMain.blocked).toBe(true);
        expect(incompleteBlockerChainIds).toContain(blockerJob.chainId);
      },
    },
  ],
};
