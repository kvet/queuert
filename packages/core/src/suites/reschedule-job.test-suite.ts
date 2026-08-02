import { type TestAPI } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import {
  JobNotFoundError,
  JobNotReschedulableError,
  JobsNotFoundError,
  JobsNotReschedulableError,
} from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const rescheduleJobTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("reschedules a future-scheduled pending job to run now", async ({
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
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "report",
          input: { type: "daily" },
          schedule: { afterMs: 60 * 60 * 1000 },
        }),
      ),
    );

    const beforeReschedule = await client.getJob({ id: chain.id });
    expect(beforeReschedule!.status).toBe("pending");
    expect(beforeReschedule!.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 30_000);

    const before = Date.now();
    const rescheduled = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.rescheduleJob({ ...txCtx, transactionHooks, id: chain.id }),
      ),
    );

    expect(rescheduled.status).toBe("pending");
    expect(rescheduled.scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(rescheduled.scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(rescheduled.typeName).toBe("report");
    expect(rescheduled.input).toEqual({ type: "daily" });
  });

  it("reschedules a pending job to a future absolute date", async ({
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
        client.createChain({ ...txCtx, transactionHooks, typeName: "task", input: null }),
      ),
    );

    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    const rescheduled = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.rescheduleJob({
          ...txCtx,
          transactionHooks,
          id: chain.id,
          schedule: { at: futureDate },
        }),
      ),
    );

    expect(rescheduled.status).toBe("pending");
    expect(Math.abs(rescheduled.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(1000);
  });

  it("reschedules a pending job into the future with afterMs", async ({
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
        client.createChain({ ...txCtx, transactionHooks, typeName: "task", input: null }),
      ),
    );

    const before = Date.now();
    const rescheduled = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.rescheduleJob({
          ...txCtx,
          transactionHooks,
          id: chain.id,
          schedule: { afterMs: 60 * 60 * 1000 },
        }),
      ),
    );

    expect(rescheduled.status).toBe("pending");
    expect(rescheduled.scheduledAt.getTime()).toBeGreaterThanOrEqual(
      before + 60 * 60 * 1000 - 1000,
    );
  });

  it("rescheduled job is picked up by worker", async ({
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
        client.createChain({
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
        client.rescheduleJob({ ...txCtx, transactionHooks, id: chain.id }),
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
        client.createChain({ ...txCtx, transactionHooks, typeName: "task", input: null }),
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
          client.rescheduleJob({ ...txCtx, transactionHooks, id: chain.id }),
        ),
      ),
    ).rejects.toThrow(JobNotFoundError);
  });

  it("throws JobNotReschedulableError for completed job", async ({
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
        client.createChain({ ...txCtx, transactionHooks, typeName: "task", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 100 });
    });

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.rescheduleJob({ ...txCtx, transactionHooks, id: chain.id }),
        ),
      ),
    ).rejects.toThrow(JobNotReschedulableError);
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
        client.createChain({
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
        client.rescheduleJob({ transactionHooks, id: chain.id }),
      ),
    ).rejects.toThrow("requires a transaction context");
  });

  it("reschedules a blocked job", async ({
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
        client.createChain({ ...txCtx, transactionHooks, typeName: "blocker", input: null }),
      ),
    );

    const blockedChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocked",
          input: null,
          blockers: [blockerChain],
          schedule: { afterMs: 60_000 },
        }),
      ),
    );

    const blockedJob = await client.getJob({ id: blockedChain.id });
    expect(blockedJob!.status).toBe("pending");
    expect(blockedJob!.status === "pending" && blockedJob!.blocked).toBe(true);

    const futureDate = new Date(Date.now() + 120_000);
    const rescheduled = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.rescheduleJob({
          ...txCtx,
          transactionHooks,
          id: blockedChain.id,
          schedule: { at: futureDate },
        }),
      ),
    );

    expect(rescheduled.status).toBe("pending");
    expect(rescheduled.status === "pending" && rescheduled.blocked).toBe(true);
    expect(Math.abs(rescheduled.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(1000);
  });

  it("rescheduleJobs reschedules multiple pending jobs in input order", async ({
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
        client.createChains({
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
    const rescheduled = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => client.rescheduleJobs({ ...txCtx, transactionHooks, ids })),
    );

    expect(rescheduled).toHaveLength(3);
    for (let i = 0; i < rescheduled.length; i++) {
      expect(rescheduled[i].id).toBe(ids[i]);
      expect(rescheduled[i].status).toBe("pending");
      expect(rescheduled[i].scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(rescheduled[i].scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });

  it("rescheduleJobs applies a future schedule to all jobs", async ({
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
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "task", input: { value: 1 } },
            { typeName: "task", input: { value: 2 } },
          ],
        }),
      ),
    );

    const ids = chains.map((c) => c.id);
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    const rescheduled = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.rescheduleJobs({ ...txCtx, transactionHooks, ids, schedule: { at: futureDate } }),
      ),
    );

    expect(rescheduled).toHaveLength(2);
    for (const job of rescheduled) {
      expect(Math.abs(job.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(1000);
    }
  });

  it("rescheduleJobs with empty ids returns empty array", async ({
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

    const rescheduled = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.rescheduleJobs({ ...txCtx, transactionHooks, ids: [] }),
      ),
    );

    expect(rescheduled).toEqual([]);
  });

  it("rescheduleJobs fails atomically when any job is missing", async ({
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
        client.createChains({
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
          client.rescheduleJobs({
            ...txCtx,
            transactionHooks,
            ids: [chainA.id, chainB.id],
          }),
        ),
      ),
    ).rejects.toThrow(JobsNotFoundError);

    const chainAJob = await client.getJob({ id: chainA.id });
    expect(chainAJob!.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
  });

  it("rescheduleJobs fails atomically when any job is not pending", async ({
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
        client.createChain({
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
        client.createChain({
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
          client.rescheduleJobs({
            ...txCtx,
            transactionHooks,
            ids: [pendingChain.id, completedChain.id],
          }),
        ),
      ),
    ).rejects.toThrow(JobsNotReschedulableError);

    const pendingJob = await client.getJob({ id: pendingChain.id });
    expect(pendingJob!.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
  });

  it("rescheduleJobs throws when called without transaction context", async ({
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
        client.createChain({
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
        client.rescheduleJobs({ transactionHooks, ids: [chain.id] }),
      ),
    ).rejects.toThrow("requires a transaction context");
  });
};
