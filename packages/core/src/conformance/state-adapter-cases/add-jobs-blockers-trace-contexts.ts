import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const addJobsBlockersTraceContextsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "addJobBlockers blockerChainTraceContexts",
  cases: [
    {
      name: "returns blocker chain trace contexts from chain root jobs",
      run: async ({ stateAdapter }, expect) => {
        const blockerChainTraceContext = "00-test123-chain456-01";
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                chainTypeName: "blocker",
                input: null,
                chainTraceContext: blockerChainTraceContext,
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
                chainTypeName: "main",
                input: null,
              },
            ],
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
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blockerA",
                chainTypeName: "blockerA",
                input: null,
                chainTraceContext: chainTraceA,
              },
            ],
          }),
        );

        const [{ job: blockerB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blockerB",
                chainTypeName: "blockerB",
                input: null,
                chainTraceContext: chainTraceB,
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
                chainTypeName: "main",
                input: null,
              },
            ],
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
  ],
};
