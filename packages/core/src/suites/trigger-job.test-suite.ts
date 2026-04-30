import { type TestAPI } from "vitest";

import {
  JobNotFoundError,
  JobNotTriggerableError,
  TransactionContextRequiredError,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const triggerJobTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("triggers a future-scheduled pending job to run now", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "report",
          input: { type: "daily" },
          schedule: { afterMs: 60 * 60 * 1000 },
        }),
      ),
    );

    const beforeTrigger = await client.getJob({ id: chain.id });
    expect(beforeTrigger!.status).toBe("pending");
    expect(beforeTrigger!.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 30_000);

    const before = Date.now();
    const triggered = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.triggerJob({ ...txCtx, transactionHooks, id: chain.id }),
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
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          task: {
            attemptHandler: async ({ job, complete }) =>
              complete(async () => ({ result: job.input.value * 2 })),
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "task",
          input: { value: 21 },
          schedule: { afterMs: 60 * 60 * 1000 },
        }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.triggerJob({ ...txCtx, transactionHooks, id: chain.id }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, {
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
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      task: { entry: true; input: null; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({ ...txCtx, transactionHooks, typeName: "task", input: null }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.deleteChains({ ...txCtx, transactionHooks, ids: [chain.id] }),
      ),
    );

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.triggerJob({ ...txCtx, transactionHooks, id: chain.id }),
        ),
      ),
    ).rejects.toThrow(JobNotFoundError);
  });

  it("throws JobNotTriggerableError for completed job", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      task: { entry: true; input: null; output: { done: true } };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          task: {
            attemptHandler: async ({ complete }) => complete(async () => ({ done: true as const })),
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({ ...txCtx, transactionHooks, typeName: "task", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 100 });
    });

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.triggerJob({ ...txCtx, transactionHooks, id: chain.id }),
        ),
      ),
    ).rejects.toThrow(JobNotTriggerableError);
  });

  it("throws when called without transaction context", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "report",
          input: { type: "daily" },
          schedule: { afterMs: 60_000 },
        }),
      ),
    );

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        // @ts-expect-error missing txCtx
        client.triggerJob({ transactionHooks, id: chain.id }),
      ),
    ).rejects.toThrow(TransactionContextRequiredError);
  });

  it("throws JobNotTriggerableError for blocked job", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const blockerChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({ ...txCtx, transactionHooks, typeName: "blocker", input: null }),
      ),
    );

    const blockedChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
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
        withTransaction(async (txCtx) =>
          client.triggerJob({ ...txCtx, transactionHooks, id: blockedChain.id }),
        ),
      ),
    ).rejects.toThrow(JobNotTriggerableError);
  });

  it("triggerJobs triggers multiple pending jobs in input order", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      task: { entry: true; input: { value: number }; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chains = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "task", input: { value: 1 }, schedule: { afterMs: 60 * 60 * 1000 } },
            { typeName: "task", input: { value: 2 }, schedule: { afterMs: 60 * 60 * 1000 } },
            { typeName: "task", input: { value: 3 }, schedule: { afterMs: 60 * 60 * 1000 } },
          ],
        }),
      ),
    );

    const before = Date.now();
    const ids = chains.map((c) => c.id);
    const triggered = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => client.triggerJobs({ ...txCtx, transactionHooks, ids })),
    );

    expect(triggered).toHaveLength(3);
    for (let i = 0; i < triggered.length; i++) {
      expect(triggered[i].id).toBe(ids[i]);
      expect(triggered[i].status).toBe("pending");
      expect(triggered[i].scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(triggered[i].scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });

  it("triggerJobs with empty ids returns empty array", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      task: { entry: true; input: null; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const triggered = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => client.triggerJobs({ ...txCtx, transactionHooks, ids: [] })),
    );

    expect(triggered).toEqual([]);
  });

  it("triggerJobs fails atomically when any job is missing", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      task: { entry: true; input: { value: number }; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const [chainA, chainB] = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "task", input: { value: 1 }, schedule: { afterMs: 60 * 60 * 1000 } },
            { typeName: "task", input: { value: 2 }, schedule: { afterMs: 60 * 60 * 1000 } },
          ],
        }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.deleteChains({ ...txCtx, transactionHooks, ids: [chainB.id] }),
      ),
    );

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.triggerJobs({
            ...txCtx,
            transactionHooks,
            ids: [chainA.id, chainB.id],
          }),
        ),
      ),
    ).rejects.toThrow(JobNotFoundError);

    const chainAJob = await client.getJob({ id: chainA.id });
    expect(chainAJob!.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
  });

  it("triggerJobs fails atomically when any job is not pending", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      task: { entry: true; input: { value: number }; output: { done: true } };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          task: {
            attemptHandler: async ({ complete }) => complete(async () => ({ done: true as const })),
          },
        },
      }),
    });

    const completedChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "task",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(completedChain, { timeoutMs: 5000, pollIntervalMs: 100 });
    });

    const pendingChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "task",
          input: { value: 2 },
          schedule: { afterMs: 60 * 60 * 1000 },
        }),
      ),
    );

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.triggerJobs({
            ...txCtx,
            transactionHooks,
            ids: [pendingChain.id, completedChain.id],
          }),
        ),
      ),
    ).rejects.toThrow(JobNotTriggerableError);

    const pendingJob = await client.getJob({ id: pendingChain.id });
    expect(pendingJob!.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
  });

  it("triggerJobs throws when called without transaction context", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      task: { entry: true; input: null; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "task",
          input: null,
          schedule: { afterMs: 60_000 },
        }),
      ),
    );

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        // @ts-expect-error missing txCtx
        client.triggerJobs({ transactionHooks, ids: [chain.id] }),
      ),
    ).rejects.toThrow(TransactionContextRequiredError);
  });
};
