import { type TestAPI } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import {
  type SpyCall,
  createSpyStateAdapter,
} from "../state-adapter/state-adapter.spy.spec-helper.js";
import { type TransactionHooks, withTransactionHooks } from "../transaction-hooks.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

/** Opens a transaction on the given adapter, so a spy adapter records the handler's writes. */
const createWithTransaction =
  (stateAdapter: StateAdapter<{ $test: true }, string>) =>
  async <T>(
    cb: (txCtx: { $test: true }, transactionHooks: TransactionHooks) => Promise<T>,
  ): Promise<T> =>
    withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) => cb(txCtx, transactionHooks)),
    );

/** Drops the worker loop's polling calls, which interleave with attempts nondeterministically. */
const attemptCalls = (calls: SpyCall[]): SpyCall[] =>
  calls.filter(
    (call) => call.name !== "getStartAttemptDelayMs" && call.name !== "reclaimExpiredJobAttempt",
  );

export const processErrorHandlingTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };
  const fastBackoff = { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 };

  it("reschedules when handler throws before opening its transaction", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);
    const withSpyTransaction = createWithTransaction(spyStateAdapter);

    const jobTypes = defineJobTypes<{
      test: {
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
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            backoffConfig: fastBackoff,
            attemptHandler: async ({ job, finish }) => {
              if (job.attempt === 1) {
                throw new Error("Simulated handler error");
              }
              expect(job.lastAttemptError).toContain("Error: Simulated handler error");
              return withSpyTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: { result: job.input.value * 2 } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 10 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    // Acquire and the error reschedule are autocommit statements, outside any transaction.
    const expected = [
      expect.objectContaining({ name: "startJobAttempt", children: [] }),
      expect.objectContaining({ name: "rescheduleJobs", children: [] }),
    ];
    expect(attemptCalls(spyStateAdapter.calls).slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when handler throws inside its transaction before finish", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);
    const withSpyTransaction = createWithTransaction(spyStateAdapter);

    const jobTypes = defineJobTypes<{
      test: {
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
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            backoffConfig: fastBackoff,
            attemptHandler: async ({ job, finish }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("Error: Simulated transaction error");
              }
              return withSpyTransaction(async (txCtx, transactionHooks) => {
                if (job.attempt === 1) {
                  throw new Error("Simulated transaction error");
                }
                return finish({
                  ...txCtx,
                  transactionHooks,
                  output: { result: job.input.value * 2 },
                });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 10 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({ name: "startJobAttempt", children: [] }),
      expect.objectContaining({ name: "withTransaction", status: "rolled-back", children: [] }),
      expect.objectContaining({ name: "rescheduleJobs", children: [] }),
    ];
    expect(attemptCalls(spyStateAdapter.calls).slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when handler throws inside its transaction after finish", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    let attempts = 0;
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);
    const withSpyTransaction = createWithTransaction(spyStateAdapter);

    const jobTypes = defineJobTypes<{
      test: {
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
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            backoffConfig: fastBackoff,
            attemptHandler: async ({ job, finish }) => {
              attempts++;
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("Error: Error after finish");
              }
              return withSpyTransaction(async (txCtx, transactionHooks) => {
                const result = await finish({
                  ...txCtx,
                  transactionHooks,
                  output: { result: job.input.value * 2 },
                });
                if (job.attempt === 1) {
                  throw new Error("Error after finish");
                }
                return result;
              });
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 10 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    expect(attempts).toBe(2);

    const expected = [
      expect.objectContaining({ name: "startJobAttempt", children: [] }),
      expect.objectContaining({
        name: "withTransaction",
        status: "rolled-back",
        children: expect.arrayContaining([expect.objectContaining({ name: "completeJobs" })]),
      }),
      expect.objectContaining({ name: "rescheduleJobs", children: [] }),
    ];
    expect(attemptCalls(spyStateAdapter.calls).slice(0, expected.length)).toEqual(expected);
    expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ type: "worker_error" }));
  });

  it("reschedules when handler returns without calling finish", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: { done: true };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    let retriedAfterError: string | null = null;

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: fastBackoff,
        processors: {
          test: {
            attemptHandler: async ({ job, finish }) => {
              if (job.attempt === 1) {
                return undefined as never;
              }
              retriedAfterError = job.lastAttemptError;
              return withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: { done: true } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(retriedAfterError).toContain("Attempt handler returned without a committed finish");
  });

  it("recovers when user code poisons its transaction before finish", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    poisonTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
    skip,
  }) => {
    if (!poisonTransaction) return skip();

    const spyStateAdapter = createSpyStateAdapter(stateAdapter);
    const withSpyTransaction = createWithTransaction(spyStateAdapter);

    const jobTypes = defineJobTypes<{
      test: {
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
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            backoffConfig: fastBackoff,
            attemptHandler: async ({ job, finish }) =>
              withSpyTransaction(async (txCtx, transactionHooks) => {
                await spyStateAdapter.record({ name: "user-work", ...txCtx });
                if (job.attempt === 1) {
                  await poisonTransaction(txCtx);
                }
                return finish({
                  ...txCtx,
                  transactionHooks,
                  output: { result: job.input.value * 2 },
                });
              }),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 10 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({ name: "startJobAttempt", children: [] }),
      expect.objectContaining({
        name: "withTransaction",
        status: "rolled-back",
        children: expect.arrayContaining([expect.objectContaining({ name: "user-work" })]),
      }),
      expect.objectContaining({ name: "rescheduleJobs", children: [] }),
    ];
    expect(attemptCalls(spyStateAdapter.calls).slice(0, expected.length)).toEqual(expected);
  });

  it("recovers when user code poisons a separate transaction before finish", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    poisonTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
    skip,
  }) => {
    if (!poisonTransaction) return skip();

    const jobTypes = defineJobTypes<{
      test: {
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
          test: {
            backoffConfig: fastBackoff,
            attemptHandler: async ({ job, finish }) => {
              if (job.attempt === 1) {
                await withTransaction(async (txCtx) => {
                  await poisonTransaction(txCtx);
                });
              }
              return withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: { result: job.input.value * 2 } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 10 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });
  });

  it("rolls back the continuation when handler throws after finish with continueWith inside its transaction", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    let step1Attempts = 0;
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);
    const withSpyTransaction = createWithTransaction(spyStateAdapter);

    const jobTypes = defineJobTypes<{
      step1: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "step2" };
      };
      step2: {
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
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          step1: {
            backoffConfig: fastBackoff,
            attemptHandler: async ({ job, finish }) => {
              step1Attempts++;
              return withSpyTransaction(async (txCtx, transactionHooks) => {
                const result = await finish({
                  ...txCtx,
                  transactionHooks,
                  continueWith: { typeName: "step2", input: { value: job.input.value * 2 } },
                });
                if (job.attempt === 1) {
                  throw new Error("Error after finish with continueWith");
                }
                return result;
              });
            },
          },
          step2: {
            attemptHandler: async ({ job, finish }) =>
              withSpyTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: { result: job.input.value } }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "step1",
        input: { value: 10 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    expect(step1Attempts).toBe(2);

    const allJobs = await client.listChainJobs({ chainId: chain.id });
    expect(allJobs.items).toHaveLength(2);

    const expected = [
      expect.objectContaining({ name: "startJobAttempt", children: [] }),
      expect.objectContaining({
        name: "withTransaction",
        status: "rolled-back",
        children: expect.arrayContaining([expect.objectContaining({ name: "continueJobs" })]),
      }),
      expect.objectContaining({ name: "rescheduleJobs", children: [] }),
    ];
    expect(attemptCalls(spyStateAdapter.calls).slice(0, expected.length)).toEqual(expected);
  });

  it("keeps the dependent blocked when the blocker handler throws after finish inside its transaction", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    let blockerAttempts = 0;
    let dependentStartedBeforeBlockerRetry = false;

    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: { value: number };
        output: { done: true };
      };
      dependent: {
        entry: true;
        input: null;
        output: { result: string };
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
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            backoffConfig: fastBackoff,
            attemptHandler: async ({ job, finish }) => {
              blockerAttempts++;
              return withTransaction(async (txCtx, transactionHooks) => {
                const result = await finish({
                  ...txCtx,
                  transactionHooks,
                  output: { done: true as const },
                });
                if (job.attempt === 1) {
                  throw new Error("Error after blocker finish");
                }
                return result;
              });
            },
          },
          dependent: {
            attemptHandler: async ({ getBlockers, finish }) => {
              if (blockerAttempts < 2) {
                dependentStartedBeforeBlockerRetry = true;
              }
              const [blocker] = await getBlockers();
              expect(blocker.output.done).toBe(true);
              return withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: { result: "ok" } }),
              );
            },
          },
        },
      }),
    });

    const blockerChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "blocker",
        input: { value: 1 },
      }),
    );
    const dependentChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "dependent",
        input: null,
        blockers: [blockerChain],
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(dependentChain, completionOptions);
      expect(completed.output).toEqual({ result: "ok" });
    });

    expect(blockerAttempts).toBe(2);
    expect(dependentStartedBeforeBlockerRetry).toBe(false);
  });

  it("serializes various error types in lastAttemptError", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const errorsByAttempt: Record<number, unknown> = {
      1: new Error("plain error"),
      2: { code: "ETIMEOUT", detail: "connection lost" },
      3: "string error",
    };

    const recordedErrors: (string | null)[] = [];

    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: null;
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
          test: {
            backoffConfig: fastBackoff,
            attemptHandler: async ({ job, finish }) => {
              if (job.lastAttemptError != null) {
                recordedErrors.push(job.lastAttemptError);
              }

              const errorToThrow = errorsByAttempt[job.attempt];
              if (errorToThrow != null) {
                // oxlint-disable-next-line typescript/only-throw-error -- test intentionally throws non-Error values
                throw errorToThrow;
              }

              return withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(recordedErrors).toHaveLength(3);

    expect(recordedErrors[0]).toContain("plain error");
    expect(recordedErrors[0]).toMatch(/at\s/);
    expect(recordedErrors[0]).not.toBe("[object Object]");

    expect(recordedErrors[1]).toContain("ETIMEOUT");
    expect(recordedErrors[1]).toContain("connection lost");
    expect(recordedErrors[1]).not.toBe("[object Object]");

    expect(recordedErrors[2]).toBe("string error");
  });

  it("completes when handler catches an error from its own transaction and then finishes", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: null;
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
          test: {
            backoffConfig: fastBackoff,
            attemptHandler: async ({ job, finish }) => {
              expect(job.attempt).toBe(1);
              await expect(
                withTransaction(async () => {
                  throw new Error("transaction boom");
                }),
              ).rejects.toThrow("transaction boom");
              return withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ type: "job_attempt_failed" }));
  });
};
