import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

export const deleteChainsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "deleteChains",
  cases: [
    {
      name: "deletes all jobs in the given chains",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "delete-test",
                chainTypeName: "delete-test",
                input: null,
              },
            ],
          }),
        );

        const { deleted } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({
            txCtx,
            chainIds: [job.chainId],
          }),
        );

        expect(deleted).toHaveLength(1);
        expect(deleted[0][0].id).toBe(job.id);
        expect(deleted[0][1]).toBeUndefined();
        expect(await stateAdapter.getJob({ jobId: job.id })).toBeUndefined();
      },
    },
    {
      name: "does not delete jobs from other chains",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: jobA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-a",
                chainTypeName: "chain-a",
                input: null,
              },
            ],
          }),
        );

        const [{ job: jobB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-b",
                chainTypeName: "chain-b",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({
            txCtx,
            chainIds: [jobA.chainId],
          }),
        );

        expect(await stateAdapter.getJob({ jobId: jobA.id })).toBeUndefined();
        expect(await stateAdapter.getJob({ jobId: jobB.id })).toBeDefined();
      },
    },
    {
      name: "returns empty deleted + blockerRefs when a chain is referenced as blocker",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
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
            jobBlockers: [{ jobId: mainJob.id, blockedByChainIds: [blockerJob.chainId] }],
          }),
        );

        const blocked = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({ txCtx, chainIds: [blockerJob.chainId] }),
        );
        expect(blocked.deleted).toEqual([]);
        expect(blocked.blockerRefs).toEqual([
          { chainId: blockerJob.chainId, referencedByJobId: mainJob.id },
        ]);

        // Blocker chain is still intact
        expect(await stateAdapter.getJob({ jobId: blockerJob.id })).toBeDefined();

        // Deleting both together succeeds
        const { deleted, blockerRefs } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({
            txCtx,
            chainIds: [mainJob.chainId, blockerJob.chainId],
          }),
        );

        expect(deleted).toHaveLength(2);
        expect(blockerRefs).toEqual([]);
      },
    },
    {
      name: "cascade deletes chain and its dependencies",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
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
            jobBlockers: [{ jobId: mainJob.id, blockedByChainIds: [blockerJob.chainId] }],
          }),
        );

        const { deleted } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({
            txCtx,
            chainIds: [mainJob.chainId],
            cascade: true,
          }),
        );

        expect(deleted).toHaveLength(2);
        expect(await stateAdapter.getJob({ jobId: blockerJob.id })).toBeUndefined();
        expect(await stateAdapter.getJob({ jobId: mainJob.id })).toBeUndefined();
      },
    },
    {
      name: "cascade returns empty deleted + blockerRefs when deleting chain referenced as blocker",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
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
            jobBlockers: [{ jobId: mainJob.id, blockedByChainIds: [blockerJob.chainId] }],
          }),
        );

        const { deleted, blockerRefs } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({
            txCtx,
            chainIds: [blockerJob.chainId],
            cascade: true,
          }),
        );
        expect(deleted).toEqual([]);
        expect(blockerRefs).toEqual([
          { chainId: blockerJob.chainId, referencedByJobId: mainJob.id },
        ]);
      },
    },
    {
      name: "cascade resolves transitive dependencies",
      run: async ({ stateAdapter }, expect) => {
        // A ← B ← C (C depends on B, B depends on A)
        const [{ job: jobA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-a",
                chainTypeName: "chain-a",
                input: null,
              },
            ],
          }),
        );

        const [{ job: jobB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-b",
                chainTypeName: "chain-b",
                input: null,
              },
            ],
          }),
        );

        const [{ job: jobC }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-c",
                chainTypeName: "chain-c",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: jobB.id, blockedByChainIds: [jobA.chainId] }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: jobC.id, blockedByChainIds: [jobB.chainId] }],
          }),
        );

        // Delete from C (topmost dependent) — cascades down to B and A
        const { deleted } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({
            txCtx,
            chainIds: [jobC.chainId],
            cascade: true,
          }),
        );

        expect(deleted).toHaveLength(3);
        expect(await stateAdapter.getJob({ jobId: jobA.id })).toBeUndefined();
        expect(await stateAdapter.getJob({ jobId: jobB.id })).toBeUndefined();
        expect(await stateAdapter.getJob({ jobId: jobC.id })).toBeUndefined();
      },
    },
    {
      name: "cascade deduplicates diamond dependencies",
      run: async ({ stateAdapter }, expect) => {
        //     D
        //    / \
        //   B   C
        //    \ /
        //     A
        const [{ job: jobA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "diamond-a",
                chainTypeName: "diamond-a",
                input: null,
              },
            ],
          }),
        );

        const [{ job: jobB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "diamond-b",
                chainTypeName: "diamond-b",
                input: null,
              },
            ],
          }),
        );

        const [{ job: jobC }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "diamond-c",
                chainTypeName: "diamond-c",
                input: null,
              },
            ],
          }),
        );

        const [{ job: jobD }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "diamond-d",
                chainTypeName: "diamond-d",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: jobB.id, blockedByChainIds: [jobA.chainId] }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: jobC.id, blockedByChainIds: [jobA.chainId] }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: jobD.id, blockedByChainIds: [jobB.chainId, jobC.chainId] }],
          }),
        );

        const { deleted } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({
            txCtx,
            chainIds: [jobD.chainId],
            cascade: true,
          }),
        );

        expect(deleted).toHaveLength(4);
        expect(await stateAdapter.getJob({ jobId: jobA.id })).toBeUndefined();
        expect(await stateAdapter.getJob({ jobId: jobB.id })).toBeUndefined();
        expect(await stateAdapter.getJob({ jobId: jobC.id })).toBeUndefined();
        expect(await stateAdapter.getJob({ jobId: jobD.id })).toBeUndefined();
      },
    },
    {
      name: "cascade with no blocker relationships deletes only specified chains",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: jobA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "standalone-a",
                chainTypeName: "standalone-a",
                input: null,
              },
            ],
          }),
        );

        const [{ job: jobB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "standalone-b",
                chainTypeName: "standalone-b",
                input: null,
              },
            ],
          }),
        );

        const { deleted } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({
            txCtx,
            chainIds: [jobA.chainId],
            cascade: true,
          }),
        );

        expect(deleted).toHaveLength(1);
        expect(deleted[0][0].id).toBe(jobA.id);
        expect(await stateAdapter.getJob({ jobId: jobA.id })).toBeUndefined();
        expect(await stateAdapter.getJob({ jobId: jobB.id })).toBeDefined();
      },
    },
  ],
};
