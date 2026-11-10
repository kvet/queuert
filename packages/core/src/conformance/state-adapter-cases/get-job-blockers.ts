import type { ConformanceGroup } from "../runner.ts";
import type { StateAdapterConformanceContext } from "./types.ts";

export const getJobBlockersGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getJobBlockers",
  cases: [
    {
      name: "returns blocker chain views for a job",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerChainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );

        const [blockerChainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
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
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerHeadChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "blocker-head", input: null },
            ],
          }),
        );

        const [continuedBlockerContinuation] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "blocker-step2",
                continueFromId: blockerHeadChain.head.id,
                input: null,
              },
            ],
          }),
        );
        const { continuation: blockerContinuation } = continuedBlockerContinuation!;

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain.head.id, blockedByChainIds: [blockerHeadChain.head.chainId] },
            ],
          }),
        );

        const blockers = await stateAdapter.getJobBlockers({ jobId: mainChain.head.id });
        expect(blockers).toHaveLength(1);

        const { head: headJob, tail: tailJob } = blockers[0];
        expect(headJob.id).toBe(blockerHeadChain.head.id);
        expect(tailJob).toBeDefined();
        expect(tailJob!.id).toBe(blockerContinuation.id);
      },
    },
    {
      name: "returns one entry per position when the same chain is listed twice",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: mainChain.head.id,
                blockedByChainIds: [blockerChain.id, blockerChain.id],
              },
            ],
          }),
        );

        const blockers = await stateAdapter.getJobBlockers({ jobId: mainChain.head.id });
        expect(blockers.map(({ id }) => id)).toEqual([blockerChain.id, blockerChain.id]);
      },
    },
    {
      name: "returns empty array for job with no blockers",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "no-blockers", input: null },
            ],
          }),
        );

        const blockers = await stateAdapter.getJobBlockers({ jobId: stateChain.head.id });
        expect(blockers).toHaveLength(0);
      },
    },
  ],
};

export const getJobBlockersConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "getJobBlockers",
    cases: [
      {
        name: "non-transactional getJobBlockers does not observe an uncommitted blocker insert",
        run: async ({ createStateAdapter }, expect) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "iso-blocker-src",
                  input: null,
                },
              ],
            }),
          );
          const [targetChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "iso-blocker-target",
                  input: null,
                },
              ],
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
