import { describe, expect, it } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { JobTypeValidationError } from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import {
  type InProcessStateAdapter,
  createInProcessStateAdapter,
} from "../state-adapter/state-adapter.in-process.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { type AttemptMiddleware } from "../worker/attempt-middleware.js";
import { createProcessors } from "../worker/create-processors.js";
import { cleanupJobTypeName, createCleanupJobTypes } from "./cleanup-job-types.js";
import { createCleanupProcessors } from "./cleanup-processors.js";

const completionOptions = { timeoutMs: 5000, pollIntervalMs: 50 };
const retentionMs = 0;
const intervalMs = 60_000;

const workJobTypes = defineJobTypes<{
  work: { entry: true; input: { value: number }; output: { done: true } };
}>();

describe("createCleanupJobTypes", () => {
  const jobTypes = createCleanupJobTypes();

  it("registers the cleanup type as an entry point", () => {
    expect(jobTypes.getTypeNames()).toEqual([cleanupJobTypeName]);
    expect(() => {
      jobTypes.validateEntry(cleanupJobTypeName);
    }).not.toThrow();
    expect(() => {
      jobTypes.validateEntry("work");
    }).toThrow(JobTypeValidationError);
  });

  it("parses a valid input", () => {
    expect(jobTypes.parseInput(cleanupJobTypeName, { retentionMs: 1, intervalMs: 2 })).toEqual({
      retentionMs: 1,
      intervalMs: 2,
    });
  });

  it.each([
    ["missing intervalMs", { retentionMs: 1 }],
    ["negative retentionMs", { retentionMs: -1, intervalMs: 2 }],
    ["non-finite intervalMs", { retentionMs: 1, intervalMs: Number.POSITIVE_INFINITY }],
    ["non-numeric retentionMs", { retentionMs: "1", intervalMs: 2 }],
    ["not an object", null],
  ])("rejects %s", (_label, input) => {
    expect(() => jobTypes.parseInput(cleanupJobTypeName, input)).toThrow(JobTypeValidationError);
  });

  it("rejects a non-null output", () => {
    expect(jobTypes.parseOutput(cleanupJobTypeName, null)).toBeNull();
    expect(() => jobTypes.parseOutput(cleanupJobTypeName, { done: true })).toThrow(
      JobTypeValidationError,
    );
  });

  it("rejects continuations and blockers", () => {
    expect(() => {
      jobTypes.validateContinueWith(cleanupJobTypeName, { typeName: "work", input: null });
    }).toThrow(JobTypeValidationError);
    expect(() => {
      jobTypes.validateBlockers(cleanupJobTypeName, [{ typeName: "work", input: null }]);
    }).toThrow(JobTypeValidationError);
    expect(() => {
      jobTypes.validateBlockers(cleanupJobTypeName, []);
    }).not.toThrow();
  });
});

