import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const getJobBlockersGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "getJobBlockers",
  cases: [
    {
      name: "returns blocker chain views for a job",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [blockerChainB] = await stateAdapter.withTransaction(async (txCtx) =>
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
              {
                jobId: mainChain.head.id,
                blockedByChainIds: [blockerChainA.head.chainId, blockerChainB.head.chainId],
              },
            ],
          }),
        );

        const blockers = await stateAdapter.getJobBlockers({ jobId: mainChain.head.id });
        expect(blockers).toHaveLength(2);

        const blockerHeadIds = blockers.map(({ head }) => head.id);
        expect(blockerHeadIds).toContain(blockerChainA.head.id);
        expect(blockerHeadIds).toContain(blockerChainB.head.id);

        for (const { tail } of blockers) {
          expect(tail).toBeUndefined();
        }
      },
    },
    {
      name: "returns head and tail for a multi-job blocker chain",
      run: async ({ stateAdapter }, expect) => {
        const [blockerRootChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker-root", input: null }],
          }),
        );

        const [{ continuation: blockerContinuation }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  typeName: "blocker-step2",
                  continueFromId: blockerRootChain.head.id,
                  input: null,
                },
              ],
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
              { jobId: mainChain.head.id, blockedByChainIds: [blockerRootChain.head.chainId] },
            ],
          }),
        );

        const blockers = await stateAdapter.getJobBlockers({ jobId: mainChain.head.id });
        expect(blockers).toHaveLength(1);

        const { head: headJob, tail: tailJob } = blockers[0];
        expect(headJob.id).toBe(blockerRootChain.head.id);
        expect(tailJob).toBeDefined();
        expect(tailJob!.id).toBe(blockerContinuation.id);
      },
    },
    {
      name: "returns empty array for job with no blockers",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "no-blockers", input: null }],
          }),
        );

        const blockers = await stateAdapter.getJobBlockers({ jobId: stateChain.head.id });
        expect(blockers).toHaveLength(0);
      },
    },
    {
      name: "non-transactional getJobBlockers does not observe an uncommitted blocker insert",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "iso-blocker-src", input: null }],
          }),
        );
        const [targetChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "iso-blocker-target", input: null }],
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
            await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: targetChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const blockersPromise = stateAdapter.getJobBlockers({ jobId: targetChain.head.id });
        const targetReadPromise = stateAdapter.getJobs({ jobIds: [targetChain.head.id] });
        release!();
        await txPromise;

        const observedBlockers = await blockersPromise;
        const [observedTarget] = await targetReadPromise;
        expect(observedBlockers).toHaveLength(0);
        expect(observedTarget?.completedAt).toBeNull();
        expect(observedTarget?.attemptAt).toBeNull();
      },
    },
  ],
};
