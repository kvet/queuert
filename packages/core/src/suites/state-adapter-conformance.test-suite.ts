import { type TestAPI, describe } from "vitest";
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
          chainTypeName: "test-job",
          input: { value: 1 },
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      expect(job.id).toBeDefined();
      expect(validateId(job.id)).toBe(true);
    });

    it("assigns chainId and rootChainId correctly for new jobs", async ({
      stateAdapter,
      validateId,
      expect,
    }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-test",
          chainId: undefined,
          chainTypeName: "chain-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      expect(job.chainId).toBe(job.id);
      expect(job.rootChainId).toBe(job.id);
      expect(job.originId).toBeNull();
      expect(validateId(job.chainId)).toBe(true);
      expect(validateId(job.rootChainId)).toBe(true);
    });

    it("preserves provided chainId and rootChainId", async ({
      stateAdapter,
      validateId,
      expect,
    }) => {
      const { job: rootJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "root-job",
          chainId: undefined,
          chainTypeName: "root-job",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const { job: childJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "child-job",
          chainId: rootJob.chainId,
          chainTypeName: "root-job",
          input: null,
          rootChainId: rootJob.rootChainId,
          originId: rootJob.id,
        }),
      );

      expect(childJob.chainId).toBe(rootJob.chainId);
      expect(childJob.rootChainId).toBe(rootJob.rootChainId);
      expect(childJob.originId).toBe(rootJob.id);
      expect(validateId(childJob.id)).toBe(true);
      expect(validateId(childJob.chainId)).toBe(true);
      expect(validateId(childJob.rootChainId)).toBe(true);
      expect(validateId(childJob.originId!)).toBe(true);
    });

    it("generates unique job IDs", async ({ stateAdapter, expect }) => {
      const jobs = await stateAdapter.runInTransaction(async (txContext) => {
        const results: StateJob[] = [];
        for (let i = 0; i < 10; i++) {
          const { job } = await stateAdapter.createJob({
            txContext,
            typeName: "test-job",
            chainId: undefined,
            chainTypeName: "test-job",
            input: { value: i },
            rootChainId: undefined,
            originId: undefined,
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
          chainTypeName: "test-job",
          input,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const retrieved = await stateAdapter.getJobById({ jobId: created.id });

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.typeName).toBe("test-job");
      expect(retrieved!.input).toEqual(input);
      expect(retrieved!.status).toBe("pending");
    });

    it("stores and retrieves dates correctly", async ({ stateAdapter, expect }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "date-test",
          chainId: undefined,
          chainTypeName: "date-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      expect(job.createdAt).toBeInstanceOf(Date);
      expect(job.scheduledAt).toBeInstanceOf(Date);

      const timeDiff = Math.abs(Date.now() - job.createdAt.getTime());
      expect(timeDiff).toBeLessThan(5000);
    });

    it("handles null values correctly", async ({ stateAdapter, expect }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "null-test",
          chainId: undefined,
          chainTypeName: "null-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      expect(job.input).toBeNull();
      expect(job.output).toBeNull();
      expect(job.originId).toBeNull();
      expect(job.completedAt).toBeNull();
      expect(job.completedBy).toBeNull();
      expect(job.lastAttemptError).toBeNull();
      expect(job.lastAttemptAt).toBeNull();
      expect(job.leasedBy).toBeNull();
      expect(job.leasedUntil).toBeNull();
      expect(job.deduplicationKey).toBeNull();
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
          chainTypeName: "json-test",
          input: complexInput,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "dedup-test",
          input: { value: 1 },
          rootChainId: undefined,
          originId: undefined,
          deduplication: { key: "same-key" },
        }),
      );

      const { job: second, deduplicated } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "dedup-test",
          chainId: undefined,
          chainTypeName: "dedup-test",
          input: { value: 2 },
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "dedup-test",
          input: { value: 3 },
          rootChainId: undefined,
          originId: undefined,
          deduplication: { key: "different-key" },
        }),
      );

      expect(notDeduped).toBe(false);
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
          chainTypeName: "scope-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
            chainTypeName: "scope-test",
            input: null,
            rootChainId: undefined,
            originId: undefined,
            deduplication: { key: "scope-key", scope: "incomplete" },
          }),
      );

      expect(incompleteDeduped).toBe(false);

      const { job: anyFirst } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "scope-test-any",
          chainId: undefined,
          chainTypeName: "scope-test-any",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "scope-test-any",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "schedule-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "schedule-test-at",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "trace-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
          traceContext,
        }),
      );

      const retrieved = await stateAdapter.getJobById({ jobId: job.id });
      expect(retrieved!.traceContext).toEqual(traceContext);
    });
  });

  describe("runInTransaction", () => {
    it("maintains transaction isolation", async ({ stateAdapter, expect }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "isolation-test",
          chainId: undefined,
          chainTypeName: "isolation-test",
          input: { value: "original" },
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      let rolledBackJobId: string | undefined;
      try {
        await stateAdapter.runInTransaction(async (txContext) => {
          const { job: innerJob } = await stateAdapter.createJob({
            txContext,
            typeName: "rollback-test",
            chainId: undefined,
            chainTypeName: "rollback-test",
            input: { value: "should-rollback" },
            rootChainId: undefined,
            originId: undefined,
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
          chainTypeName: "chain-root",
          input: { step: 1 },
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const chain = await stateAdapter.getJobChainById({ jobId: rootJob.id });

      expect(chain).toBeDefined();
      expect(chain![0].id).toBe(rootJob.id);
      expect(chain![0].chainId).toBe(rootJob.id);
      expect(chain![0].rootChainId).toBe(rootJob.id);
    });

    it("returns [rootJob, lastJob] for multi-job chain", async ({ stateAdapter, expect }) => {
      const { job: rootJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-root",
          chainId: undefined,
          chainTypeName: "chain-root",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const { job: continuation } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-step2",
          chainId: rootJob.chainId,
          chainTypeName: "chain-root",
          input: null,
          rootChainId: rootJob.rootChainId,
          originId: rootJob.id,
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
          chainTypeName: "blocker",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainTypeName: "main",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const { job: updatedMain, incompleteBlockerChainIds } = await stateAdapter.runInTransaction(
        async (txContext) =>
          stateAdapter.addJobBlockers({
            txContext,
            jobId: mainJob.id,
            blockedByChainIds: [blockerJob.chainId],
            rootChainId: mainJob.rootChainId,
            originId: mainJob.id,
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
          chainTypeName: "blocker",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "main",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const { job: updatedMain, incompleteBlockerChainIds } = await stateAdapter.runInTransaction(
        async (txContext) =>
          stateAdapter.addJobBlockers({
            txContext,
            jobId: mainJob.id,
            blockedByChainIds: [blockerJob.chainId],
            rootChainId: mainJob.rootChainId,
            originId: mainJob.id,
          }),
      );

      expect(updatedMain.status).toBe("pending");
      expect(incompleteBlockerChainIds).toHaveLength(0);
    });

    it("updates rootChainId and originId on blocker chain jobs", async ({
      stateAdapter,
      expect,
    }) => {
      const { job: blockerJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainTypeName: "blocker",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      expect(blockerJob.rootChainId).toBe(blockerJob.id);
      expect(blockerJob.originId).toBeNull();

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainTypeName: "main",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: mainJob.id,
          blockedByChainIds: [blockerJob.chainId],
          rootChainId: mainJob.rootChainId,
          originId: mainJob.id,
        }),
      );

      const updatedBlocker = await stateAdapter.getJobById({ jobId: blockerJob.id });
      expect(updatedBlocker!.rootChainId).toBe(mainJob.rootChainId);
      expect(updatedBlocker!.originId).toBe(mainJob.id);
    });
  });

  describe("scheduleBlockedJobs", () => {
    it("schedules blocked jobs when all blockers complete", async ({ stateAdapter, expect }) => {
      const { job: blockerJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainTypeName: "blocker",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainTypeName: "main",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: mainJob.id,
          blockedByChainIds: [blockerJob.chainId],
          rootChainId: mainJob.rootChainId,
          originId: mainJob.id,
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

      const scheduled = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.scheduleBlockedJobs({
          txContext,
          blockedByChainId: blockerJob.chainId,
        }),
      );

      expect(scheduled).toHaveLength(1);
      expect(scheduled[0].id).toBe(mainJob.id);
      expect(scheduled[0].status).toBe("pending");
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
          chainTypeName: "blocker",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const { job: blockerB } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainTypeName: "blocker",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainTypeName: "main",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: mainJob.id,
          blockedByChainIds: [blockerA.chainId, blockerB.chainId],
          rootChainId: mainJob.rootChainId,
          originId: mainJob.id,
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

      const scheduled = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.scheduleBlockedJobs({
          txContext,
          blockedByChainId: blockerA.chainId,
        }),
      );

      expect(scheduled).toHaveLength(0);

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
          chainTypeName: "standalone",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const scheduled = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.scheduleBlockedJobs({
          txContext,
          blockedByChainId: job.chainId,
        }),
      );

      expect(scheduled).toHaveLength(0);
    });
  });

  describe("getJobBlockers", () => {
    it("returns blocker chain pairs for a job", async ({ stateAdapter, expect }) => {
      const { job: blockerA } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainTypeName: "blocker",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const { job: blockerB } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "blocker",
          chainId: undefined,
          chainTypeName: "blocker",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainTypeName: "main",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: mainJob.id,
          blockedByChainIds: [blockerA.chainId, blockerB.chainId],
          rootChainId: mainJob.rootChainId,
          originId: mainJob.id,
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
          chainTypeName: "blocker-root",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "blocker-root",
          input: null,
          rootChainId: blockerRoot.rootChainId,
          originId: blockerRoot.id,
        }),
      );

      const { job: mainJob } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main",
          chainId: undefined,
          chainTypeName: "main",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: mainJob.id,
          blockedByChainIds: [blockerRoot.chainId],
          rootChainId: mainJob.rootChainId,
          originId: mainJob.id,
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
          chainTypeName: "no-blockers",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "avail-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "future-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "acquire-test",
          input: { order: 1 },
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "acquire-test",
          chainId: undefined,
          chainTypeName: "acquire-test",
          input: { order: 2 },
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "hasmore-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "hasmore-test",
          chainId: undefined,
          chainTypeName: "hasmore-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "future-acquire",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "lease-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "re-lease-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "resched-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "resched-at-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "complete-test",
          input: { value: 1 },
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "workerless-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "expire-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "no-expire-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "ignore-test",
          input: { order: "a" },
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const { job: jobB } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "ignore-test",
          chainId: undefined,
          chainTypeName: "ignore-test",
          input: { order: "b" },
          rootChainId: undefined,
          originId: undefined,
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

  describe("getExternalBlockers", () => {
    it("returns external blocker relationships", async ({ stateAdapter, expect }) => {
      // Chain X is a shared dependency
      const { job: chainX } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "shared-dep",
          chainId: undefined,
          chainTypeName: "shared-dep",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      // Chain Y depends on X — addJobBlockers moves X into Y's root
      const { job: chainY } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main-y",
          chainId: undefined,
          chainTypeName: "main-y",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: chainY.id,
          blockedByChainIds: [chainX.chainId],
          rootChainId: chainY.rootChainId,
          originId: chainY.id,
        }),
      );

      // Chain Z also depends on X — X's rootChainId already != chainId, no post-hoc update
      const { job: chainZ } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "main-z",
          chainId: undefined,
          chainTypeName: "main-z",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: chainZ.id,
          blockedByChainIds: [chainX.chainId],
          rootChainId: chainZ.rootChainId,
          originId: chainZ.id,
        }),
      );

      // Query Y's root — X is inside Y's root, Z is external and blocked by X
      const externals = await stateAdapter.getExternalBlockers({
        rootChainIds: [chainY.rootChainId],
      });

      expect(externals).toHaveLength(1);
      expect(externals[0].jobId).toBe(chainZ.id);
      expect(externals[0].blockedRootChainId).toBe(chainZ.rootChainId);
    });

    it("returns empty array when no external blockers exist", async ({ stateAdapter, expect }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "standalone",
          chainId: undefined,
          chainTypeName: "standalone",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const externals = await stateAdapter.getExternalBlockers({
        rootChainIds: [job.rootChainId],
      });

      expect(externals).toHaveLength(0);
    });
  });

  describe("deleteJobsByRootChainIds", () => {
    it("deletes all jobs in the given root chains", async ({ stateAdapter, expect }) => {
      const { job } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "delete-test",
          chainId: undefined,
          chainTypeName: "delete-test",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const deleted = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.deleteJobsByRootChainIds({
          txContext,
          rootChainIds: [job.rootChainId],
        }),
      );

      expect(deleted).toHaveLength(1);
      expect(deleted[0].id).toBe(job.id);
      expect(await stateAdapter.getJobById({ jobId: job.id })).toBeUndefined();
    });

    it("does not delete jobs from other root chains", async ({ stateAdapter, expect }) => {
      const { job: jobA } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-a",
          chainId: undefined,
          chainTypeName: "chain-a",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const { job: jobB } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-b",
          chainId: undefined,
          chainTypeName: "chain-b",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.deleteJobsByRootChainIds({
          txContext,
          rootChainIds: [jobA.rootChainId],
        }),
      );

      expect(await stateAdapter.getJobById({ jobId: jobA.id })).toBeUndefined();
      expect(await stateAdapter.getJobById({ jobId: jobB.id })).toBeDefined();
    });
  });

  describe("getJobForUpdate", () => {
    it("returns job by ID via getJobForUpdate", async ({ stateAdapter, expect }) => {
      const { job: created } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "update-test",
          chainId: undefined,
          chainTypeName: "update-test",
          input: { value: 1 },
          rootChainId: undefined,
          originId: undefined,
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
          chainTypeName: "chain-current",
          input: null,
          rootChainId: undefined,
          originId: undefined,
        }),
      );

      const { job: continuation } = await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.createJob({
          txContext,
          typeName: "chain-current-step2",
          chainId: rootJob.chainId,
          chainTypeName: "chain-current",
          input: null,
          rootChainId: rootJob.rootChainId,
          originId: rootJob.id,
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
};
