import { describe, expect, it } from "vitest";

import { createClient } from "./client.js";
import { defineJobTypes } from "./entities/define-job-types.js";
import { createInProcessWorker } from "./in-process-worker.js";
import { createInProcessStateAdapter } from "./state-adapter/state-adapter.in-process.js";
import { withTransactionHooks } from "./transaction-hooks.js";
import { createProcessors } from "./worker/create-processors.js";

type Defs = {
  foo: { entry: true; input: null; output: null };
};

describe("createInProcessWorker defaults", () => {
  it("applies worker-level backoffConfig fallback when processor has none", async () => {
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
              return complete(async () => null);
            },
          },
        },
      }),
    });

    const stop = await worker.start();
    const chain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.startChain({ ...txCtx, transactionHooks, typeName: "foo", input: null }),
      ),
    );
    await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 10 });
    await stop();

    expect(attempts).toEqual([1, 2, 3]);
  });

  it("processor-level backoffConfig wins over worker-level default", async () => {
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
              return complete(async () => null);
            },
          },
        },
      }),
    });

    const stop = await worker.start();
    const chain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.startChain({ ...txCtx, transactionHooks, typeName: "foo", input: null }),
      ),
    );
    await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 10 });
    await stop();

    expect(delaysBetweenAttempts.length).toBe(1);
    expect(delaysBetweenAttempts[0]).toBeLessThan(1_000);
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
          foo: { attemptHandler: async ({ complete }) => complete(async () => null) },
        },
      }),
    });
  };

  it("rejects empty workerName", async () => {
    await expect(buildWorker("")).rejects.toThrow(TypeError);
  });

  it("rejects workerName containing whitespace", async () => {
    await expect(buildWorker(" worker ")).rejects.toThrow(TypeError);
    await expect(buildWorker("my worker")).rejects.toThrow(TypeError);
  });

  it("rejects workerName containing disallowed characters", async () => {
    await expect(buildWorker("worker/1")).rejects.toThrow(TypeError);
    await expect(buildWorker("worker:1")).rejects.toThrow(TypeError);
  });

  it("accepts identifier-style names", async () => {
    await expect(buildWorker("worker-1")).resolves.toBeDefined();
    await expect(buildWorker("worker.east_1")).resolves.toBeDefined();
  });
});