describe("createCleanupProcessors", () => {
  it("deletes completed chains older than retention across batches", async () => {
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({
      stateAdapter,
      jobTypes: [createCleanupJobTypes(), workJobTypes],
    });
    const worker = await createInProcessWorker({
      client,
      processors: [
        createCleanupProcessors({ client, batchSize: 2 }),
        createProcessors({
          client,
          jobTypes: workJobTypes,
          processors: {
            work: {
              attemptHandler: async ({ complete }) =>
                complete(async () => ({ done: true as const })),
            },
          },
        }),
      ],
    });

    const workChains = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: Array.from({ length: 5 }, (_, index) => ({
            typeName: "work" as const,
            input: { value: index },
          })),
        }),
      ),
    );
    const stopWork = await worker.start();
    await Promise.all(workChains.map(async (chain) => client.awaitChain(chain, completionOptions)));
    await stopWork();

    const cleanupChain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: cleanupJobTypeName,
          input: { retentionMs, intervalMs },
        }),
      ),
    );
    const stopCleanup = await worker.start();
    await client.awaitChain(cleanupChain, completionOptions);
    await stopCleanup();

    const remaining = await client.listChains({ typeName: ["work"], limit: 100 });
    expect(remaining.items).toEqual([]);
  });

  it("preserves chains that have not completed", async () => {
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({
      stateAdapter,
      jobTypes: [createCleanupJobTypes(), workJobTypes],
    });
    const worker = await createInProcessWorker({
      client,
      processors: [
        createCleanupProcessors({ client }),
        createProcessors({
          client,
          jobTypes: workJobTypes,
          processors: {
            work: {
              attemptHandler: async ({ complete }) =>
                complete(async () => ({ done: true as const })),
            },
          },
        }),
      ],
    });

    const workChains = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "work" as const, input: { value: 1 } },
            { typeName: "work" as const, input: { value: 2 } },
            // Scheduled far out, so it never completes and never becomes eligible.
            { typeName: "work" as const, input: { value: 3 }, schedule: { afterMs: 600_000 } },
          ],
        }),
      ),
    );
    const stopWork = await worker.start();
    await Promise.all(
      workChains.slice(0, 2).map(async (chain) => client.awaitChain(chain, completionOptions)),
    );
    await stopWork();

    const cleanupChain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: cleanupJobTypeName,
          input: { retentionMs, intervalMs },
        }),
      ),
    );
    const stopCleanup = await worker.start();
    await client.awaitChain(cleanupChain, completionOptions);
    await stopCleanup();

    const remaining = await client.listChains({ typeName: ["work"], limit: 100 });
    expect(remaining.items).toHaveLength(1);
    expect(remaining.items[0]?.status).toBe("running");
  });

  it("does not delete its own chain", async () => {
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes: createCleanupJobTypes() });
    const worker = await createInProcessWorker({
      client,
      processors: createCleanupProcessors({ client }),
    });

    const cleanupChain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: cleanupJobTypeName,
          input: { retentionMs, intervalMs },
        }),
      ),
    );
    const stop = await worker.start();
    await client.awaitChain(cleanupChain, completionOptions);
    await stop();

    const stillThere = await client.getChain({ ...cleanupChain });
    expect(stillThere?.id).toBe(cleanupChain.id);
    expect(stillThere?.status).toBe("completed");
  });

  it("schedules the next run one interval out, carrying the same input", async () => {
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes: createCleanupJobTypes() });
    const worker = await createInProcessWorker({
      client,
      processors: createCleanupProcessors({ client }),
    });

    const scheduledBefore = Date.now();
    const cleanupChain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: cleanupJobTypeName,
          input: { retentionMs, intervalMs },
        }),
      ),
    );
    const stop = await worker.start();
    await client.awaitChain(cleanupChain, completionOptions);
    await stop();

    const pending = await client.listJobs({
      typeName: [cleanupJobTypeName],
      status: "pending",
      limit: 10,
    });
    expect(pending.items).toHaveLength(1);
    expect(pending.items[0]?.chainId).not.toBe(cleanupChain.id);
    expect(pending.items[0]?.input).toEqual({ retentionMs, intervalMs });
    expect(pending.items[0]?.scheduledAt.getTime()).toBeGreaterThanOrEqual(
      scheduledBefore + intervalMs,
    );
  });

  it("deduplicates repeated startup scheduling onto one chain", async () => {
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes: createCleanupJobTypes() });

    const schedule = async () =>
      withTransactionHooks(async (transactionHooks) =>
        stateAdapter.withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: cleanupJobTypeName,
            input: { retentionMs, intervalMs },
            deduplication: { key: cleanupJobTypeName, scope: "running" },
          }),
        ),
      );

    const first = await schedule();
    const second = await schedule();

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it("runs slice middleware around every phase of the cleanup handler", async () => {
    const phases: string[] = [];
    const tracing: AttemptMiddleware<InProcessStateAdapter> = {
      wrapHandler: async ({ next }) => {
        phases.push("handler");
        return next({});
      },
      wrapExecute: async ({ next }) => {
        phases.push("execute");
        return next({});
      },
      wrapComplete: async ({ next }) => {
        phases.push("complete");
        return next({});
      },
    };

    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({
      stateAdapter,
      jobTypes: [createCleanupJobTypes(), workJobTypes],
    });
    const worker = await createInProcessWorker({
      client,
      processors: [
        createCleanupProcessors({ client, attemptMiddleware: [tracing] }),
        createProcessors({
          client,
          jobTypes: workJobTypes,
          processors: {
            work: {
              attemptHandler: async ({ complete }) =>
                complete(async () => ({ done: true as const })),
            },
          },
        }),
      ],
    });

    const workChain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "work",
          input: { value: 1 },
        }),
      ),
    );
    const stopWork = await worker.start();
    await client.awaitChain(workChain, completionOptions);
    await stopWork();
    phases.length = 0;

    const cleanupChain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: cleanupJobTypeName,
          input: { retentionMs, intervalMs },
        }),
      ),
    );
    const stopCleanup = await worker.start();
    await client.awaitChain(cleanupChain, completionOptions);
    await stopCleanup();

    expect(phases).toEqual(["handler", "execute", "complete"]);
  });

  it("rejects invalid cleanup input at the client boundary", async () => {
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes: createCleanupJobTypes() });

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        stateAdapter.withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: cleanupJobTypeName,
            // @ts-expect-error -- retentionMs must be a number
            input: { retentionMs: "a week", intervalMs },
          }),
        ),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("rejects a client that lacks the cleanup job types", async () => {
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes: workJobTypes });

    createCleanupProcessors({
      // @ts-expect-error -- the client must be created with createCleanupJobTypes()
      client,
    });
  });
});
