import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

export const getJobBlockersGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getJobBlockers",
  cases: [
    {
      name: "returns blocker chain pairs for a job",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                chainTypeName: "blocker",
                input: null,
              },
            ],
          }),
        );

        const [{ job: blockerB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
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
                chainTypeName: "main",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainJob.id, blockedByChainIds: [blockerA.chainId, blockerB.chainId] },
            ],
          }),
        );

        const blockers = await stateAdapter.getJobBlockers({ jobId: mainJob.id });
        expect(blockers).toHaveLength(2);

        const blockerRootIds = blockers.map(([rootJob]) => rootJob.id);
        expect(blockerRootIds).toContain(blockerA.id);
        expect(blockerRootIds).toContain(blockerB.id);

        for (const [rootJob, lastJob] of blockers) {
          if (lastJob !== undefined) {
            expect(lastJob.id).toBe(rootJob.id);
          }
        }
      },
    },
    {
      name: "returns [rootJob, lastJob] for multi-job blocker chain",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerRoot }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker-root",
                chainTypeName: "blocker-root",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJob({
            txCtx,
            jobId: blockerRoot.id,
            output: null,
            workerId: null,
          }),
        );

        const [{ job: blockerContinuation }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker-step2",
                continueFromJobId: blockerRoot.id,
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
                chainTypeName: "main",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainJob.id, blockedByChainIds: [blockerRoot.chainId] }],
          }),
        );

        const blockers = await stateAdapter.getJobBlockers({ jobId: mainJob.id });
        expect(blockers).toHaveLength(1);

        const [rootJob, lastJob] = blockers[0];
        expect(rootJob.id).toBe(blockerRoot.id);
        expect(lastJob).toBeDefined();
        expect(lastJob!.id).toBe(blockerContinuation.id);
      },
    },
    {
      name: "returns empty array for job with no blockers",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "no-blockers",
                chainTypeName: "no-blockers",
                input: null,
              },
            ],
          }),
        );

        const blockers = await stateAdapter.getJobBlockers({ jobId: job.id });
        expect(blockers).toHaveLength(0);
      },
    },
  ],
};
