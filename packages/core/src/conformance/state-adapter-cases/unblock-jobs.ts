import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const unblockJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "unblockJobs",
  cases: [
    {
      name: "schedules blocked jobs when all blockers complete",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                chainId: undefined,
                chainIndex: 0,
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
                chainId: undefined,
                chainIndex: 0,
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
          stateAdapter.completeJob({
            txCtx,
            jobId: blockerJob.id,
            output: null,
            workerId: null,
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
        expect(unblockedJobs[0].status).toBe("pending");
      },
    },
    {
      name: "does not schedule job when not all blockers are complete",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                chainId: undefined,
                chainIndex: 0,
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
                chainId: undefined,
                chainIndex: 0,
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
                chainId: undefined,
                chainIndex: 0,
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
          stateAdapter.completeJob({
            txCtx,
            jobId: blockerA.id,
            output: null,
            workerId: null,
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
        expect(stillBlocked?.status).toBe("blocked");
      },
    },
    {
      name: "returns empty array when no blocked jobs exist for chain ID",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "standalone",
                chainId: undefined,
                chainIndex: 0,
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
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                chainId: undefined,
                chainIndex: 0,
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
                chainId: undefined,
                chainIndex: 0,
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
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "standalone",
                chainId: undefined,
                chainIndex: 0,
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
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                chainId: undefined,
                chainIndex: 0,
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
                chainId: undefined,
                chainIndex: 0,
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
          stateAdapter.completeJob({
            txCtx,
            jobId: blockerJob.id,
            output: null,
            workerId: null,
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
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                chainId: undefined,
                chainIndex: 0,
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
                chainId: undefined,
                chainIndex: 0,
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
          stateAdapter.completeJob({
            txCtx,
            jobId: blockerJob.id,
            output: null,
            workerId: null,
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
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "fairness-blocker",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "fairness-blocker",
                input: null,
              },
            ],
          }),
        );

        const [{ job: blockedMain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "fairness-main",
                chainId: undefined,
                chainIndex: 0,
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
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "fairness-main",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "fairness-main",
                input: { kind: "ready" },
                schedule: { at: recentPast },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJob({
            txCtx,
            jobId: blockerJob.id,
            output: null,
            workerId: null,
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
          stateAdapter.acquireJob({ txCtx, typeNames: ["fairness-main"] }),
        );
        const second = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["fairness-main"] }),
        );

        expect(first.job?.id).toBe(readyMain.id);
        expect(second.job?.id).toBe(blockedMain.id);
      },
    },
    {
      name: "returns empty blocker trace contexts when blockers have no trace contexts",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                chainId: undefined,
                chainIndex: 0,
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
                chainId: undefined,
                chainIndex: 0,
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
  ],
};
