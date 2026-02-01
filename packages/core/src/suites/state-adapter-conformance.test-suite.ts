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
    expect(job.updatedAt).toBeInstanceOf(Date);

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
};
