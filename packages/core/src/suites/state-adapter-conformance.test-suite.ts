import { type TestAPI } from "vitest";
import { type StateAdapter, type StateJob } from "../state-adapter/state-adapter.js";

export type StateAdapterConformanceContext = {
  stateAdapter: StateAdapter<{ $test: true }, string>;
  validateId: (id: string) => boolean;
};

export const stateAdapterConformanceTestSuite = ({
  it,
}: {
  it: TestAPI<StateAdapterConformanceContext>;
}): void => {
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

  it("preserves provided chainId and rootChainId", async ({ stateAdapter, validateId, expect }) => {
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

  it("listChains returns empty page when no jobs exist", async ({ stateAdapter, expect }) => {
    const result = await stateAdapter.listChains({ page: { limit: 10 } });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("listChains returns chains as [rootJob, lastJob] pairs", async ({ stateAdapter, expect }) => {
    const { job: root } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "test-chain",
        chainId: undefined,
        chainTypeName: "test-chain",
        input: { step: 1 },
        rootChainId: undefined,
        originId: undefined,
      }),
    );

    const { job: continuation } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "test-chain-step2",
        chainId: root.chainId,
        chainTypeName: "test-chain",
        input: { step: 2 },
        rootChainId: root.rootChainId,
        originId: root.id,
      }),
    );

    const result = await stateAdapter.listChains({ page: { limit: 10 } });
    expect(result.items).toHaveLength(1);

    const [rootJob, lastJob] = result.items[0];
    expect(rootJob.id).toBe(root.id);
    expect(lastJob).toBeDefined();
    expect(lastJob!.id).toBe(continuation.id);
  });

  it("listChains filters rootOnly chains", async ({ stateAdapter, expect }) => {
    const { job: rootChain } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "main-chain",
        chainId: undefined,
        chainTypeName: "main-chain",
        input: null,
        rootChainId: undefined,
        originId: undefined,
      }),
    );

    const { job: blockerChain } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "blocker-chain",
        chainId: undefined,
        chainTypeName: "blocker-chain",
        input: null,
        rootChainId: undefined,
        originId: undefined,
      }),
    );

    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.addJobBlockers({
        txContext,
        jobId: rootChain.id,
        blockedByChainIds: [blockerChain.chainId],
        rootChainId: rootChain.rootChainId,
        originId: rootChain.id,
      }),
    );

    const rootOnly = await stateAdapter.listChains({
      filter: { rootOnly: true },
      page: { limit: 10 },
    });
    expect(rootOnly.items).toHaveLength(1);
    expect(rootOnly.items[0][0].typeName).toBe("main-chain");

    const all = await stateAdapter.listChains({
      filter: { rootOnly: false },
      page: { limit: 10 },
    });
    expect(all.items).toHaveLength(2);
  });

  it("listChains filters by typeName", async ({ stateAdapter, expect }) => {
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "send-email",
        chainId: undefined,
        chainTypeName: "send-email",
        input: null,
        rootChainId: undefined,
        originId: undefined,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "process-payment",
        chainId: undefined,
        chainTypeName: "process-payment",
        input: null,
        rootChainId: undefined,
        originId: undefined,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "send-email",
        chainId: undefined,
        chainTypeName: "send-email",
        input: null,
        rootChainId: undefined,
        originId: undefined,
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
        rootChainId: undefined,
        originId: undefined,
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
        rootChainId: undefined,
        originId: undefined,
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
        rootChainId: undefined,
        originId: undefined,
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
          rootChainId: undefined,
          originId: undefined,
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
        rootChainId: undefined,
        originId: undefined,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "type-b",
        chainId: undefined,
        chainTypeName: "type-b",
        input: null,
        rootChainId: undefined,
        originId: undefined,
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
        rootChainId: undefined,
        originId: undefined,
      }),
    );
    const { job: continuation } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "chain-step2",
        chainId: root.chainId,
        chainTypeName: "chain-type",
        input: null,
        rootChainId: root.rootChainId,
        originId: root.id,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "other-type",
        chainId: undefined,
        chainTypeName: "other-type",
        input: null,
        rootChainId: undefined,
        originId: undefined,
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
        rootChainId: undefined,
        originId: undefined,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "chain-step2",
        chainId: root.chainId,
        chainTypeName: "chain-type",
        input: { step: 2 },
        rootChainId: root.rootChainId,
        originId: root.id,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "other-type",
        chainId: undefined,
        chainTypeName: "other-type",
        input: null,
        rootChainId: undefined,
        originId: undefined,
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
        rootChainId: undefined,
        originId: undefined,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "chain-step2",
        chainId: root.chainId,
        chainTypeName: "chain-type",
        input: null,
        rootChainId: root.rootChainId,
        originId: root.id,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "other-type",
        chainId: undefined,
        chainTypeName: "other-type",
        input: null,
        rootChainId: undefined,
        originId: undefined,
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
        rootChainId: undefined,
        originId: undefined,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "test-type",
        chainId: undefined,
        chainTypeName: "test-type",
        input: null,
        rootChainId: undefined,
        originId: undefined,
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
        rootChainId: undefined,
        originId: undefined,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "type-b",
        chainId: undefined,
        chainTypeName: "type-b",
        input: null,
        rootChainId: undefined,
        originId: undefined,
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
        rootChainId: undefined,
        originId: undefined,
      }),
    );
    const { job: continuation } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "chain-step2",
        chainId: root.chainId,
        chainTypeName: "chain-type",
        input: null,
        rootChainId: root.rootChainId,
        originId: root.id,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "other-type",
        chainId: undefined,
        chainTypeName: "other-type",
        input: null,
        rootChainId: undefined,
        originId: undefined,
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
          rootChainId: undefined,
          originId: undefined,
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
        rootChainId: undefined,
        originId: undefined,
      }),
    );
    const { job: blockedJob } = await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "blocked-type",
        chainId: undefined,
        chainTypeName: "blocked-type",
        input: null,
        rootChainId: undefined,
        originId: undefined,
      }),
    );
    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.createJob({
        txContext,
        typeName: "unrelated-type",
        chainId: undefined,
        chainTypeName: "unrelated-type",
        input: null,
        rootChainId: undefined,
        originId: undefined,
      }),
    );

    await stateAdapter.runInTransaction(async (txContext) =>
      stateAdapter.addJobBlockers({
        txContext,
        jobId: blockedJob.id,
        blockedByChainIds: [blockerChain.chainId],
        rootChainId: blockedJob.rootChainId,
        originId: blockedJob.id,
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
        rootChainId: undefined,
        originId: undefined,
      }),
    );
    const result = await stateAdapter.getJobsBlockedByChain({ chainId: chain.chainId });
    expect(result).toEqual([]);
  });
};
