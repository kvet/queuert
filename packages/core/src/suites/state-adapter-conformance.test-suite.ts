import { type TestAPI, describe } from "vitest";
import { BlockerReferenceError } from "../errors.js";
import { sleep } from "../helpers/sleep.js";
import { type StateAdapter, type StateJob } from "../state-adapter/state-adapter.js";

export type StateAdapterConformanceContext = {
  stateAdapter: StateAdapter<{ $test: true }, string>;
  validateId: (id: string) => boolean;
};

export const stateAdapterConformanceTestSuite = <T extends StateAdapterConformanceContext>({
  it,
}: {
  it: TestAPI<T>;
}): void => {
  describe("createJob", () => {
    it("generates valid job IDs", async ({ stateAdapter, validateId, expect }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "test-job",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "test-job",
          input: { value: 1 },
        }),
      );

      expect(job.id).toBeDefined();
      expect(validateId(job.id)).toBe(true);
    });

    it("assigns chainId correctly for new jobs", async ({ stateAdapter, validateId, expect }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "chain-test",
          input: null,
        }),
      );

      expect(job.chainId).toBe(job.id);
      expect(validateId(job.chainId)).toBe(true);
    });

    it("preserves provided chainId", async ({ stateAdapter, validateId, expect }) => {
      const { job: rootJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "root-job",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "root-job",
          input: null,
        }),
      );

      const { job: childJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "child-job",
          chainId: rootJob.chainId,
          chainIndex: 1,
          chainTypeName: "root-job",
          input: null,
        }),
      );

      expect(childJob.chainId).toBe(rootJob.chainId);
      expect(childJob.chainIndex).toBe(1);
      expect(validateId(childJob.id)).toBe(true);
      expect(validateId(childJob.chainId)).toBe(true);
    });

    it("generates unique job IDs", async ({ stateAdapter, expect }) => {
      const jobs = await stateAdapter.runInTransaction(async (txContext) => {
        const results: StateJob[] = [];
        for (let i = 0; i < 10; i++) {
          const { job } = await stateAdapter.createJob({
            txContext,
            typeName: "test-job",
            chainId: undefined,
            chainIndex: 0,
            chainTypeName: "test-job",
            input: { value: i },
          });
          results.push(job);
        }
        return results;
      });

      const ids = jobs.map((j) => j.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("persists and retrieves jobs correctly", async ({ stateAdapter, expect }) => {
      const input = { nested: { value: 42 }, array: [1, 2, 3] };
      const { job: created } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "test-job",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "test-job",
          input,
        }),
      );

      const retrieved = await stateAdapter.getJobById({ jobId: created.id });

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.typeName).toBe("test-job");
      expect(retrieved!.input).toEqual(input);
      expect(retrieved!.status).toBe("pending");
    });

    it("handles null values correctly", async ({ stateAdapter, expect }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "null-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "null-test",
          input: null,
        }),
      );

      expect(job.input).toBeNull();
      expect(job.output).toBeNull();
      expect(job.completedAt).toBeNull();
      expect(job.completedBy).toBeNull();
      expect(job.lastAttemptError).toBeNull();
      expect(job.lastAttemptAt).toBeNull();
      expect(job.leasedBy).toBeNull();
      expect(job.leasedUntil).toBeNull();
      expect(job.deduplicationKey).toBeNull();
      expect(job.chainIndex).toBe(0);
    });

    it("handles complex JSON input/output", async ({ stateAdapter, expect }) => {
      const complexInput = {
        string: "hello",
        number: 42,
        float: 3.14,
        boolean: true,
        null: null,
        array: [1, "two", { three: 3 }],
        nested: {
          deep: {
            value: "found",
          },
        },
        unicode: "日本語 🎉",
        empty: {},
        emptyArray: [],
      };

      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "json-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "json-test",
          input: complexInput,
        }),
      );

      const retrieved = await stateAdapter.getJobById({ jobId: job.id });
      expect(retrieved!.input).toEqual(complexInput);
    });

    it("deduplicates jobs with same deduplication key", async ({ stateAdapter, expect }) => {
      const { job: first } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "dedup-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "dedup-test",
          input: { value: 1 },
          deduplication: { key: "same-key" },
        }),
      );

      const { job: second, deduplicated } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "dedup-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "dedup-test",
          input: { value: 2 },
          deduplication: { key: "same-key" },
        }),
      );

      expect(deduplicated).toBe(true);
      expect(second.id).toBe(first.id);

      const { deduplicated: notDeduped } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "dedup-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "dedup-test",
          input: { value: 3 },
          deduplication: { key: "different-key" },
        }),
      );

      expect(notDeduped).toBe(false);
    });

    it("deduplicates continuation with same chain_index", async ({ stateAdapter, expect }) => {
      const { job: rootJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-root",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "chain-root",
          input: null,
        }),
      );

      expect(rootJob.chainIndex).toBe(0);

      const { job: continuation1, deduplicated: dedup1 } = await stateAdapter.runInTransaction(
        async (txContext) =>
          stateAdapter.createJob({
            txContext,
            typeName: "chain-step2",
            chainId: rootJob.chainId,
            chainIndex: 1,
            chainTypeName: "chain-root",
            input: { value: 1 },
          }),
      );

      expect(dedup1).toBe(false);
      expect(continuation1.chainIndex).toBe(1);

      const { job: continuation2, deduplicated: dedup2 } = await stateAdapter.runInTransaction(
        async (txContext) =>
          stateAdapter.createJob({
            txContext,
            typeName: "chain-step2",
            chainId: rootJob.chainId,
            chainIndex: 1,
            chainTypeName: "chain-root",
            input: { value: 2 },
          }),
      );

      expect(dedup2).toBe(true);
      expect(continuation2.id).toBe(continuation1.id);
      expect(continuation2.input).toEqual({ value: 1 });
    });

    it("deduplicates concurrent continuations with same chain_index", async ({
      stateAdapter,
      expect,
    }) => {
      const { job: rootJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-root",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "chain-root",
          input: null,
        }),
      );

      const [result1, result2] = await Promise.all([
        stateAdapter.runInTransaction(async (txContext) =>
          stateAdapter.createJob({
            txContext,
            typeName: "chain-step2",
            chainId: rootJob.chainId,
            chainIndex: 1,
            chainTypeName: "chain-root",
            input: { from: "tx1" },
          }),
        ),
        stateAdapter.runInTransaction(async (txContext) =>
          stateAdapter.createJob({
            txContext,
            typeName: "chain-step2",
            chainId: rootJob.chainId,
            chainIndex: 1,
            chainTypeName: "chain-root",
            input: { from: "tx2" },
          }),
        ),
      ]);

      expect(result1.job.id).toBe(result2.job.id);
      expect(result1.deduplicated !== result2.deduplicated).toBe(true);
    });

    it("assigns sequential chain_index values", async ({ stateAdapter, expect }) => {
      const { job: rootJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "t",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "t",
          input: null,
        }),
      );
      expect(rootJob.chainIndex).toBe(0);

      const { job: cont1 } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "t2",
          chainId: rootJob.chainId,
          chainIndex: 1,
          chainTypeName: "t",
          input: null,
        }),
      );
      expect(cont1.chainIndex).toBe(1);

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.completeJob({ txContext, jobId: cont1.id, output: null, workerId: null }),
      );

      const { job: cont2 } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "t3",
          chainId: rootJob.chainId,
          chainIndex: 2,
          chainTypeName: "t",
          input: null,
        }),
      );
      expect(cont2.chainIndex).toBe(2);
    });

    it("deduplication scope 'incomplete' does not match completed jobs", async ({
      stateAdapter,
      expect,
    }) => {
      const { job: first } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "scope-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "scope-test",
          input: null,
          deduplication: { key: "scope-key", scope: "incomplete" },
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.completeJob({
          txContext,
          jobId: first.id,
          output: null,
          workerId: null,
        }),
      );

      const { deduplicated: incompleteDeduped } = await stateAdapter.runInTransaction(
        async (txContext) =>
          stateAdapter.createJob({
            txContext,
            typeName: "scope-test",
            chainId: undefined,
            chainIndex: 0,
            chainTypeName: "scope-test",
            input: null,
            deduplication: { key: "scope-key", scope: "incomplete" },
          }),
      );

      expect(incompleteDeduped).toBe(false);

      const { job: anyFirst } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "scope-test-any",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "scope-test-any",
          input: null,
          deduplication: { key: "any-key", scope: "any" },
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.completeJob({
          txContext,
          jobId: anyFirst.id,
          output: null,
          workerId: null,
        }),
      );

      const { deduplicated: anyDeduped } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "scope-test-any",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "scope-test-any",
          input: null,
          deduplication: { key: "any-key", scope: "any" },
        }),
      );

      expect(anyDeduped).toBe(true);
    });

    it("creates job with schedule options", async ({ stateAdapter, expect }) => {
      const before = Date.now();
      const { job: afterMsJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "schedule-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "schedule-test",
          input: null,
          schedule: { afterMs: 5000 },
        }),
      );

      const afterMsDiff = afterMsJob.scheduledAt.getTime() - before;
      expect(afterMsDiff).toBeGreaterThanOrEqual(4900);
      expect(afterMsDiff).toBeLessThan(6000);

      const futureDate = new Date(Date.now() + 60_000);
      const { job: atJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "schedule-test-at",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "schedule-test-at",
          input: null,
          schedule: { at: futureDate },
        }),
      );

      expect(Math.abs(atJob.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(1000);
    });

    it("stores and retrieves traceContext", async ({ stateAdapter, expect }) => {
      const traceContext = { traceId: "abc123", spanId: "def456" };
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "trace-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "trace-test",
          input: null,
          traceContext,
        }),
      );

      const retrieved = await stateAdapter.getJobById({ jobId: job.id });
      expect(retrieved!.traceContext).toEqual(traceContext);
    });

    it("stores and retrieves dates correctly", async ({ stateAdapter, expect }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "date-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "date-test",
          input: null,
        }),
      );

      expect(job.createdAt).toBeInstanceOf(Date);
      expect(job.scheduledAt).toBeInstanceOf(Date);

      const timeDiff = Math.abs(Date.now() - job.createdAt.getTime());
      expect(timeDiff).toBeLessThan(5000);
    });
  });

  describe("runInTransaction", () => {
    it("maintains transaction isolation", async ({ stateAdapter, expect }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "isolation-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "isolation-test",
          input: { value: "original" },
        }),
      );

      let rolledBackJobId: string | undefined;
      try {
        await stateAdapter.runInTransaction(async (txContext) => {
          const { job: innerJob } = await stateAdapter.createJob({
            txContext,
            typeName: "rollback-test",
            chainId: undefined,
            chainIndex: 0,
            chainTypeName: "rollback-test",
            input: { value: "should-rollback" },
          });
          rolledBackJobId = innerJob.id;
          throw new Error("Intentional rollback");
        });
      } catch {
        // Expected
      }

      const original = await stateAdapter.getJobById({ jobId: job.id });
      expect(original).toBeDefined();

      if (rolledBackJobId) {
        const rolledBack = await stateAdapter.getJobById({ jobId: rolledBackJobId });
        expect(rolledBack).toBeUndefined();
      }
    });
  });

  describe("getJobChainById", () => {
    it("handles job chain relationships correctly", async ({ stateAdapter, expect }) => {
      const { job: rootJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-root",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "chain-root",
          input: { step: 1 },
        }),
      );

      const chain = await stateAdapter.getJobChainById({ jobId: rootJob.id });

      expect(chain).toBeDefined();
      expect(chain![0].id).toBe(rootJob.id);
      expect(chain![0].chainId).toBe(rootJob.id);
    });

    it("returns [rootJob, lastJob] for multi-job chain", async ({ stateAdapter, expect }) => {
      const { job: rootJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-root",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "chain-root",
          input: null,
        }),
      );

      const { job: continuation } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-step2",
          chainId: rootJob.chainId,
          chainIndex: 1,
          chainTypeName: "chain-root",
          input: null,
        }),
      );

      const chain = await stateAdapter.getJobChainById({ jobId: rootJob.id });
      expect(chain).toBeDefined();
      expect(chain![0].id).toBe(rootJob.id);
      expect(chain![1]).toBeDefined();
      expect(chain![1]!.id).toBe(continuation.id);
    });
  });

  describe("addJobBlockers", () => {
    it("adds blockers and returns incomplete blocker chain IDs", async ({
      stateAdapter,
      expect,
    }) => {
      const { job: blockerJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "blocker",
          input: null,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "main",
          input: null,
        }),
      );

      const { job: updatedMain, incompleteBlockerChainIds } = await stateAdapter.runInTransaction(
        async (txContext) =>
          stateAdapter.addJobBlockers({
            txContext,
            jobId: mainJob.id,
            blockedByChainIds: [blockerJob.chainId],
          }),
      );

      expect(updatedMain.status).toBe("blocked");
      expect(incompleteBlockerChainIds).toContain(blockerJob.chainId);
    });

    it("returns empty incompleteBlockerChainIds when all blockers are completed", async ({
      stateAdapter,
      expect,
    }) => {
      const { job: blockerJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "blocker",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.completeJob({
          txContext,
          jobId: blockerJob.id,
          output: null,
          workerId: null,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "main",
          input: null,
        }),
      );

      const { job: updatedMain, incompleteBlockerChainIds } = await stateAdapter.runInTransaction(
        async (txContext) =>
          stateAdapter.addJobBlockers({
            txContext,
            jobId: mainJob.id,
            blockedByChainIds: [blockerJob.chainId],
          }),
      );

      expect(updatedMain.status).toBe("pending");
      expect(incompleteBlockerChainIds).toHaveLength(0);
    });
  });

  describe("scheduleBlockedJobs", () => {
    it("schedules blocked jobs when all blockers complete", async ({ stateAdapter, expect }) => {
      const { job: blockerJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "blocker",
          input: null,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "main",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: mainJob.id,
          blockedByChainIds: [blockerJob.chainId],
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.completeJob({
          txContext,
          jobId: blockerJob.id,
          output: null,
          workerId: null,
        }),
      );

      const { unblockedJobs } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.scheduleBlockedJobs({
          txContext,
          blockedByChainId: blockerJob.chainId,
        }),
      );

      expect(unblockedJobs).toHaveLength(1);
      expect(unblockedJobs[0].id).toBe(mainJob.id);
      expect(unblockedJobs[0].status).toBe("pending");
    });

    it("does not schedule job when not all blockers are complete", async ({
      stateAdapter,
      expect,
    }) => {
      const { job: blockerA } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "blocker",
          input: null,
        }),
      );

      const { job: blockerB } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "blocker",
          input: null,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "main",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: mainJob.id,
          blockedByChainIds: [blockerA.chainId, blockerB.chainId],
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.completeJob({
          txContext,
          jobId: blockerA.id,
          output: null,
          workerId: null,
        }),
      );

      const { unblockedJobs } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.scheduleBlockedJobs({
          txContext,
          blockedByChainId: blockerA.chainId,
        }),
      );

      expect(unblockedJobs).toHaveLength(0);

      const stillBlocked = await stateAdapter.getJobById({ jobId: mainJob.id });
      expect(stillBlocked!.status).toBe("blocked");
    });

    it("returns empty array when no blocked jobs exist for chain ID", async ({
      stateAdapter,
      expect,
    }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "standalone",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "standalone",
          input: null,
        }),
      );

      const { unblockedJobs } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.scheduleBlockedJobs({
          txContext,
          blockedByChainId: job.chainId,
        }),
      );

      expect(unblockedJobs).toHaveLength(0);
    });

    it("returns stored blocker trace contexts for a blocker chain", async ({
      stateAdapter,
      expect,
    }) => {
      const { job: blockerJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "blocker",
          input: null,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "main",
          input: null,
        }),
      );

      const traceContext = { spanId: "test-span-123" };

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: mainJob.id,
          blockedByChainIds: [blockerJob.chainId],
          blockerTraceContexts: [traceContext],
        }),
      );

      const { blockerTraceContexts } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.scheduleBlockedJobs({
          txContext,
          blockedByChainId: blockerJob.chainId,
        }),
      );

      expect(blockerTraceContexts).toHaveLength(1);
      expect(blockerTraceContexts[0]).toEqual(traceContext);
    });

    it("returns empty blocker trace contexts when no blockers exist", async ({
      stateAdapter,
      expect,
    }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "standalone",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "standalone",
          input: null,
        }),
      );

      const { blockerTraceContexts } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.scheduleBlockedJobs({
          txContext,
          blockedByChainId: job.chainId,
        }),
      );

      expect(blockerTraceContexts).toHaveLength(0);
    });

    it("returns empty blocker trace contexts when blockers have no trace contexts", async ({
      stateAdapter,
      expect,
    }) => {
      const { job: blockerJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "blocker",
          input: null,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "main",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: mainJob.id,
          blockedByChainIds: [blockerJob.chainId],
        }),
      );

      const { blockerTraceContexts } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.scheduleBlockedJobs({
          txContext,
          blockedByChainId: blockerJob.chainId,
        }),
      );

      expect(blockerTraceContexts).toHaveLength(0);
    });
  });

  describe("addJobBlockers blockerChainTraceContexts", () => {
    it("returns blocker chain trace contexts from chain root jobs", async ({
      stateAdapter,
      expect,
    }) => {
      const blockerTraceContext = { chain: "test-chain", job: "test-job" };
      const { job: blockerJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "blocker",
          input: null,
          traceContext: blockerTraceContext,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "main",
          input: null,
        }),
      );

      const { blockerChainTraceContexts } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: mainJob.id,
          blockedByChainIds: [blockerJob.chainId],
        }),
      );

      expect(blockerChainTraceContexts).toHaveLength(1);
      expect(blockerChainTraceContexts[0]).toEqual(blockerTraceContext);
    });

    it("returns blocker chain trace contexts in the same order as blockedByChainIds", async ({
      stateAdapter,
      expect,
    }) => {
      const traceA = { chain: "chain-a", job: "job-a" };
      const traceB = { chain: "chain-b", job: "job-b" };

      const { job: blockerA } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blockerA",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "blockerA",
          input: null,
          traceContext: traceA,
        }),
      );

      const { job: blockerB } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blockerB",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "blockerB",
          input: null,
          traceContext: traceB,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "main",
          input: null,
        }),
      );

      const { blockerChainTraceContexts } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: mainJob.id,
          blockedByChainIds: [blockerA.chainId, blockerB.chainId],
        }),
      );

      expect(blockerChainTraceContexts).toHaveLength(2);
      expect(blockerChainTraceContexts[0]).toEqual(traceA);
      expect(blockerChainTraceContexts[1]).toEqual(traceB);
    });
  });

  describe("getJobBlockers", () => {
    it("returns blocker chain pairs for a job", async ({ stateAdapter, expect }) => {
      const { job: blockerA } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "blocker",
          input: null,
        }),
      );

      const { job: blockerB } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "blocker",
          input: null,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "main",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: mainJob.id,
          blockedByChainIds: [blockerA.chainId, blockerB.chainId],
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
    });

    it("returns [rootJob, lastJob] for multi-job blocker chain", async ({
      stateAdapter,
      expect,
    }) => {
      const { job: blockerRoot } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker-root",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "blocker-root",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.completeJob({
          txContext,
          jobId: blockerRoot.id,
          output: null,
          workerId: null,
        }),
      );

      const { job: blockerContinuation } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker-step2",
          chainId: blockerRoot.chainId,
          chainIndex: 1,
          chainTypeName: "blocker-root",
          input: null,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "main",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: mainJob.id,
          blockedByChainIds: [blockerRoot.chainId],
        }),
      );

      const blockers = await stateAdapter.getJobBlockers({ jobId: mainJob.id });
      expect(blockers).toHaveLength(1);

      const [rootJob, lastJob] = blockers[0];
      expect(rootJob.id).toBe(blockerRoot.id);
      expect(lastJob).toBeDefined();
      expect(lastJob!.id).toBe(blockerContinuation.id);
    });

    it("returns empty array for job with no blockers", async ({ stateAdapter, expect }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "no-blockers",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "no-blockers",
          input: null,
        }),
      );

      const blockers = await stateAdapter.getJobBlockers({ jobId: job.id });
      expect(blockers).toHaveLength(0);
    });
  });

  describe("getNextJobAvailableInMs", () => {
    it("returns 0 for immediately available pending job", async ({ stateAdapter, expect }) => {
      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "avail-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "avail-test",
          input: null,
        }),
      );

      const ms = await stateAdapter.getNextJobAvailableInMs({ typeNames: ["avail-test"] });
      expect(ms).toBe(0);
    });

    it("returns milliseconds until next scheduled job", async ({ stateAdapter, expect }) => {
      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "future-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "future-test",
          input: null,
          schedule: { afterMs: 5000 },
        }),
      );

      const ms = await stateAdapter.getNextJobAvailableInMs({ typeNames: ["future-test"] });
      expect(ms).not.toBeNull();
      expect(ms!).toBeGreaterThan(3000);
      expect(ms!).toBeLessThanOrEqual(5100);
    });

    it("returns null when no pending jobs of given type exist", async ({
      stateAdapter,
      expect,
    }) => {
      const ms = await stateAdapter.getNextJobAvailableInMs({ typeNames: ["nonexistent-type"] });
      expect(ms).toBeNull();
    });
  });

  describe("acquireJob", () => {
    it("acquires oldest eligible pending job", async ({ stateAdapter, expect }) => {
      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "acquire-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "acquire-test",
          input: { order: 1 },
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "acquire-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "acquire-test",
          input: { order: 2 },
        }),
      );

      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.acquireJob({ txContext, typeNames: ["acquire-test"] }),
      );

      expect(job).toBeDefined();
      expect(job!.input).toEqual({ order: 1 });
      expect(job!.status).toBe("running");
      expect(job!.attempt).toBe(1);
    });

    it("returns hasMore when additional eligible jobs exist", async ({ stateAdapter, expect }) => {
      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "hasmore-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "hasmore-test",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "hasmore-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "hasmore-test",
          input: null,
        }),
      );

      const { job: job1, hasMore: hasMore1 } = await stateAdapter.runInTransaction(
        async (txContext) => stateAdapter.acquireJob({ txContext, typeNames: ["hasmore-test"] }),
      );
      expect(job1).toBeDefined();
      expect(hasMore1).toBe(true);

      const { job: job2 } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.acquireJob({ txContext, typeNames: ["hasmore-test"] }),
      );
      expect(job2).toBeDefined();
    });

    it("returns undefined when no eligible jobs exist", async ({ stateAdapter, expect }) => {
      const { job, hasMore } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.acquireJob({ txContext, typeNames: ["nonexistent-type"] }),
      );

      expect(job).toBeUndefined();
      expect(hasMore).toBe(false);
    });

    it("does not acquire jobs scheduled in the future", async ({ stateAdapter, expect }) => {
      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "future-acquire",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "future-acquire",
          input: null,
          schedule: { afterMs: 60_000 },
        }),
      );

      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.acquireJob({ txContext, typeNames: ["future-acquire"] }),
      );

      expect(job).toBeUndefined();
    });
  });

  describe("renewJobLease", () => {
    it("renews lease on a running job", async ({ stateAdapter, expect }) => {
      const { job: created } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "lease-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "lease-test",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.acquireJob({ txContext, typeNames: ["lease-test"] }),
      );

      const before = Date.now();
      const renewed = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.renewJobLease({
          txContext,
          jobId: created.id,
          workerId: "worker-1",
          leaseDurationMs: 10_000,
        }),
      );

      expect(renewed.leasedBy).toBe("worker-1");
      expect(renewed.leasedUntil).toBeInstanceOf(Date);
      expect(renewed.leasedUntil!.getTime()).toBeGreaterThanOrEqual(before + 9_000);
      expect(renewed.leasedUntil!.getTime()).toBeLessThan(before + 11_000);
      expect(renewed.status).toBe("running");
    });

    it("updates leasedUntil on subsequent renewals", async ({ stateAdapter, expect }) => {
      const { job: created } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "re-lease-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "re-lease-test",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.acquireJob({ txContext, typeNames: ["re-lease-test"] }),
      );

      const first = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.renewJobLease({
          txContext,
          jobId: created.id,
          workerId: "worker-1",
          leaseDurationMs: 5_000,
        }),
      );

      const second = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.renewJobLease({
          txContext,
          jobId: created.id,
          workerId: "worker-1",
          leaseDurationMs: 20_000,
        }),
      );

      expect(second.leasedUntil!.getTime()).toBeGreaterThan(first.leasedUntil!.getTime());
    });
  });

  describe("rescheduleJob", () => {
    it("reschedules a running job to pending with afterMs", async ({ stateAdapter, expect }) => {
      const { job: created } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "resched-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "resched-test",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.acquireJob({ txContext, typeNames: ["resched-test"] }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.renewJobLease({
          txContext,
          jobId: created.id,
          workerId: "worker-1",
          leaseDurationMs: 10_000,
        }),
      );

      const before = Date.now();
      const rescheduled = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.rescheduleJob({
          txContext,
          jobId: created.id,
          schedule: { afterMs: 5000 },
          error: "transient failure",
        }),
      );

      expect(rescheduled.status).toBe("pending");
      expect(rescheduled.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 4000);
      expect(rescheduled.lastAttemptError).toBe("transient failure");
      expect(rescheduled.lastAttemptAt).toBeInstanceOf(Date);
      expect(rescheduled.leasedBy).toBeNull();
      expect(rescheduled.leasedUntil).toBeNull();
    });

    it("reschedules a running job to pending with absolute date", async ({
      stateAdapter,
      expect,
    }) => {
      const { job: created } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "resched-at-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "resched-at-test",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.acquireJob({ txContext, typeNames: ["resched-at-test"] }),
      );

      const futureDate = new Date(Date.now() + 30_000);
      const rescheduled = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.rescheduleJob({
          txContext,
          jobId: created.id,
          schedule: { at: futureDate },
          error: "retry later",
        }),
      );

      expect(rescheduled.status).toBe("pending");
      expect(Math.abs(rescheduled.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(1000);
    });
  });

  describe("completeJob", () => {
    it("completes a job with output", async ({ stateAdapter, expect }) => {
      const { job: created } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "complete-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "complete-test",
          input: { value: 1 },
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.acquireJob({ txContext, typeNames: ["complete-test"] }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.renewJobLease({
          txContext,
          jobId: created.id,
          workerId: "worker-1",
          leaseDurationMs: 10_000,
        }),
      );

      const completed = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.completeJob({
          txContext,
          jobId: created.id,
          output: { result: 42 },
          workerId: "worker-1",
        }),
      );

      expect(completed.status).toBe("completed");
      expect(completed.output).toEqual({ result: 42 });
      expect(completed.completedAt).toBeInstanceOf(Date);
      expect(completed.completedBy).toBe("worker-1");
      expect(completed.leasedBy).toBeNull();
      expect(completed.leasedUntil).toBeNull();
    });

    it("completes a job with null workerId (workerless)", async ({ stateAdapter, expect }) => {
      const { job: created } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "workerless-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "workerless-test",
          input: null,
        }),
      );

      const completed = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.completeJob({
          txContext,
          jobId: created.id,
          output: { done: true },
          workerId: null,
        }),
      );

      expect(completed.status).toBe("completed");
      expect(completed.completedBy).toBeNull();
    });
  });

  describe("removeExpiredJobLease", () => {
    it("removes expired lease and resets job to pending", async ({ stateAdapter, expect }) => {
      const { job: created } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "expire-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "expire-test",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.acquireJob({ txContext, typeNames: ["expire-test"] }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.renewJobLease({
          txContext,
          jobId: created.id,
          workerId: "worker-1",
          leaseDurationMs: 1,
        }),
      );

      await sleep(10);

      const expired = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.removeExpiredJobLease({ txContext, typeNames: ["expire-test"] }),
      );

      expect(expired).toBeDefined();
      expect(expired!.id).toBe(created.id);
      expect(expired!.status).toBe("pending");
      expect(expired!.leasedBy).toBeNull();
      expect(expired!.leasedUntil).toBeNull();
    });

    it("returns undefined when no expired leases exist", async ({ stateAdapter, expect }) => {
      const { job: created } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "no-expire-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "no-expire-test",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.acquireJob({ txContext, typeNames: ["no-expire-test"] }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.renewJobLease({
          txContext,
          jobId: created.id,
          workerId: "worker-1",
          leaseDurationMs: 60_000,
        }),
      );

      const expired = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.removeExpiredJobLease({ txContext, typeNames: ["no-expire-test"] }),
      );

      expect(expired).toBeUndefined();
    });

    it("respects ignoredJobIds in removeExpiredJobLease", async ({ stateAdapter, expect }) => {
      const { job: jobA } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "ignore-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "ignore-test",
          input: { order: "a" },
        }),
      );

      const { job: jobB } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "ignore-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "ignore-test",
          input: { order: "b" },
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.acquireJob({ txContext, typeNames: ["ignore-test"] }),
      );
      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.acquireJob({ txContext, typeNames: ["ignore-test"] }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.renewJobLease({
          txContext,
          jobId: jobA.id,
          workerId: "worker-1",
          leaseDurationMs: 1,
        }),
      );
      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.renewJobLease({
          txContext,
          jobId: jobB.id,
          workerId: "worker-2",
          leaseDurationMs: 1,
        }),
      );

      await sleep(10);

      const expired = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.removeExpiredJobLease({
          txContext,
          typeNames: ["ignore-test"],
          ignoredJobIds: [jobA.id],
        }),
      );

      expect(expired).toBeDefined();
      expect(expired!.id).toBe(jobB.id);
    });
  });

  describe("deleteJobsByChainIds", () => {
    it("deletes all jobs in the given chains", async ({ stateAdapter, expect }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "delete-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "delete-test",
          input: null,
        }),
      );

      const deleted = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.deleteJobsByChainIds({
          txContext,
          chainIds: [job.chainId],
        }),
      );

      expect(deleted).toHaveLength(1);
      expect(deleted[0][0].id).toBe(job.id);
      expect(deleted[0][1]).toBeUndefined();
      expect(await stateAdapter.getJobById({ jobId: job.id })).toBeUndefined();
    });

    it("does not delete jobs from other chains", async ({ stateAdapter, expect }) => {
      const { job: jobA } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-a",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "chain-a",
          input: null,
        }),
      );

      const { job: jobB } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-b",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "chain-b",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.deleteJobsByChainIds({
          txContext,
          chainIds: [jobA.chainId],
        }),
      );

      expect(await stateAdapter.getJobById({ jobId: jobA.id })).toBeUndefined();
      expect(await stateAdapter.getJobById({ jobId: jobB.id })).toBeDefined();
    });

    it("throws BlockerReferenceError when chain is referenced as blocker", async ({
      stateAdapter,
      expect,
    }) => {
      const { job: blockerJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "blocker",
          input: null,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "main",
          input: null,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: mainJob.id,
          blockedByChainIds: [blockerJob.chainId],
        }),
      );

      await expect(
        stateAdapter.runInTransaction(async (txContext) =>
          stateAdapter.deleteJobsByChainIds({
            txContext,
            chainIds: [blockerJob.chainId],
          }),
        ),
      ).rejects.toThrow(BlockerReferenceError);

      // Deleting both together should succeed
      const deleted = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.deleteJobsByChainIds({
          txContext,
          chainIds: [mainJob.chainId, blockerJob.chainId],
        }),
      );

      expect(deleted).toHaveLength(2);
    });
  });

  describe("getJobForUpdate", () => {
    it("returns job by ID via getJobForUpdate", async ({ stateAdapter, expect }) => {
      const { job: created } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "update-test",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "update-test",
          input: { value: 1 },
        }),
      );

      const retrieved = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.getJobForUpdate({ txContext, jobId: created.id }),
      );

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.input).toEqual({ value: 1 });
    });

    it("returns undefined for nonexistent job via getJobForUpdate", async ({
      stateAdapter,
      expect,
    }) => {
      const retrieved = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.getJobForUpdate({ txContext, jobId: crypto.randomUUID() }),
      );

      expect(retrieved).toBeUndefined();
    });
  });

  describe("getCurrentJobForUpdate", () => {
    it("returns the latest job in a chain via getCurrentJobForUpdate", async ({
      stateAdapter,
      expect,
    }) => {
      const { job: rootJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-current",
          chainId: undefined,
          chainIndex: 0,
          chainTypeName: "chain-current",
          input: null,
        }),
      );

      const { job: continuation } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-current-step2",
          chainId: rootJob.chainId,
          chainIndex: 1,
          chainTypeName: "chain-current",
          input: null,
        }),
      );

      const current = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.getCurrentJobForUpdate({ txContext, chainId: rootJob.chainId }),
      );

      expect(current).toBeDefined();
      expect(current!.id).toBe(continuation.id);
    });

    it("returns undefined for nonexistent chain via getCurrentJobForUpdate", async ({
      stateAdapter,
      expect,
    }) => {
      const current = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.getCurrentJobForUpdate({ txContext, chainId: crypto.randomUUID() }),
      );

      expect(current).toBeUndefined();
    });
  });

  it("listChains returns empty page when no jobs exist", async ({ stateAdapter, expect }) => {
    const result = await stateAdapter.listChains({ page: { limit: 10 } });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("listChains filters rootOnly (excludes chains used as blockers)", async ({
    stateAdapter,
    expect,
  }) => {
    const { job: mainChain } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "main-chain",
        chainId: undefined,
        chainIndex: 0,
        chainTypeName: "main-chain",
        input: null,
      }),
    );

    const { job: blockerChain } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "blocker-chain",
        chainId: undefined,
        chainIndex: 0,
        chainTypeName: "blocker-chain",
        input: null,
      }),
    );

    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.addJobBlockers({
        txContext,
        jobId: mainChain.id,
        blockedByChainIds: [blockerChain.chainId],
      }),
    );

    const rootOnly = await stateAdapter.listChains({
      filter: { rootOnly: true },
      page: { limit: 10 },
    });
    expect(rootOnly.items).toHaveLength(1);
    expect(rootOnly.items[0][0].typeName).toBe("main-chain");

    const all = await stateAdapter.listChains({
      page: { limit: 10 },
    });
    expect(all.items).toHaveLength(2);
  });

  it("listChains returns chains as [rootJob, lastJob] pairs", async ({ stateAdapter, expect }) => {
    const { job: root } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "test-chain",
        chainId: undefined,
        chainTypeName: "test-chain",
        input: { step: 1 },
        chainIndex: 0,
      }),
    );

    const { job: continuation } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "test-chain-step2",
        chainId: root.chainId,
        chainTypeName: "test-chain",
        input: { step: 2 },
        chainIndex: 1,
      }),
    );

    const result = await stateAdapter.listChains({ page: { limit: 10 } });
    expect(result.items).toHaveLength(1);

    const [rootJob, lastJob] = result.items[0];
    expect(rootJob.id).toBe(root.id);
    expect(lastJob).toBeDefined();
    expect(lastJob!.id).toBe(continuation.id);
  });

  it("listChains filters by typeName", async ({ stateAdapter, expect }) => {
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "send-email",
        chainId: undefined,
        chainTypeName: "send-email",
        input: null,
        chainIndex: 0,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "process-payment",
        chainId: undefined,
        chainTypeName: "process-payment",
        input: null,
        chainIndex: 0,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "send-email",
        chainId: undefined,
        chainTypeName: "send-email",
        input: null,
        chainIndex: 0,
      }),
    );

    const result = await stateAdapter.listChains({
      filter: { typeName: ["send-email"] },
      page: { limit: 10 },
    });
    expect(result.items).toHaveLength(2);
    for (const [rootJob] of result.items) {
      expect(rootJob.typeName).toBe("send-email");
    }
  });

  it("listChains sorts by createdAt desc by default", async ({ stateAdapter, expect }) => {
    const { job: job1 } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "type-a",
        chainId: undefined,
        chainTypeName: "type-a",
        input: { order: 1 },
        chainIndex: 0,
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    const { job: job2 } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "type-b",
        chainId: undefined,
        chainTypeName: "type-b",
        input: { order: 2 },
        chainIndex: 0,
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    const { job: job3 } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "type-c",
        chainId: undefined,
        chainTypeName: "type-c",
        input: { order: 3 },
        chainIndex: 0,
      }),
    );

    const result = await stateAdapter.listChains({ page: { limit: 10 } });
    expect(result.items).toHaveLength(3);
    expect(result.items[0][0].id).toBe(job3.id);
    expect(result.items[1][0].id).toBe(job2.id);
    expect(result.items[2][0].id).toBe(job1.id);
  });

  it("listChains paginates with cursor", async ({ stateAdapter, expect }) => {
    const jobs = [];
    for (let i = 0; i < 5; i++) {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: `type-${i}`,
          chainId: undefined,
          chainTypeName: `type-${i}`,
          input: null,
          chainIndex: 0,
        }),
      );
      jobs.push(job);
    }

    const page1 = await stateAdapter.listChains({ page: { limit: 2 } });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await stateAdapter.listChains({
      page: { limit: 2, cursor: page1.nextCursor! },
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await stateAdapter.listChains({
      page: { limit: 2, cursor: page2.nextCursor! },
    });
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();

    const allIds = [
      ...page1.items.map(([r]) => r.id),
      ...page2.items.map(([r]) => r.id),
      ...page3.items.map(([r]) => r.id),
    ];
    expect(new Set(allIds).size).toBe(5);
  });

  it("listChains filters by id matching chain ID", async ({ stateAdapter, expect }) => {
    const { job: chain1 } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "type-a",
        chainId: undefined,
        chainTypeName: "type-a",
        input: null,
        chainIndex: 0,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "type-b",
        chainId: undefined,
        chainTypeName: "type-b",
        input: null,
        chainIndex: 0,
      }),
    );

    const result = await stateAdapter.listChains({
      filter: { id: chain1.chainId },
      page: { limit: 10 },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0][0].id).toBe(chain1.id);
  });

  it("listChains filters by id matching a job ID within a chain", async ({
    stateAdapter,
    expect,
  }) => {
    const { job: root } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "chain-type",
        chainId: undefined,
        chainTypeName: "chain-type",
        input: null,
        chainIndex: 0,
      }),
    );
    const { job: continuation } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "chain-step2",
        chainId: root.chainId,
        chainTypeName: "chain-type",
        input: null,
        chainIndex: 1,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "other-type",
        chainId: undefined,
        chainTypeName: "other-type",
        input: null,
        chainIndex: 0,
      }),
    );

    const result = await stateAdapter.listChains({
      filter: { id: continuation.id },
      page: { limit: 10 },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0][0].id).toBe(root.id);
  });

  it("listJobs returns empty page when no jobs exist", async ({ stateAdapter, expect }) => {
    const result = await stateAdapter.listJobs({ page: { limit: 10 } });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("listJobs returns all jobs across chains", async ({ stateAdapter, expect }) => {
    const { job: root } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "chain-type",
        chainId: undefined,
        chainTypeName: "chain-type",
        input: { step: 1 },
        chainIndex: 0,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "chain-step2",
        chainId: root.chainId,
        chainTypeName: "chain-type",
        input: { step: 2 },
        chainIndex: 1,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "other-type",
        chainId: undefined,
        chainTypeName: "other-type",
        input: null,
        chainIndex: 0,
      }),
    );

    const result = await stateAdapter.listJobs({ page: { limit: 10 } });
    expect(result.items).toHaveLength(3);
  });

  it("listJobs filters by chainId", async ({ stateAdapter, expect }) => {
    const { job: root } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "chain-type",
        chainId: undefined,
        chainTypeName: "chain-type",
        input: null,
        chainIndex: 0,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "chain-step2",
        chainId: root.chainId,
        chainTypeName: "chain-type",
        input: null,
        chainIndex: 1,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "other-type",
        chainId: undefined,
        chainTypeName: "other-type",
        input: null,
        chainIndex: 0,
      }),
    );

    const result = await stateAdapter.listJobs({
      filter: { chainId: root.chainId },
      page: { limit: 10 },
    });
    expect(result.items).toHaveLength(2);
    for (const job of result.items) {
      expect(job.chainId).toBe(root.chainId);
    }
  });

  it("listJobs filters by status", async ({ stateAdapter, expect }) => {
    const { job } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "test-type",
        chainId: undefined,
        chainTypeName: "test-type",
        input: null,
        chainIndex: 0,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "test-type",
        chainId: undefined,
        chainTypeName: "test-type",
        input: null,
        chainIndex: 0,
      }),
    );

    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.acquireJob({ txContext, typeNames: ["test-type"] }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.completeJob({ txContext, jobId: job.id, output: null, workerId: "w1" }),
    );

    const result = await stateAdapter.listJobs({
      filter: { status: ["completed"] },
      page: { limit: 10 },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(job.id);
  });

  it("listJobs filters by id matching job ID", async ({ stateAdapter, expect }) => {
    const { job: job1 } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "type-a",
        chainId: undefined,
        chainTypeName: "type-a",
        input: null,
        chainIndex: 0,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "type-b",
        chainId: undefined,
        chainTypeName: "type-b",
        input: null,
        chainIndex: 0,
      }),
    );

    const result = await stateAdapter.listJobs({
      filter: { id: job1.id },
      page: { limit: 10 },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(job1.id);
  });

  it("listJobs filters by id matching chain ID", async ({ stateAdapter, expect }) => {
    const { job: root } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "chain-type",
        chainId: undefined,
        chainTypeName: "chain-type",
        input: null,
        chainIndex: 0,
      }),
    );
    const { job: continuation } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "chain-step2",
        chainId: root.chainId,
        chainTypeName: "chain-type",
        input: null,
        chainIndex: 1,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "other-type",
        chainId: undefined,
        chainTypeName: "other-type",
        input: null,
        chainIndex: 0,
      }),
    );

    const result = await stateAdapter.listJobs({
      filter: { id: root.chainId },
      page: { limit: 10 },
    });
    expect(result.items).toHaveLength(2);
    const ids = result.items.map((j) => j.id).sort();
    expect(ids).toEqual([root.id, continuation.id].sort());
  });

  it("listJobs paginates with cursor", async ({ stateAdapter, expect }) => {
    for (let i = 0; i < 4; i++) {
      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "paginate-type",
          chainId: undefined,
          chainTypeName: "paginate-type",
          input: { i },
          chainIndex: 0,
        }),
      );
    }

    const page1 = await stateAdapter.listJobs({ page: { limit: 2 } });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await stateAdapter.listJobs({
      page: { limit: 2, cursor: page1.nextCursor! },
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();

    const allIds = [...page1.items.map((j) => j.id), ...page2.items.map((j) => j.id)];
    expect(new Set(allIds).size).toBe(4);
  });

  it("getJobsBlockedByChain returns jobs blocked by a chain", async ({ stateAdapter, expect }) => {
    const { job: blockerChain } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "blocker-type",
        chainId: undefined,
        chainTypeName: "blocker-type",
        input: null,
        chainIndex: 0,
      }),
    );
    const { job: blockedJob } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "blocked-type",
        chainId: undefined,
        chainTypeName: "blocked-type",
        input: null,
        chainIndex: 0,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "unrelated-type",
        chainId: undefined,
        chainTypeName: "unrelated-type",
        input: null,
        chainIndex: 0,
      }),
    );

    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.addJobBlockers({
        txContext,
        jobId: blockedJob.id,
        blockedByChainIds: [blockerChain.chainId],
      }),
    );

    const result = await stateAdapter.getJobsBlockedByChain({
      chainId: blockerChain.chainId,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(blockedJob.id);
  });

  it("getJobsBlockedByChain returns empty array when no jobs are blocked", async ({
    stateAdapter,
    expect,
  }) => {
    const { job: chain } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "test-type",
        chainId: undefined,
        chainTypeName: "test-type",
        input: null,
        chainIndex: 0,
      }),
    );
    const result = await stateAdapter.getJobsBlockedByChain({ chainId: chain.chainId });
    expect(result).toEqual([]);
  });
};
