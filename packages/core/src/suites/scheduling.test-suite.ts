import { type TestAPI } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { rescheduleJob } from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const schedulingTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("startChain with schedule.afterMs defers job processing", async ({
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
      pollIntervalMs: 50,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({ result: job.input.value * 2 }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
          schedule: { afterMs: 300 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await expect(client.awaitChain(chain, { timeoutMs: 200 })).rejects.toThrow();

      await expect(
        client.awaitChain(chain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();
    });
  });

  it("startChain with schedule.at defers job processing", async ({
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
      pollIntervalMs: 50,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({ result: job.input.value * 2 }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
          schedule: { at: new Date(Date.now() + 300) },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await expect(client.awaitChain(chain, { timeoutMs: 200 })).rejects.toThrow();

      await expect(
        client.awaitChain(chain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();
    });
  });

  it("continueWith with schedule.afterMs defers continuation job", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const firstCompleted = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 50,
      processors: createProcessors({
        client,
        jobTypes,
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "first",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await firstCompleted.promise;

      await expect(client.awaitChain(chain, { timeoutMs: 200 })).rejects.toThrow();

      await expect(
        client.awaitChain(chain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();
    });
  });

  it("continueWith with schedule.at defers continuation job", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const firstCompleted = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 50,
      processors: createProcessors({
        client,
        jobTypes,
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "first",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await firstCompleted.promise;

      await expect(client.awaitChain(chain, { timeoutMs: 200 })).rejects.toThrow();

      await expect(
        client.awaitChain(chain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();
    });
  });

  it("rescheduleJob with schedule.afterMs defers job retry", async ({
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

    let attemptCount = 0;
    const firstAttemptDone = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 50,
      processors: createProcessors({
        client,
        jobTypes,
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await firstAttemptDone.promise;

      await expect(client.awaitChain(chain, { timeoutMs: 200 })).rejects.toThrow();

      await expect(
        client.awaitChain(chain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();

      expect(attemptCount).toBe(2);
    });
  });

  it("recurring job self-schedules using deduplication with excludeChainIds", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    let completionCount = 0;
    const allDone = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 50,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          recurring: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async ({ transactionHooks, ...txCtx }) => {
                completionCount++;
                if (completionCount < 3) {
                  await client.startChain({
                    ...txCtx,
                    transactionHooks,
                    typeName: "recurring",
                    input: null,
                    deduplication: {
                      key: "recurring",
                      excludeChainIds: [job.chainId],
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
      withTransaction(async (txCtx) =>
        client.startChain({
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

      const { items: chains } = await client.listChains({
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
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
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

    let attemptCount = 0;
    const firstAttemptDone = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 50,
      processors: createProcessors({
        client,
        jobTypes,
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await firstAttemptDone.promise;

      await expect(client.awaitChain(chain, { timeoutMs: 200 })).rejects.toThrow();

      await expect(
        client.awaitChain(chain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();

      expect(attemptCount).toBe(2);
    });
  });

  it("startChain with past schedule.at clamps scheduledAt to now", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
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
          test: { attemptHandler: async ({ complete }) => complete(async () => null) },
        },
      }),
    });

    const past = new Date(Date.now() - 60 * 60 * 1000);

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
          schedule: { at: past },
        }),
      ),
    );

    const rootJob = await stateAdapter.getJob({ jobId: chain.id });
    expect(rootJob).toBeDefined();
    expect(rootJob!.scheduledAt.getTime() - past.getTime()).toBeGreaterThan(30 * 60 * 1000);

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, { timeoutMs: 2000, pollIntervalMs: 50 });
    });
  });

  it("continueWith with past schedule.at clamps scheduledAt to now", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      first: { entry: true; input: null; continueWith: { typeName: "second" } };
      second: { input: null; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const past = new Date(Date.now() - 60 * 60 * 1000);

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          first: {
            attemptHandler: async ({ complete }) =>
              complete(async ({ continueWith }) =>
                continueWith({ typeName: "second", input: null, schedule: { at: past } }),
              ),
          },
          second: { attemptHandler: async ({ complete }) => complete(async () => null) },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "first",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, { timeoutMs: 2000, pollIntervalMs: 50 });
    });

    const chainJobs = await stateAdapter.listChainJobs({
      chainId: chain.id,
      orderDirection: "asc",
      page: { limit: 10 },
    });
    const continuation = chainJobs.items.find((j) => j.chainIndex === 1);
    expect(continuation).toBeDefined();
    expect(continuation!.scheduledAt.getTime() - past.getTime()).toBeGreaterThan(30 * 60 * 1000);
  });

  it("rescheduleJob with past schedule.at clamps scheduledAt to now", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const past = new Date(Date.now() - 60 * 60 * 1000);
    let attempts = 0;
    const firstAttemptDone = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 50,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              attempts++;
              if (attempts === 1) {
                firstAttemptDone.resolve();
                rescheduleJob({ at: past }, "retry");
              }
              return complete(async () => null);
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await firstAttemptDone.promise;
      await client.awaitChain(chain, { timeoutMs: 2000, pollIntervalMs: 50 });
    });

    expect(attempts).toBe(2);
  });
};
