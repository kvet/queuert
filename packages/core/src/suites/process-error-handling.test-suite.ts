import { type TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import {
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
} from "../index.js";
import { createSpyStateAdapter } from "../state-adapter/state-adapter.spy.spec-helper.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const processErrorHandlingTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("reschedules when prepare callback throws in atomic mode", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        test: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            if (job.attempt > 1) {
              expect(job.lastAttemptError).toBe("Error: Simulated prepare error");
            }
            await prepare({ mode: "atomic" }, async () => {
              if (job.attempt === 1) {
                throw new Error("Simulated prepare error");
              }
            });
            return complete(async () => ({ result: job.input.value * 2 }));
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
          expect.objectContaining({ name: "withSavepoint", status: "rolled-back" }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
      expect.objectContaining({ name: "getNextJobAvailableInMs" }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when prepare callback throws in staged mode", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        test: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            if (job.attempt > 1) {
              expect(job.lastAttemptError).toBe("Error: Simulated prepare error");
            }
            await prepare({ mode: "staged" }, async () => {
              if (job.attempt === 1) {
                throw new Error("Simulated prepare error");
              }
            });
            return complete(async () => ({ result: job.input.value * 2 }));
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
          expect.objectContaining({ name: "withSavepoint", status: "rolled-back" }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
      expect.objectContaining({ name: "getNextJobAvailableInMs" }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when handler throws between prepare and complete in atomic mode", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        test: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            if (job.attempt > 1) {
              expect(job.lastAttemptError).toBe("Error: Simulated process error");
            }
            await prepare({ mode: "atomic" });
            if (job.attempt === 1) {
              throw new Error("Simulated process error");
            }
            return complete(async () => ({ result: job.input.value * 2 }));
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
      expect.objectContaining({ name: "getNextJobAvailableInMs" }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when handler throws between prepare and complete in staged mode", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        test: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            if (job.attempt > 1) {
              expect(job.lastAttemptError).toBe("Error: Simulated process error");
            }
            await prepare({ mode: "staged" });
            await sleep(1);
            if (job.attempt === 1) {
              throw new Error("Simulated process error");
            }
            return complete(async () => ({ result: job.input.value * 2 }));
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
        ],
      }),
      expect.objectContaining({ name: "getNextJobAvailableInMs" }),
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobForUpdate" }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when complete callback throws in atomic mode", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        test: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            if (job.attempt > 1) {
              expect(job.lastAttemptError).toBe("Error: Simulated complete error");
            }
            await prepare({ mode: "atomic" });
            return complete(async () => {
              if (job.attempt === 1) {
                throw new Error("Simulated complete error");
              }
              return { result: job.input.value * 2 };
            });
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
          expect.objectContaining({ name: "withSavepoint", status: "rolled-back" }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
      expect.objectContaining({ name: "getNextJobAvailableInMs" }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when complete callback throws in staged mode", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        test: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            if (job.attempt > 1) {
              expect(job.lastAttemptError).toBe("Error: Simulated complete error");
            }
            await prepare({ mode: "staged" });
            await sleep(1);
            return complete(async () => {
              if (job.attempt === 1) {
                throw new Error("Simulated complete error");
              }
              return { result: job.input.value * 2 };
            });
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
        ],
      }),
      expect.objectContaining({ name: "getNextJobAvailableInMs" }),
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobForUpdate" }),
          expect.objectContaining({ name: "withSavepoint", status: "rolled-back" }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when handler throws after complete in atomic mode", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    let attempts = 0;
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        test: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            attempts++;
            if (job.attempt > 1) {
              expect(job.lastAttemptError).toBe("Error: Error after complete");
            }
            await prepare({ mode: "atomic" });
            const result = await complete(async () => ({ result: job.input.value * 2 }));
            if (job.attempt === 1) {
              throw new Error("Error after complete");
            }
            return result;
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    expect(attempts).toBe(2);

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [
              expect.objectContaining({ name: "completeJob" }),
              expect.objectContaining({ name: "getJobById" }),
              expect.objectContaining({ name: "unblockJobs" }),
            ],
          }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
      expect.objectContaining({ name: "getNextJobAvailableInMs" }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("reschedules when handler throws after complete in staged mode", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    let attempts = 0;
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        test: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            attempts++;
            if (job.attempt > 1) {
              expect(job.lastAttemptError).toBe("Error: Error after complete");
            }
            await prepare({ mode: "staged" });
            await sleep(1);
            const result = await complete(async () => ({ result: job.input.value * 2 }));
            if (job.attempt === 1) {
              throw new Error("Error after complete");
            }
            return result;
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    expect(attempts).toBe(2);

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
        ],
      }),
      expect.objectContaining({ name: "getNextJobAvailableInMs" }),
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobForUpdate" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [
              expect.objectContaining({ name: "completeJob" }),
              expect.objectContaining({ name: "getJobById" }),
              expect.objectContaining({ name: "unblockJobs" }),
            ],
          }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("recovers when user code poisons transaction in prepare callback (atomic mode)", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    poisonTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
    skip,
  }) => {
    if (!poisonTransaction) return skip();

    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        test: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            await prepare({ mode: "atomic" }, async (prepareCtx) => {
              await spyStateAdapter.record({ name: "user-preparation", ...prepareCtx });
              if (job.attempt === 1) {
                await poisonTransaction(prepareCtx);
              }
            });
            return complete(async () => ({ result: job.input.value * 2 }));
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [expect.objectContaining({ name: "user-preparation" })],
          }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
      expect.objectContaining({ name: "getNextJobAvailableInMs" }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("recovers when user code poisons transaction in prepare callback (staged mode)", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    poisonTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
    skip,
  }) => {
    if (!poisonTransaction) return skip();

    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        test: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            await prepare({ mode: "staged" }, async (prepareCtx) => {
              await spyStateAdapter.record({ name: "user-preparation", ...prepareCtx });
              if (job.attempt === 1) {
                await poisonTransaction(prepareCtx);
              }
            });
            return complete(async () => ({ result: job.input.value * 2 }));
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [expect.objectContaining({ name: "user-preparation" })],
          }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
      expect.objectContaining({ name: "getNextJobAvailableInMs" }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("recovers when user code poisons transaction in complete callback (atomic mode)", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    poisonTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
    skip,
  }) => {
    if (!poisonTransaction) return skip();

    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        test: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            await prepare({ mode: "atomic" });
            return complete(async (completeCtx) => {
              await spyStateAdapter.record({ name: "user-completion", ...completeCtx });
              if (job.attempt === 1) {
                await poisonTransaction(completeCtx);
              }
              return { result: job.input.value * 2 };
            });
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [expect.objectContaining({ name: "user-completion" })],
          }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
      expect.objectContaining({ name: "getNextJobAvailableInMs" }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("recovers when user code poisons transaction in complete callback (staged mode)", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    poisonTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
    skip,
  }) => {
    if (!poisonTransaction) return skip();

    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        test: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            await prepare({ mode: "staged" });
            await sleep(1);
            return complete(async (completeCtx) => {
              await spyStateAdapter.record({ name: "user-completion", ...completeCtx });
              if (job.attempt === 1) {
                await poisonTransaction(completeCtx);
              }
              return { result: job.input.value * 2 };
            });
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
        ],
      }),
      expect.objectContaining({ name: "getNextJobAvailableInMs" }),
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobForUpdate" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [expect.objectContaining({ name: "user-completion" })],
          }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("rolls back continuation job when handler throws after complete with continueWith (atomic mode)", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    let step1Attempts = 0;
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        step1: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            step1Attempts++;
            await prepare({ mode: "atomic" });
            const result = await complete(async ({ continueWith }) =>
              continueWith({ typeName: "step2", input: { value: job.input.value * 2 } }),
            );
            if (job.attempt === 1) {
              throw new Error("Error after complete with continueWith");
            }
            return result;
          },
        },
        step2: {
          attemptHandler: async ({ job, complete }) => {
            return complete(async () => ({ result: job.input.value }));
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "step1",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    expect(step1Attempts).toBe(2);

    const allJobs = await client.listJobChainJobs({ jobChainId: jobChain.id });
    expect(allJobs.items).toHaveLength(2);

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [
              expect.objectContaining({ name: "createJobs" }),
              expect.objectContaining({ name: "completeJob" }),
            ],
          }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
      expect.objectContaining({ name: "getNextJobAvailableInMs" }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("rolls back continuation job when handler throws after complete with continueWith (staged mode)", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    let step1Attempts = 0;
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        step1: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            step1Attempts++;
            await prepare({ mode: "staged" });
            await sleep(1);
            const result = await complete(async ({ continueWith }) =>
              continueWith({ typeName: "step2", input: { value: job.input.value * 2 } }),
            );
            if (job.attempt === 1) {
              throw new Error("Error after complete with continueWith");
            }
            return result;
          },
        },
        step2: {
          attemptHandler: async ({ job, complete }) => {
            return complete(async () => ({ result: job.input.value }));
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "step1",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    expect(step1Attempts).toBe(2);

    const allJobs = await client.listJobChainJobs({ jobChainId: jobChain.id });
    expect(allJobs.items).toHaveLength(2);

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
        ],
      }),
      expect.objectContaining({ name: "getNextJobAvailableInMs" }),
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobForUpdate" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "rolled-back",
            children: [
              expect.objectContaining({ name: "createJobs" }),
              expect.objectContaining({ name: "completeJob" }),
            ],
          }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("blocked job remains blocked when blocker handler throws after complete (atomic mode)", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    let blockerAttempts = 0;

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        blocker: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            blockerAttempts++;
            await prepare({ mode: "atomic" });
            const result = await complete(async () => ({ done: true as const }));
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
            return complete(async () => ({ result: "ok" }));
          },
        },
      }),
    });

    const blockerChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 1 },
        }),
      ),
    );
    const dependentChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "dependent",
          input: null,
          blockers: [blockerChain],
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(dependentChain, completionOptions);
      expect(completed.output).toEqual({ result: "ok" });
    });

    expect(blockerAttempts).toBe(2);
  });

  it("blocked job remains blocked when blocker handler throws after complete (staged mode)", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    let blockerAttempts = 0;

    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        blocker: {
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          attemptHandler: async ({ job, prepare, complete }) => {
            blockerAttempts++;
            await prepare({ mode: "staged" });
            await sleep(1);
            const result = await complete(async () => ({ done: true as const }));
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
            return complete(async () => ({ result: "ok" }));
          },
        },
      }),
    });

    const blockerChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 1 },
        }),
      ),
    );
    const dependentChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "dependent",
          input: null,
          blockers: [blockerChain],
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(dependentChain, completionOptions);
      expect(completed.output).toEqual({ result: "ok" });
    });

    expect(blockerAttempts).toBe(2);
  });
};
