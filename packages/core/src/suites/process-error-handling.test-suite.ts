import { type TestAPI } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { sleep } from "../helpers/sleep.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createSpyStateAdapter } from "../state-adapter/state-adapter.spy.spec-helper.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const processErrorHandlingTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("reschedules when prepare callback throws in atomic mode", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("Error: Simulated prepare error");
              }
              await prepare({ mode: "atomic" }, async () => {
                if (job.attempt === 1) {
                  throw new Error("Simulated prepare error");
                }
              });
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value * 2 } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "withSavepoint", status: "rolled-back" }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when prepare callback throws in staged mode", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("Error: Simulated prepare error");
              }
              await prepare({ mode: "staged" }, async () => {
                if (job.attempt === 1) {
                  throw new Error("Simulated prepare error");
                }
              });
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value * 2 } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "withSavepoint", status: "rolled-back" }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when handler throws between prepare and complete in atomic mode", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("Error: Simulated process error");
              }
              await prepare({ mode: "atomic" });
              if (job.attempt === 1) {
                throw new Error("Simulated process error");
              }
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value * 2 } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when handler throws between prepare and complete in staged mode", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("Error: Simulated process error");
              }
              await prepare({ mode: "staged" });
              await sleep(1);
              if (job.attempt === 1) {
                throw new Error("Simulated process error");
              }
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value * 2 } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "extendJobAttempt" }),
        ],
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when complete callback throws in atomic mode", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("Error: Simulated complete error");
              }
              await prepare({ mode: "atomic" });
              return complete(async ({ finish }) => {
                if (job.attempt === 1) {
                  throw new Error("Simulated complete error");
                }
                return finish({ output: { result: job.input.value * 2 } });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "withSavepoint", status: "rolled-back" }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when complete callback throws in staged mode", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("Error: Simulated complete error");
              }
              await prepare({ mode: "staged" });
              await sleep(1);
              return complete(async ({ finish }) => {
                if (job.attempt === 1) {
                  throw new Error("Simulated complete error");
                }
                return finish({ output: { result: job.input.value * 2 } });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "extendJobAttempt" }),
        ],
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({ name: "withSavepoint", status: "rolled-back" }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when complete callback returns without committing", async ({
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
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt > 1) {
                retriedAfterError = job.lastAttemptError;
              }
              return complete(async ({ finish }) => {
                if (job.attempt === 1) {
                  return undefined as never;
                }
                return finish({ output: { done: true } });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(retriedAfterError).toContain(
      "finish must be called before the complete callback returns",
    );
  });

  it("reschedules when handler returns without completing the attempt", async ({
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
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt === 1) {
                return undefined as never;
              }
              retriedAfterError = job.lastAttemptError;
              return complete(async ({ finish }) => finish({ output: { done: true } }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(retriedAfterError).toContain(
      "complete must be called before the attempt handler returns",
    );
  });

  it("reschedules when handler throws after complete in atomic mode", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              attempts++;
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("Error: Error after complete");
              }
              await prepare({ mode: "atomic" });
              const result = await complete(async ({ finish }) =>
                finish({ output: { result: job.input.value * 2 } }),
              );
              if (job.attempt === 1) {
                throw new Error("Error after complete");
              }
              return result;
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    expect(attempts).toBe(2);

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [
              expect.objectContaining({ name: "finishJobAttempt" }),
              expect.objectContaining({ name: "getJobs" }),
              expect.objectContaining({ name: "unblockJobs" }),
            ],
          }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when handler throws after complete in staged mode", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              attempts++;
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("Error: Error after complete");
              }
              await prepare({ mode: "staged" });
              await sleep(1);
              const result = await complete(async ({ finish }) =>
                finish({ output: { result: job.input.value * 2 } }),
              );
              if (job.attempt === 1) {
                throw new Error("Error after complete");
              }
              return result;
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    expect(attempts).toBe(2);

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "extendJobAttempt" }),
        ],
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [
              expect.objectContaining({ name: "finishJobAttempt" }),
              expect.objectContaining({ name: "getJobs" }),
              expect.objectContaining({ name: "unblockJobs" }),
            ],
          }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("recovers when user code poisons transaction in prepare callback (atomic mode)", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" }, async (prepareCtx) => {
                await spyStateAdapter.record({ name: "user-preparation", ...prepareCtx });
                if (job.attempt === 1) {
                  await poisonTransaction(prepareCtx);
                }
              });
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value * 2 } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [expect.objectContaining({ name: "user-preparation" })],
          }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("recovers when user code poisons transaction in prepare callback (staged mode)", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "staged" }, async (prepareCtx) => {
                await spyStateAdapter.record({ name: "user-preparation", ...prepareCtx });
                if (job.attempt === 1) {
                  await poisonTransaction(prepareCtx);
                }
              });
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value * 2 } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [expect.objectContaining({ name: "user-preparation" })],
          }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("recovers when user code poisons transaction in complete callback (atomic mode)", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async ({ finish, ...completeCtx }) => {
                await spyStateAdapter.record({ name: "user-completion", ...completeCtx });
                if (job.attempt === 1) {
                  await poisonTransaction(completeCtx);
                }
                return finish({ output: { result: job.input.value * 2 } });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [expect.objectContaining({ name: "user-completion" })],
          }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("recovers when user code poisons transaction in complete callback (staged mode)", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "staged" });
              await sleep(1);
              return complete(async ({ finish, ...completeCtx }) => {
                await spyStateAdapter.record({ name: "user-completion", ...completeCtx });
                if (job.attempt === 1) {
                  await poisonTransaction(completeCtx);
                }
                return finish({ output: { result: job.input.value * 2 } });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "extendJobAttempt" }),
        ],
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [expect.objectContaining({ name: "user-completion" })],
          }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("rolls back continuation job when handler throws after complete with continueWith (atomic mode)", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              step1Attempts++;
              await prepare({ mode: "atomic" });
              const result = await complete(async ({ finish }) =>
                finish({
                  continueWith: { typeName: "step2", input: { value: job.input.value * 2 } },
                }),
              );
              if (job.attempt === 1) {
                throw new Error("Error after complete with continueWith");
              }
              return result;
            },
          },
          step2: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "step1",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    expect(step1Attempts).toBe(2);

    const allJobs = await client.listChainJobs({ chainId: chain.id });
    expect(allJobs.items).toHaveLength(2);

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [
              expect.objectContaining({ name: "createContinuationJob" }),
              expect.objectContaining({ name: "finishJobAttempt" }),
            ],
          }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("rolls back continuation job when handler throws after complete with continueWith (staged mode)", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              step1Attempts++;
              await prepare({ mode: "staged" });
              await sleep(1);
              const result = await complete(async ({ finish }) =>
                finish({
                  continueWith: { typeName: "step2", input: { value: job.input.value * 2 } },
                }),
              );
              if (job.attempt === 1) {
                throw new Error("Error after complete with continueWith");
              }
              return result;
            },
          },
          step2: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "step1",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    expect(step1Attempts).toBe(2);

    const allJobs = await client.listChainJobs({ chainId: chain.id });
    expect(allJobs.items).toHaveLength(2);

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "extendJobAttempt" }),
        ],
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [
              expect.objectContaining({ name: "createContinuationJob" }),
              expect.objectContaining({ name: "finishJobAttempt" }),
            ],
          }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("blocked job remains blocked when blocker handler throws after complete (atomic mode)", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    let blockerAttempts = 0;

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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              blockerAttempts++;
              await prepare({ mode: "atomic" });
              const result = await complete(async ({ finish }) =>
                finish({ output: { done: true as const } }),
              );
              if (job.attempt === 1) {
                throw new Error("Error after blocker complete");
              }
              return result;
            },
          },
          dependent: {
            attemptHandler: async ({ job, complete }) => {
              const [blocker] = job.blockers;
              expect(blocker.output.done).toBe(true);
              return complete(async ({ finish }) => finish({ output: { result: "ok" } }));
            },
          },
        },
      }),
    });

    const blockerChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 1 },
        }),
      ),
    );
    const dependentChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "dependent",
          input: null,
          blockers: [blockerChain],
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(dependentChain, completionOptions);
      expect(completed.output).toEqual({ result: "ok" });
    });

    expect(blockerAttempts).toBe(2);
  });

  it("blocked job remains blocked when blocker handler throws after complete (staged mode)", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    let blockerAttempts = 0;

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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              blockerAttempts++;
              await prepare({ mode: "staged" });
              await sleep(1);
              const result = await complete(async ({ finish }) =>
                finish({ output: { done: true as const } }),
              );
              if (job.attempt === 1) {
                throw new Error("Error after blocker complete");
              }
              return result;
            },
          },
          dependent: {
            attemptHandler: async ({ job, complete }) => {
              const [blocker] = job.blockers;
              expect(blocker.output.done).toBe(true);
              return complete(async ({ finish }) => finish({ output: { result: "ok" } }));
            },
          },
        },
      }),
    });

    const blockerChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 1 },
        }),
      ),
    );
    const dependentChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "dependent",
          input: null,
          blockers: [blockerChain],
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(dependentChain, completionOptions);
      expect(completed.output).toEqual({ result: "ok" });
    });

    expect(blockerAttempts).toBe(2);
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, complete }) => {
              if (job.lastAttemptError != null) {
                recordedErrors.push(job.lastAttemptError);
              }

              const errorToThrow = errorsByAttempt[job.attempt];
              if (errorToThrow != null) {
                // oxlint-disable-next-line typescript/only-throw-error -- test intentionally throws non-Error values
                throw errorToThrow;
              }

              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
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

  it("reschedules when step is called before prepare", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, step, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("step is only valid in staged mode");
              }
              if (job.attempt === 1) {
                await step(async () => {});
              }
              await prepare({ mode: "staged" });
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });
  });

  it("reschedules when step is called in atomic mode", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, step, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("step is only valid in staged mode");
              }
              await prepare({ mode: "atomic" });
              if (job.attempt === 1) {
                await step(async () => {});
              }
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });
  });

  it("reschedules when step is called after complete", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, step, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("step cannot be called after complete");
              }
              await prepare({ mode: "staged" });
              if (job.attempt === 1) {
                await complete(async ({ finish }) => finish({ output: null }));
                await step(async () => {});
              }
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });
  });

  it("reschedules when step callback throws in staged mode", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, step, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("Error: Simulated step error");
              }
              await prepare({ mode: "staged" });
              if (job.attempt === 1) {
                await step(async () => {
                  throw new Error("Simulated step error");
                });
              }
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value * 2 } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "extendJobAttempt" }),
        ],
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "rolled-back",
        children: [expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } })],
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({ name: "finishJobAttempt" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when step is called in parallel", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, step, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("parallel");
              }
              await prepare({ mode: "staged" });
              if (job.attempt === 1) {
                await step(async () => {
                  await step(async () => {});
                });
              }
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });
  });

  it("completes when handler catches a step guard error and then completes", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, step, complete }) => {
              expect(job.attempt).toBe(1);
              await prepare({ mode: "atomic" });
              await expect(step(async () => {})).rejects.toThrow("only valid in staged mode");
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });
  });

  it("completes when handler catches a prepare callback error and then completes", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              expect(job.attempt).toBe(1);
              await expect(
                prepare({ mode: "atomic" }, async () => {
                  throw new Error("prepare boom");
                }),
              ).rejects.toThrow("prepare boom");
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });
  });

  it("reschedules when step is called while prepare is running", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, step, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("prepare is running");
              }
              await prepare({ mode: "staged" }, async () => {
                if (job.attempt === 1) {
                  await step(async () => {});
                }
              });
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });
  });

  it("reschedules when complete is called while step is running", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, step, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain(
                  "complete cannot be called while step is running",
                );
              }
              await prepare({ mode: "staged" });
              if (job.attempt === 1) {
                await step(async () => {
                  await complete(async ({ finish }) => finish({ output: null }));
                });
              }
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });
  });

  it("reschedules when complete is called while prepare is running", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("prepare is running");
              }
              await prepare({ mode: "atomic" }, async () => {
                if (job.attempt === 1) {
                  await complete(async ({ finish }) => finish({ output: null }));
                }
              });
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });
  });

  it("recovers when user code poisons transaction in execute callback", async ({
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
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, prepare, step, complete }) => {
              await prepare({ mode: "staged" });
              if (job.attempt === 1) {
                await step(async (txCtx) => {
                  await poisonTransaction(txCtx);
                });
              }
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value * 2 } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });
  });
};
