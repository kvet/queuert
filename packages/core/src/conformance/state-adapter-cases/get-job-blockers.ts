import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const getJobBlockersGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "getJobBlockers",
  cases: [
    {
      name: "returns blocker chain pairs for a job",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [{ job: blockerB }] = await stateAdapter.withTransaction(async (txCtx) =>
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

        const blockerRootIds = blockers.map(([headJob]) => headJob.id);
        expect(blockerRootIds).toContain(blockerA.id);
        expect(blockerRootIds).toContain(blockerB.id);

        for (const [headJob, tailJob] of blockers) {
          if (tailJob !== undefined) {
            expect(tailJob.id).toBe(headJob.id);
          }
        }
      },
    },
    {
      name: "returns [headJob, tailJob] for multi-job blocker chain",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerRoot }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "blocker-root", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: blockerRoot.id,
            workerId: null,
            outcome: { output: null },
          }),
        );

        const { job: blockerContinuation } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "blocker-step2",
              continueFromId: blockerRoot.id,
              input: null,
            },
          }),
        );

        const [{ job: mainJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
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

        const [headJob, tailJob] = blockers[0];
        expect(headJob.id).toBe(blockerRoot.id);
        expect(tailJob).toBeDefined();
        expect(tailJob!.id).toBe(blockerContinuation.id);
      },
    },
    {
      name: "returns empty array for job with no blockers",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "no-blockers", input: null }],
          }),
        );

        const blockers = await stateAdapter.getJobBlockers({ jobId: job.id });
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
        const [{ job: blocker }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "iso-blocker-src", input: null }],
          }),
        );
        const [{ job: target }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
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
              jobBlockers: [{ jobId: target.id, blockedByChainIds: [blocker.chainId] }],
            });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const blockersPromise = stateAdapter.getJobBlockers({ jobId: target.id });
        const targetReadPromise = stateAdapter.getJobs({ jobIds: [target.id] });
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
