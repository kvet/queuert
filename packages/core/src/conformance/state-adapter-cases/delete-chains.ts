import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const deleteChainsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "deleteChains",
  cases: [
    {
      name: "deletes all jobs in the given chains",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "delete-test", input: null }],
          }),
        );

        const [deleted] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({
            txCtx,
            chainIds: [stateChain.head.chainId],
          }),
        );

        expect(deleted).toBeDefined();
        expect(!Array.isArray(deleted)).toBe(true);
        const deletedChain = deleted as Exclude<typeof deleted, undefined | unknown[]>;
        expect(deletedChain.head.id).toBe(stateChain.head.id);
        expect(deletedChain.tail).toBeUndefined();
        expect(await stateAdapter.getJobs({ jobIds: [stateChain.head.id] })).toEqual([undefined]);
      },
    },
    {
      name: "does not delete jobs from other chains",
      run: async ({ stateAdapter }, expect) => {
        const [chainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "chain-a", input: null }],
          }),
        );

        const [chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "chain-b", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({
            txCtx,
            chainIds: [chainA.head.chainId],
          }),
        );

        expect(await stateAdapter.getJobs({ jobIds: [chainA.head.id] })).toEqual([undefined]);
        const jobBResult = await stateAdapter.getJobs({ jobIds: [chainB.head.id] });
        expect(Array.isArray(jobBResult) && typeof jobBResult[0] === "object").toBe(true);
      },
    },
    {
      name: "returns empty deleted + blockerRefs when a chain is referenced as blocker",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        const [blockerResult] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.head.chainId] }),
        );
        expect(Array.isArray(blockerResult)).toBe(true);
        expect((blockerResult as any[])[0].job.id).toBe(mainChain.head.id);

        // Blocker chain is still intact
        const blockerStillThere = await stateAdapter.getJobs({ jobIds: [blockerChain.head.id] });
        expect(Array.isArray(blockerStillThere) && typeof blockerStillThere[0] === "object").toBe(
          true,
        );

        // Deleting both together succeeds
        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({
            txCtx,
            chainIds: [mainChain.head.chainId, blockerChain.head.chainId],
          }),
        );

        expect(results).toHaveLength(2);
        expect(results[0]).toBeDefined();
        expect(!Array.isArray(results[0])).toBe(true);
        expect(results[1]).toBeDefined();
        expect(!Array.isArray(results[1])).toBe(true);
      },
    },
  ],
};
