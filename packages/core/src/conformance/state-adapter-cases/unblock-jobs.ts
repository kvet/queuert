import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const unblockJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "unblockJobs",
  cases: [
    {
      name: "schedules blocked jobs when all blockers complete",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
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
          stateAdapter.createChains({
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: blockerJob.id,
            workerId: null,
            outcome: { output: null },
          }),
        );

        const { unblockedJobs } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerJob.chainId,
          }),
        );

        expect(unblockedJobs).toHaveLength(1);
        expect(unblockedJobs[0].id).toBe(mainJob.id);
        expect(unblockedJobs[0].blocked).toBe(false);
        expect(unblockedJobs[0].completedAt).toBeNull();
        expect(unblockedJobs[0].attemptAt).toBeNull();
      },
    },
    {
      name: "does not schedule job when not all blockers are complete",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
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
          stateAdapter.createChains({
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
          stateAdapter.createChains({
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: blockerA.id,
            workerId: null,
            outcome: { output: null },
          }),
        );

        const { unblockedJobs } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerA.chainId,
          }),
        );

        expect(unblockedJobs).toHaveLength(0);

        const [stillBlocked] = await stateAdapter.getJobs({ jobIds: [mainJob.id] });
        expect(stillBlocked?.completedAt).toBeNull();
        expect(stillBlocked?.attemptAt).toBeNull();
        expect(stillBlocked?.blocked).toBe(true);
      },
    },
    {
      name: "returns empty array when no blocked jobs exist for chain ID",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "standalone",
                chainTypeName: "standalone",
                input: null,
              },
            ],
          }),
        );

        const { unblockedJobs } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: job.chainId,
          }),
        );

        expect(unblockedJobs).toHaveLength(0);
      },
    },
    {
      name: "returns stored blocker trace contexts for a blocker chain",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
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
          stateAdapter.createChains({
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

        const traceContext = "00-test-span-123-01";

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: mainJob.id,
                blockedByChainIds: [blockerJob.chainId],
                blockerTraceContexts: [traceContext],
              },
            ],
          }),
        );

        const { blockerTraceContexts } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerJob.chainId,
          }),
        );

        expect(blockerTraceContexts).toHaveLength(1);
        expect(blockerTraceContexts[0]).toEqual(traceContext);
      },
    },
    {
      name: "returns empty blocker trace contexts when no blockers exist",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "standalone",
                chainTypeName: "standalone",
                input: null,
              },
            ],
          }),
        );

        const { blockerTraceContexts } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: job.chainId,
          }),
        );

        expect(blockerTraceContexts).toHaveLength(0);
      },
    },
    {
      name: "raises stale past scheduledAt to current time when unblocking",
      run: async ({ stateAdapter }, expect) => {
        const past = new Date(Date.now() - 60 * 60 * 1000);

        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
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
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "main",
                chainTypeName: "main",
                input: null,
                schedule: { at: past },
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: blockerJob.id,
            workerId: null,
            outcome: { output: null },
          }),
        );

        const { unblockedJobs } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerJob.chainId,
          }),
        );

        expect(unblockedJobs).toHaveLength(1);
        const unblockedAt = unblockedJobs[0].scheduledAt.getTime();
        expect(unblockedAt - past.getTime()).toBeGreaterThan(30 * 60 * 1000);
        expect(Math.abs(unblockedAt - Date.now())).toBeLessThan(60 * 1000);
      },
    },
    {
      name: "preserves future scheduledAt when unblocking",
      run: async ({ stateAdapter }, expect) => {
        const future = new Date(Date.now() + 60 * 60 * 1000);

        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
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
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "main",
                chainTypeName: "main",
                input: null,
                schedule: { at: future },
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: blockerJob.id,
            workerId: null,
            outcome: { output: null },
          }),
        );

        const { unblockedJobs } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerJob.chainId,
          }),
        );

        expect(unblockedJobs).toHaveLength(1);
        expect(unblockedJobs[0].scheduledAt.getTime()).toBe(future.getTime());
      },
    },
    {
      name: "unblocked job with stale past scheduledAt does not jump ahead of already-ready jobs",
      run: async ({ stateAdapter }, expect) => {
        const longPast = new Date(Date.now() - 60 * 60 * 1000);
        const recentPast = new Date(Date.now() - 60 * 1000);

        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "fairness-blocker",
                chainTypeName: "fairness-blocker",
                input: null,
              },
            ],
          }),
        );

        const [{ job: blockedMain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "fairness-main",
                chainTypeName: "fairness-main",
                input: { kind: "blocked-since-creation" },
                schedule: { at: longPast },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: blockedMain.id, blockedByChainIds: [blockerJob.chainId] }],
          }),
        );

        const [{ job: readyMain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "fairness-main",
                chainTypeName: "fairness-main",
                input: { kind: "ready" },
                schedule: { at: recentPast },
              },
            ],
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

        await new Promise((resolve) => setTimeout(resolve, 10));

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerJob.chainId,
          }),
        );

        const first = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["fairness-main"],
          }),
        );
        const second = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["fairness-main"],
          }),
        );

        expect(first.job?.id).toBe(readyMain.id);
        expect(second.job?.id).toBe(blockedMain.id);
      },
    },
    {
      name: "returns empty blocker trace contexts when blockers have no trace contexts",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
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
          stateAdapter.createChains({
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

        const { blockerTraceContexts } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerJob.chainId,
          }),
        );

        expect(blockerTraceContexts).toHaveLength(0);
      },
    },
    {
      name: "starting a chain blocked by a concurrently-completing chain does not strand it as blocked",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const count = 20;

        const blockerJobs = await stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: Array.from({ length: count }, (_, index) => ({
                typeName: "race-blocker",
                chainTypeName: "race-blocker",
                input: { index },
              })),
            }),
          )
          .then((results) => results.map((r) => r.job));

        const startChainBlockedBy = async (
          blockerChainId: string,
          index: number,
        ): Promise<string> =>
          stateAdapter.withTransaction(async (txCtx) => {
            const [{ job: mainJob }] = await stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "race-main",
                  chainTypeName: "race-main",
                  input: { index },
                },
              ],
            });
            const [{ job }] = await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainJob.id, blockedByChainIds: [blockerChainId] }],
            });
            return job.id;
          });

        const completeBlockerChain = async (blockerJobId: string, chainId: string): Promise<void> =>
          stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.finishJobAttempt({
              txCtx,
              jobId: blockerJobId,
              workerId: "race-test",
              outcome: { output: null },
            });
            await stateAdapter.unblockJobs({ txCtx, blockedByChainId: chainId });
          });

        const mainJobIds = await Promise.all(
          blockerJobs.flatMap((blockerJob, i) => [
            startChainBlockedBy(blockerJob.chainId, i),
            completeBlockerChain(blockerJob.id, blockerJob.chainId).then(() => undefined),
          ]),
        ).then((results) => results.filter((id): id is string => id !== undefined));

        const finalStates = await Promise.all(
          mainJobIds.map(async (jobId) => stateAdapter.getJobs({ jobIds: [jobId] })),
        );

        const stranded = finalStates.filter(([job]) => job?.blocked);
        expect(stranded).toHaveLength(0);
      },
    },
    {
      name: "concurrent blocker chain completions unblock all jobs sharing those blockers",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const blockerCount = 5;
        const mainCount = 5;

        const blockerJobs = await stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: Array.from({ length: blockerCount }, (_, index) => ({
                typeName: "shared-blocker",
                chainTypeName: "shared-blocker",
                input: { index },
              })),
            }),
          )
          .then((results) => results.map((r) => r.job));

        const mainJobs = await stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: Array.from({ length: mainCount }, (_, index) => ({
                typeName: "shared-main",
                chainTypeName: "shared-main",
                input: { index },
              })),
            }),
          )
          .then((results) => results.map((r) => r.job));

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: mainJobs.map((main) => ({
              jobId: main.id,
              blockedByChainIds: blockerJobs.map((b) => b.chainId),
            })),
          }),
        );

        let readyCount = 0;
        const allReady = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();

        const allDone = Promise.all(
          blockerJobs.map(async (blocker) =>
            stateAdapter.withTransaction(async (txCtx) => {
              readyCount++;
              if (readyCount === blockerCount) allReady.resolve();
              await release.promise;
              await stateAdapter.finishJobAttempt({
                txCtx,
                jobId: blocker.id,
                workerId: "race-test",
                outcome: { output: null },
              });
              await stateAdapter.unblockJobs({ txCtx, blockedByChainId: blocker.chainId });
            }),
          ),
        );

        await allReady.promise;
        release.resolve();
        await allDone;

        const finalStates = await Promise.all(
          mainJobs.map(async (main) => stateAdapter.getJobs({ jobIds: [main.id] })),
        );

        const stranded = finalStates.filter(([job]) => job?.blocked);
        expect(stranded).toHaveLength(0);
      },
    },
    {
      name: "completing a blocked job clears blocked so it never resurfaces",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
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
          stateAdapter.createChains({
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: mainJob.id,
            workerId: null,
            outcome: { output: "done" },
          }),
        );

        const [completedJob] = await stateAdapter.getJobs({ jobIds: [mainJob.id] });
        expect(completedJob!.blocked).toBe(false);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: blockerJob.id,
            workerId: null,
            outcome: { output: null },
          }),
        );

        const { unblockedJobs } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerJob.chainId,
          }),
        );

        expect(unblockedJobs).toHaveLength(0);

        const [job] = await stateAdapter.getJobs({ jobIds: [mainJob.id] });
        expect(job!.completedAt).not.toBeNull();
      },
    },
  ],
};
