import { describe, expect, it } from "vitest";

import { createClient } from "./client.js";
import { createInProcessWorker } from "./in-process-worker.js";
import { createProcessors } from "./job-type-processors/create-job-type-processors.js";
import { defineJobTypes } from "./job-types/define-job-types.js";
import { createInProcessStateAdapter } from "./state-adapter/state-adapter.in-process.js";
import { withTransactionHooks } from "./transaction-hooks.js";

type Defs = {
  foo: { entry: true; input: null; output: null };
};

describe("createInProcessWorker defaults", () => {
  it("applies the worker-level backoffConfig fallback when processor has none", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });

    const attempts: number[] = [];
    const worker = await createInProcessWorker({
      client,
      defaults: {
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
      },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          foo: {
            attemptHandler: async ({ job, complete }) => {
              attempts.push(job.attempt);
              if (job.attempt < 3) throw new Error("retry");
              return withTransactionHooks(async (transactionHooks) =>
                stateAdapter.withTransaction(async (txCtx) =>
                  complete({ ...txCtx, transactionHooks, output: null }),
                ),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "foo", input: null }),
      ),
    );
    const stop = await worker.start();
    await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 10 });
    await stop();

    expect(attempts).toEqual([1, 2, 3]);
  });

  it("processor-level backoffConfig wins over worker-level defaults", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });

    const delaysBetweenAttempts: number[] = [];
    let lastAt: number | null = null;

    const worker = await createInProcessWorker({
      client,
      defaults: {
        backoffConfig: { initialDelayMs: 5_000, multiplier: 1, maxDelayMs: 5_000 },
      },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          foo: {
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, complete }) => {
              const now = Date.now();
              if (lastAt !== null) delaysBetweenAttempts.push(now - lastAt);
              lastAt = now;
              if (job.attempt < 2) throw new Error("retry");
              return withTransactionHooks(async (transactionHooks) =>
                stateAdapter.withTransaction(async (txCtx) =>
                  complete({ ...txCtx, transactionHooks, output: null }),
                ),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "foo", input: null }),
      ),
    );
    const stop = await worker.start();
    await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 10 });
    await stop();

    expect(delaysBetweenAttempts.length).toBe(1);
    expect(delaysBetweenAttempts[0]).toBeLessThan(1_000);
  });
});

describe("createInProcessWorker lease defaults", () => {
  it("starts each worker with a 60s lease under its workerName", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = await createInProcessStateAdapter();
    const startWorkerCalls: { name: string | null; leaseMs: number }[] = [];
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        startWorker: async (params) => {
          startWorkerCalls.push({ name: params.name, leaseMs: params.leaseMs });
          return stateAdapter.startWorker(params);
        },
      },
      jobTypes,
    });

    const worker = await createInProcessWorker({
      client,
      workerName: "east 1",
      processors: createProcessors({
        client,
        jobTypes,
        processors: { foo: { attemptHandler: async () => undefined as never } },
      }),
    });
    const stop = await worker.start();
    await expect.poll(() => startWorkerCalls.length).toBe(1);
    await stop();

    expect(startWorkerCalls).toEqual([{ name: "east 1", leaseMs: 60_000 }]);
  });
});

describe("createInProcessWorker workerName validation", () => {
  const buildWorker = async (workerName: string) => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });
    return createInProcessWorker({
      client,
      workerName,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          foo: {
            attemptHandler: async ({ complete }) =>
              withTransactionHooks(async (transactionHooks) =>
                stateAdapter.withTransaction(async (txCtx) =>
                  complete({ ...txCtx, transactionHooks, output: null }),
                ),
              ),
          },
        },
      }),
    });
  };

  it("rejects empty workerName", async () => {
    await expect(buildWorker("")).rejects.toThrow(TypeError);
  });

  it("accepts any non-empty workerName", async () => {
    await expect(buildWorker("worker-1")).resolves.toBeDefined();
    await expect(buildWorker("my worker / east:1")).resolves.toBeDefined();
  });
});
