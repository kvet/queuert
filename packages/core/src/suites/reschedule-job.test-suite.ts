import { type TestAPI, expect } from "vitest";

import { createClient } from "../client.ts";
import {
  JobNotFoundError,
  JobNotReschedulableError,
  JobsNotFoundError,
  JobsNotReschedulableError,
} from "../errors.ts";
import { createInProcessWorker } from "../in-process-worker.ts";
import { createProcessors } from "../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../job-types/define-job-types.ts";
import { withTxHooks } from "../tx-hooks/tx-hooks.ts";
import type { TestSuiteContext } from "./spec-context.spec-helper.ts";

export const rescheduleJobTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("reschedules a future-scheduled pending job to run now", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "report",
        input: { type: "daily" },
        schedule: { afterMs: 60 * 60 * 1000 },
      }),
    );

    const beforeReschedule = await client.getJob({ id: chain.id });
    expect(beforeReschedule!.status).toBe("pending");
    expect(beforeReschedule!.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 30_000);

    const before = Date.now();
    const rescheduled = await withTransaction(async (txCtx, txHooks) =>
      client.rescheduleJob({ ...txCtx, txHooks, id: chain.id }),
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({ ...txCtx, txHooks, typeName: "task", input: null }),
    );

    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    const rescheduled = await withTransaction(async (txCtx, txHooks) =>
      client.rescheduleJob({
        ...txCtx,
        txHooks,
        id: chain.id,
        schedule: { at: futureDate },
      }),
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({ ...txCtx, txHooks, typeName: "task", input: null }),
    );

    const before = Date.now();
    const rescheduled = await withTransaction(async (txCtx, txHooks) =>
      client.rescheduleJob({
        ...txCtx,
        txHooks,
        id: chain.id,
        schedule: { afterMs: 60 * 60 * 1000 },
      }),
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
              withTransaction(async (txCtx, txHooks) =>
                complete({ ...txCtx, txHooks, output: { result: job.input.value * 2 } }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "task",
        input: { value: 21 },
        schedule: { afterMs: 60 * 60 * 1000 },
      }),
    );

    await withTransaction(async (txCtx, txHooks) =>
      client.rescheduleJob({ ...txCtx, txHooks, id: chain.id }),
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({ ...txCtx, txHooks, typeName: "task", input: null }),
    );

    await withTransaction(async (txCtx, txHooks) =>
      client.deleteChains({ ...txCtx, txHooks, ids: [chain.id] }),
    );

    await expect(
      withTransaction(async (txCtx, txHooks) =>
        client.rescheduleJob({ ...txCtx, txHooks, id: chain.id }),
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
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, txHooks) =>
                complete({ ...txCtx, txHooks, output: { done: true as const } }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({ ...txCtx, txHooks, typeName: "task", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 100 });
    });

    await expect(
      withTransaction(async (txCtx, txHooks) =>
        client.rescheduleJob({ ...txCtx, txHooks, id: chain.id }),
      ),
    ).rejects.toThrow(JobNotReschedulableError);
  });

  it("throws when called without transaction context or txHooks", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "report",
        input: { type: "daily" },
        schedule: { afterMs: 60_000 },
      }),
    );

    await expect(
      // @ts-expect-error missing txCtx
      client.rescheduleJob({ id: chain.id }),
    ).rejects.toThrow("requires a transaction context");
    await withTransaction(async (txCtx) => {
      await expect(
        // @ts-expect-error missing txHooks
        client.rescheduleJob({ ...txCtx, id: chain.id }),
      ).rejects.toThrow("rescheduleJobs requires txHooks");
    });
  });

  it("rescheduleJob throws when the context is not in a transaction", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withNonTransactionContext,
    observabilityAdapter,
    log,
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "task",
        input: null,
        schedule: { afterMs: 60_000 },
      }),
    );

    await withNonTransactionContext(async (txCtx) =>
      withTxHooks(async (txHooks) => {
        await expect(
          client.rescheduleJob({
            ...txCtx,
            txHooks,
            id: chain.id,
            schedule: { afterMs: 0 },
          }),
        ).rejects.toThrow("not in a transaction");
      }),
    );

    const job = await client.getJob({ id: chain.id });
    expect(job!.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
  });

  it("throws JobNotReschedulableError for blocked job", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const blockedChain = await withTransaction(async (txCtx, txHooks) => {
      const blockerChain = await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "blocker",
        input: null,
      });
      return client.createChain({
        ...txCtx,
        txHooks,
        typeName: "blocked",
        input: null,
        blockers: [blockerChain],
      });
    });

    await expect(
      withTransaction(async (txCtx, txHooks) =>
        client.rescheduleJob({ ...txCtx, txHooks, id: blockedChain.id }),
      ),
    ).rejects.toThrow(JobNotReschedulableError);
  });

  it("rescheduleJobs returns the job at every position of a repeated id", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "task",
        input: null,
        schedule: { afterMs: 60 * 60 * 1000 },
      }),
    );

    const rescheduled = await withTransaction(async (txCtx, txHooks) =>
      client.rescheduleJobs({ ...txCtx, txHooks, ids: [chain.id, chain.id] }),
    );

    expect(rescheduled.map((job) => job.id)).toEqual([chain.id, chain.id]);
    expect(rescheduled.map((job) => job.status)).toEqual(["pending", "pending"]);
  });

  it("rescheduleJobs reschedules multiple pending jobs in input order", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const chains = await withTransaction(async (txCtx, txHooks) =>
      client.createChains({
        ...txCtx,
        txHooks,
        items: [
          { typeName: "task", input: { value: 1 }, schedule: { afterMs: 60 * 60 * 1000 } },
          { typeName: "task", input: { value: 2 }, schedule: { afterMs: 60 * 60 * 1000 } },
          { typeName: "task", input: { value: 3 }, schedule: { afterMs: 60 * 60 * 1000 } },
        ],
      }),
    );

    const before = Date.now();
    const ids = chains.map((c) => c.id);
    const rescheduled = await withTransaction(async (txCtx, txHooks) =>
      client.rescheduleJobs({ ...txCtx, txHooks, ids }),
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

    const chains = await withTransaction(async (txCtx, txHooks) =>
      client.createChains({
        ...txCtx,
        txHooks,
        items: [
          { typeName: "task", input: { value: 1 } },
          { typeName: "task", input: { value: 2 } },
        ],
      }),
    );

    const ids = chains.map((c) => c.id);
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    const rescheduled = await withTransaction(async (txCtx, txHooks) =>
      client.rescheduleJobs({ ...txCtx, txHooks, ids, schedule: { at: futureDate } }),
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

    const rescheduled = await withTransaction(async (txCtx, txHooks) =>
      client.rescheduleJobs({ ...txCtx, txHooks, ids: [] }),
    );

    expect(rescheduled).toEqual([]);
  });

  it("rescheduleJobs fails atomically when any job is missing", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const [chainA, chainB] = await withTransaction(async (txCtx, txHooks) =>
      client.createChains({
        ...txCtx,
        txHooks,
        items: [
          { typeName: "task", input: { value: 1 }, schedule: { afterMs: 60 * 60 * 1000 } },
          { typeName: "task", input: { value: 2 }, schedule: { afterMs: 60 * 60 * 1000 } },
        ],
      }),
    );

    await withTransaction(async (txCtx, txHooks) =>
      client.deleteChains({ ...txCtx, txHooks, ids: [chainB.id] }),
    );

    await expect(
      withTransaction(async (txCtx, txHooks) =>
        client.rescheduleJobs({
          ...txCtx,
          txHooks,
          ids: [chainA.id, chainB.id],
        }),
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
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, txHooks) =>
                complete({ ...txCtx, txHooks, output: { done: true as const } }),
              ),
          },
        },
      }),
    });

    const completedChain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "task",
        input: { value: 1 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(completedChain, { timeoutMs: 5000, pollIntervalMs: 100 });
    });

    const pendingChain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "task",
        input: { value: 2 },
        schedule: { afterMs: 60 * 60 * 1000 },
      }),
    );

    await expect(
      withTransaction(async (txCtx, txHooks) =>
        client.rescheduleJobs({
          ...txCtx,
          txHooks,
          ids: [pendingChain.id, completedChain.id],
        }),
      ),
    ).rejects.toThrow(JobsNotReschedulableError);

    const pendingJob = await client.getJob({ id: pendingChain.id });
    expect(pendingJob!.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
  });

  it("rescheduleJobs throws when called without transaction context or txHooks", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "task",
        input: null,
        schedule: { afterMs: 60_000 },
      }),
    );

    await expect(
      // @ts-expect-error missing txCtx
      client.rescheduleJobs({ ids: [chain.id] }),
    ).rejects.toThrow("requires a transaction context");
    await withTransaction(async (txCtx) => {
      await expect(
        // @ts-expect-error missing txHooks
        client.rescheduleJobs({ ...txCtx, ids: [chain.id] }),
      ).rejects.toThrow("rescheduleJobs requires txHooks");
    });
  });

  it("rescheduleJobs throws when the context is not in a transaction", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withNonTransactionContext,
    observabilityAdapter,
    log,
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "task",
        input: null,
        schedule: { afterMs: 60_000 },
      }),
    );

    await withNonTransactionContext(async (txCtx) =>
      withTxHooks(async (txHooks) => {
        await expect(
          client.rescheduleJobs({
            ...txCtx,
            txHooks,
            ids: [chain.id],
            schedule: { afterMs: 0 },
          }),
        ).rejects.toThrow("not in a transaction");
      }),
    );

    const job = await client.getJob({ id: chain.id });
    expect(job!.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
  });
};
