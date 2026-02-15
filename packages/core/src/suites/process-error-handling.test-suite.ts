import { type TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createClient, createInProcessWorker, defineJobTypes } from "../index.js";
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

    const registry = defineJobTypes<{
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
    const worker = await createInProcessWorker({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        test: {
          retryConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
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
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    // Attempt 1: prepare throws, reschedule in same transaction
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

    const registry = defineJobTypes<{
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
    const worker = await createInProcessWorker({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        test: {
          retryConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
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
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    // Same as atomic: prepare throws before resolve(), so TX is still pending
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

    const registry = defineJobTypes<{
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
    const worker = await createInProcessWorker({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        test: {
          retryConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
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
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    // TX still pending in atomic mode, reschedule chains into same TX
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

    const registry = defineJobTypes<{
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
    const worker = await createInProcessWorker({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        test: {
          retryConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
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
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    // Prepare TX committed. Error handler runs in new TX with refetch
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

    const registry = defineJobTypes<{
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
    const worker = await createInProcessWorker({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        test: {
          retryConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
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
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    // Complete runs in same pending TX. Error handler also chains into same TX
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

    const registry = defineJobTypes<{
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
    const worker = await createInProcessWorker({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        test: {
          retryConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
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
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    // Prepare TX committed. Complete creates TX2 (getJobForUpdate). Error handler chains rescheduleJob into TX2
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

    const registry = defineJobTypes<{
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
    const worker = await createInProcessWorker({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        test: {
          retryConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
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
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    expect(attempts).toBe(2);

    // Complete succeeds in TX1, then error handler chains rescheduleJob into same TX1.
    // rescheduleJob overwrites completed state back to pending. All committed atomically.
    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
          expect.objectContaining({ name: "completeJob" }),
          expect.objectContaining({ name: "getJobById" }),
          expect.objectContaining({ name: "scheduleBlockedJobs" }),
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

    const registry = defineJobTypes<{
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
    const worker = await createInProcessWorker({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        test: {
          retryConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
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
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    expect(attempts).toBe(2);

    // Prepare TX committed. Complete runs in TX2. Error handler chains rescheduleJob into TX2
    // (still pending). rescheduleJob overwrites completed state. TX2 commits.
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
          expect.objectContaining({ name: "completeJob" }),
          expect.objectContaining({ name: "getJobById" }),
          expect.objectContaining({ name: "scheduleBlockedJobs" }),
          expect.objectContaining({ name: "rescheduleJob" }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });
};
