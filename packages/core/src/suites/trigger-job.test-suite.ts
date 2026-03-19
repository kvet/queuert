import { type TestAPI } from "vitest";
import {
  JobNotFoundError,
  JobNotTriggerableError,
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
} from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const triggerJobTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("triggers a future-scheduled pending job to run now", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypeRegistry<{
      report: {
        entry: true;
        input: { type: string };
        output: { generatedAt: string };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "report",
          input: { type: "daily" },
          schedule: { afterMs: 60 * 60 * 1000 },
        }),
      ),
    );

    const beforeTrigger = await client.getJob({ id: jobChain.id });
    expect(beforeTrigger!.status).toBe("pending");
    expect(beforeTrigger!.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 30_000);

    const before = Date.now();
    const triggered = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.triggerJob({ ...txCtx, transactionHooks, id: jobChain.id }),
      ),
    );

    expect(triggered.status).toBe("pending");
    expect(triggered.scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(triggered.scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(triggered.typeName).toBe("report");
    expect(triggered.input).toEqual({ type: "daily" });
  });

  it("triggered job is picked up by worker", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypeRegistry<{
      task: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
        client,
        jobTypeRegistry,
        processors: {
          task: {
            attemptHandler: async ({ job, complete }) =>
              complete(async () => ({ result: job.input.value * 2 })),
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "task",
          input: { value: 21 },
          schedule: { afterMs: 60 * 60 * 1000 },
        }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.triggerJob({ ...txCtx, transactionHooks, id: jobChain.id }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, {
        timeoutMs: 5000,
        pollIntervalMs: 100,
      });

      expect(completed.status).toBe("completed");
      expect(completed.output).toEqual({ result: 42 });
    });
  });

  it("throws JobNotFoundError for nonexistent job", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypeRegistry<{
      task: { entry: true; input: null; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({ ...txCtx, transactionHooks, typeName: "task", input: null }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.deleteJobChains({ ...txCtx, transactionHooks, ids: [chain.id] }),
      ),
    );

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.triggerJob({ ...txCtx, transactionHooks, id: chain.id }),
        ),
      ),
    ).rejects.toThrow(JobNotFoundError);
  });

  it("throws JobNotTriggerableError for completed job", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypeRegistry<{
      task: { entry: true; input: null; output: { done: true } };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
        client,
        jobTypeRegistry,
        processors: {
          task: {
            attemptHandler: async ({ complete }) => complete(async () => ({ done: true as const })),
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({ ...txCtx, transactionHooks, typeName: "task", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitJobChain(jobChain, { timeoutMs: 5000, pollIntervalMs: 100 });
    });

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.triggerJob({ ...txCtx, transactionHooks, id: jobChain.id }),
        ),
      ),
    ).rejects.toThrow(JobNotTriggerableError);
  });

  it("throws JobNotTriggerableError for blocked job", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypeRegistry<{
      blocker: { entry: true; input: null; output: null };
      blocked: {
        entry: true;
        input: null;
        output: null;
        blockers: [{ typeName: "blocker" }];
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });

    const blockerChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({ ...txCtx, transactionHooks, typeName: "blocker", input: null }),
      ),
    );

    const blockedChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocked",
          input: null,
          blockers: [blockerChain],
        }),
      ),
    );

    const blockedJob = await client.getJob({ id: blockedChain.id });
    expect(blockedJob!.status).toBe("blocked");

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.triggerJob({ ...txCtx, transactionHooks, id: blockedChain.id }),
        ),
      ),
    ).rejects.toThrow(JobNotTriggerableError);
  });
};
