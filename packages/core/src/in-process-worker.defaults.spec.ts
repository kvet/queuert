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
  it("applies worker-level backoffConfig and attemptConfig fallbacks when processor has none", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = createInProcessStateAdapter();
    const client = createClient({ stateAdapter, jobTypes });

    const attempts: number[] = [];
    const worker = createInProcessWorker({
      client,
      defaults: {
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        attemptConfig: { timeoutMs: 45_000, heartbeatMs: 10_000 },
      },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          foo: {
            attemptHandler: async ({ job, complete }) => {
              expect(job.attemptUntil.getTime() - job.attemptAt.getTime()).toBe(45_000);
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

  it("processor-level backoffConfig and attemptConfig win over worker-level defaults", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = createInProcessStateAdapter();
    const client = createClient({ stateAdapter, jobTypes });

    const delaysBetweenAttempts: number[] = [];
    let lastAt: number | null = null;

    const worker = createInProcessWorker({
      client,
      defaults: {
        backoffConfig: { initialDelayMs: 5_000, multiplier: 1, maxDelayMs: 5_000 },
        attemptConfig: { timeoutMs: 45_000, heartbeatMs: 10_000 },
      },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          foo: {
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptConfig: { timeoutMs: 15_000, heartbeatMs: 5_000 },
            attemptHandler: async ({ job, complete }) => {
              expect(job.attemptUntil.getTime() - job.attemptAt.getTime()).toBe(15_000);
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

describe("createInProcessWorker workerName validation", () => {
  const buildWorker = (workerName: string) => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = createInProcessStateAdapter();
    const client = createClient({ stateAdapter, jobTypes });
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

  it("rejects empty workerName", () => {
    expect(() => buildWorker("")).toThrow(TypeError);
  });

  it("rejects workerName containing whitespace", () => {
    expect(() => buildWorker(" worker ")).toThrow(TypeError);
    expect(() => buildWorker("my worker")).toThrow(TypeError);
  });

  it("rejects workerName containing disallowed characters", () => {
    expect(() => buildWorker("worker/1")).toThrow(TypeError);
    expect(() => buildWorker("worker:1")).toThrow(TypeError);
  });

  it("accepts identifier-style names", () => {
    expect(buildWorker("worker-1")).toBeDefined();
    expect(buildWorker("worker.east_1")).toBeDefined();
  });
});
