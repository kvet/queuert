import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const unblockJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "unblockJobs",
  cases: [
    {
      name: "schedules blocked jobs when all blockers complete",
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(1);
        expect(result[0].job.id).toBe(mainChain.head.id);
        expect(result[0].job.status).toBe("pending");
        expect(result[0].job.completedAt).toBeNull();
        expect(result[0].job.attemptAt).toBeNull();
      },
    },
    {
      name: "does not schedule job when not all blockers are complete",
      run: async ({ stateAdapter }, expect) => {
        const [blockerAChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [blockerBChain] = await stateAdapter.withTransaction(async (txCtx) =>
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
                blockedByChainIds: [blockerAChain.head.chainId, blockerBChain.head.chainId],
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: blockerAChain.head.id, output: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerAChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(1);
        expect(result[0].jobId).toBe(mainChain.head.id);
        expect(result[0].job.status).toBe("blocked");

        const [stillBlocked] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        expect(stillBlocked?.completedAt).toBeNull();
        expect(stillBlocked?.attemptAt).toBeNull();
        expect(stillBlocked?.status).toBe("blocked");
      },
    },
    {
      name: "returns empty array when no blocked jobs exist for chain ID",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "standalone", input: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: stateChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(0);
      },
    },
    {
      name: "returns the stored blocker rows for a blocker chain",
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

        const traceContext = "00-test-span-123-01";

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: mainChain.head.id,
                blockedByChainIds: [blockerChain.head.chainId],
                blockerTraceContexts: [traceContext],
              },
            ],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(1);
        expect(result[0].jobId).toBe(mainChain.head.id);
        expect(result[0].blockedByChainId).toBe(blockerChain.head.chainId);
        expect(result[0].index).toBe(0);
        expect(result[0].traceContext).toEqual(traceContext);
      },
    },
    {
      name: "returns no blocker rows when nothing references the chain",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "standalone", input: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: stateChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(0);
      },
    },
    {
      name: "raises stale past scheduledAt to current time when unblocking",
      run: async ({ stateAdapter }, expect) => {
        const past = new Date(Date.now() - 60 * 60 * 1000);

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null, schedule: { at: past } }],
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(1);
        const unblockedAt = result[0].job.scheduledAt.getTime();
        expect(unblockedAt - past.getTime()).toBeGreaterThan(30 * 60 * 1000);
        expect(Math.abs(unblockedAt - Date.now())).toBeLessThan(60 * 1000);
      },
    },
    {
      name: "preserves future scheduledAt when unblocking",
      run: async ({ stateAdapter }, expect) => {
        const future = new Date(Date.now() + 60 * 60 * 1000);

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null, schedule: { at: future } }],
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(1);
        expect(result[0].job.scheduledAt.getTime()).toBe(future.getTime());
      },
    },
    {
      name: "unblocked job with stale past scheduledAt does not jump ahead of already-ready jobs",
      run: async ({ stateAdapter }, expect) => {
        const longPast = new Date(Date.now() - 60 * 60 * 1000);
        const recentPast = new Date(Date.now() - 60 * 1000);

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "fairness-blocker", input: null }],
          }),
        );

        const [blockedMainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "fairness-main",
                input: { kind: "blocked-since-creation" },
                schedule: { at: longPast },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: blockedMainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        const [readyMainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "fairness-main", input: { kind: "ready" }, schedule: { at: recentPast } },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        await new Promise((resolve) => setTimeout(resolve, 10));

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerChain.head.chainId,
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

        expect(first!.id).toBe(readyMainChain.head.id);
        expect(second!.id).toBe(blockedMainChain.head.id);
      },
    },
    {
      name: "returns blocker rows with a null trace context when none was stored",
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

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(1);
        expect(result[0].jobId).toBe(mainChain.head.id);
        expect(result[0].traceContext).toBeNull();
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

        const blockerJobs = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: Array.from({ length: count }, (_, index) => ({
              typeName: "race-blocker",
              input: { index },
            })),
          }),
        );
        const createChainBlockedBy = async (
          blockerChainId: string,
          index: number,
        ): Promise<string> =>
          stateAdapter.withTransaction(async (txCtx) => {
            const [mainChain] = await stateAdapter.createJobs({
              txCtx,
              jobs: [{ typeName: "race-main", input: { index } }],
            });
            const [result] = await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChainId] }],
            });
            return result.id;
          });

        const completeBlockerChain = async (blockerJobId: string, chainId: string): Promise<void> =>
          stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.completeJobs({
              txCtx,
              completedBy: "race-test",
              jobs: [{ jobId: blockerJobId, output: null }],
            });
            await stateAdapter.unblockJobs({ txCtx, blockedByChainId: chainId });
          });

        const mainJobIds = await Promise.all(
          blockerJobs.flatMap((blockerJob, i) => [
            createChainBlockedBy(blockerJob.head.chainId, i),
            completeBlockerChain(blockerJob.head.id, blockerJob.head.chainId).then(() => undefined),
          ]),
        ).then((results) => results.filter((id): id is string => id !== undefined));

        const finalStates = await Promise.all(
          mainJobIds.map(async (jobId) => stateAdapter.getJobs({ jobIds: [jobId] })),
        );

        const stranded = finalStates.filter(([job]) => job?.status === "blocked");
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
            stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: blockerCount }, (_, index) => ({
                typeName: "shared-blocker",
                input: { index },
              })),
            }),
          )
          .then((results) => results.map((r) => r.head));

        const mainJobs = await stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: mainCount }, (_, index) => ({
                typeName: "shared-main",
                input: { index },
              })),
            }),
          )
          .then((results) => results.map((r) => r.head));

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
              await stateAdapter.completeJobs({
                txCtx,
                completedBy: "race-test",
                jobs: [{ jobId: blocker.id, output: null }],
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

        const stranded = finalStates.filter(([job]) => job?.status === "blocked");
        expect(stranded).toHaveLength(0);
      },
    },
    {
      name: "completing a blocked job clears blocked so it never resurfaces",
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: mainChain.head.id, output: "done" }],
          }),
        );

        const [completedJob] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        expect(completedJob!.status).toBe("completed");

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(1);
        expect(result[0].jobId).toBe(mainChain.head.id);
        expect(result[0].job.completedAt).not.toBeNull();

        const [job] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        expect(job!.completedAt).not.toBeNull();
      },
    },
  ],
};
