import { type TestAPI } from "vitest";
import {
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  rescheduleJob,
  withTransactionHooks,
} from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const schedulingTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("startJobChain with schedule.afterMs defers job processing", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypeRegistry<{
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
      jobTypeRegistry,
    });
    const worker = await createInProcessWorker({
      client,
      workerId: "worker",
      concurrency: 1,
      jobTypeProcessorDefaults: { pollIntervalMs: 50 },
      jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
        client,
        jobTypeRegistry,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({ result: job.input.value * 2 }));
            },
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
          input: { value: 1 },
          schedule: { afterMs: 300 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await expect(client.awaitJobChain(jobChain, { timeoutMs: 200 })).rejects.toThrow();

      await expect(
        client.awaitJobChain(jobChain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();
    });
  });

  it("startJobChain with schedule.at defers job processing", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypeRegistry<{
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
      jobTypeRegistry,
    });
    const worker = await createInProcessWorker({
      client,
      workerId: "worker",
      concurrency: 1,
      jobTypeProcessorDefaults: { pollIntervalMs: 50 },
      jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
        client,
        jobTypeRegistry,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({ result: job.input.value * 2 }));
            },
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
          input: { value: 1 },
          schedule: { at: new Date(Date.now() + 300) },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await expect(client.awaitJobChain(jobChain, { timeoutMs: 200 })).rejects.toThrow();

      await expect(
        client.awaitJobChain(jobChain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();
    });
  });

  it("continueWith with schedule.afterMs defers continuation job", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypeRegistry<{
      first: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "second" };
      };
      second: {
        input: { continued: boolean };
        output: { result: string };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });

    const firstCompleted = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      client,
      workerId: "worker",
      concurrency: 1,
      jobTypeProcessorDefaults: { pollIntervalMs: 50 },
      jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
        client,
        jobTypeRegistry,
        processors: {
          first: {
            attemptHandler: async ({ complete }) => {
              try {
                return await complete(async ({ continueWith }) =>
                  continueWith({
                    typeName: "second",
                    input: { continued: true },
                    schedule: { afterMs: 300 },
                  }),
                );
              } finally {
                firstCompleted.resolve();
              }
            },
          },
          second: {
            attemptHandler: async ({ complete }) => {
              return complete(async () => ({ result: "done" }));
            },
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "first",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await firstCompleted.promise;

      await expect(client.awaitJobChain(jobChain, { timeoutMs: 200 })).rejects.toThrow();

      await expect(
        client.awaitJobChain(jobChain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();
    });
  });

  it("continueWith with schedule.at defers continuation job", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypeRegistry<{
      first: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "second" };
      };
      second: {
        input: { continued: boolean };
        output: { result: string };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });

    const firstCompleted = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      client,
      workerId: "worker",
      concurrency: 1,
      jobTypeProcessorDefaults: { pollIntervalMs: 50 },
      jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
        client,
        jobTypeRegistry,
        processors: {
          first: {
            attemptHandler: async ({ complete }) => {
              try {
                return await complete(async ({ continueWith }) =>
                  continueWith({
                    typeName: "second",
                    input: { continued: true },
                    schedule: { at: new Date(Date.now() + 300) },
                  }),
                );
              } finally {
                firstCompleted.resolve();
              }
            },
          },
          second: {
            attemptHandler: async ({ complete }) => {
              return complete(async () => ({ result: "done" }));
            },
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "first",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await firstCompleted.promise;

      await expect(client.awaitJobChain(jobChain, { timeoutMs: 200 })).rejects.toThrow();

      await expect(
        client.awaitJobChain(jobChain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();
    });
  });

  it("rescheduleJob with schedule.afterMs defers job retry", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypeRegistry<{
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
      jobTypeRegistry,
    });

    let attemptCount = 0;
    const firstAttemptDone = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      client,
      workerId: "worker",
      concurrency: 1,
      jobTypeProcessorDefaults: { pollIntervalMs: 50 },
      jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
        client,
        jobTypeRegistry,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              attemptCount++;
              if (attemptCount === 1) {
                firstAttemptDone.resolve();
                rescheduleJob({ afterMs: 300 }, "Rescheduling for later");
              }
              return complete(async () => ({ result: job.input.value * 2 }));
            },
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
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await firstAttemptDone.promise;

      await expect(client.awaitJobChain(jobChain, { timeoutMs: 200 })).rejects.toThrow();

      await expect(
        client.awaitJobChain(jobChain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();

      expect(attemptCount).toBe(2);
    });
  });

  it("recurring job self-schedules using deduplication with excludeJobChainIds", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypeRegistry<{
      recurring: {
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
      jobTypeRegistry,
    });

    let completionCount = 0;
    const allDone = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      client,
      workerId: "worker",
      concurrency: 1,
      jobTypeProcessorDefaults: { pollIntervalMs: 50 },
      jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
        client,
        jobTypeRegistry,
        processors: {
          recurring: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async ({ transactionHooks, ...txCtx }) => {
                completionCount++;
                if (completionCount < 3) {
                  await client.startJobChain({
                    ...txCtx,
                    transactionHooks,
                    typeName: "recurring",
                    input: null,
                    deduplication: {
                      key: "recurring",
                      excludeJobChainIds: [job.chainId],
                    },
                  });
                } else {
                  allDone.resolve();
                }
                return null;
              });
            },
          },
        },
      }),
    });

    await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "recurring",
          input: null,
          deduplication: { key: "recurring" },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await allDone.promise;

      const { items: chains } = await client.listJobChains({
        filter: { typeName: ["recurring"] },
        limit: 10,
      });
      expect(chains).toHaveLength(3);
      expect(completionCount).toBe(3);
    });
  });

  it("rescheduleJob with schedule.at defers job retry", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypeRegistry<{
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
      jobTypeRegistry,
    });

    let attemptCount = 0;
    const firstAttemptDone = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      client,
      workerId: "worker",
      concurrency: 1,
      jobTypeProcessorDefaults: { pollIntervalMs: 50 },
      jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
        client,
        jobTypeRegistry,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              attemptCount++;
              if (attemptCount === 1) {
                firstAttemptDone.resolve();
                rescheduleJob({ at: new Date(Date.now() + 300) }, "Rescheduling for later");
              }
              return complete(async () => ({ result: job.input.value * 2 }));
            },
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
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await firstAttemptDone.promise;

      await expect(client.awaitJobChain(jobChain, { timeoutMs: 200 })).rejects.toThrow();

      await expect(
        client.awaitJobChain(jobChain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();

      expect(attemptCount).toBe(2);
    });
  });
};
