import { type TestAPI } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { JobAlreadyCompletedError, JobTakenByAnotherWorkerError } from "../errors.js";
import { sleep } from "../helpers/sleep.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { type AttemptConfig } from "../worker/attempt-heartbeat.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const attemptReclaimerTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("allows to extend job attempt after expiration if wasn't grabbed by another worker", async ({
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
        attemptConfig: { timeoutMs: 10, heartbeatMs: 100 },
        processors: {
          test: {
            attemptHandler: async ({ finish }) => {
              // The lease lapses after 10ms; the renewal at 100ms extends it to 110ms and
              // finish at 150ms runs with the lease lapsed again.
              await sleep(150);

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

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "job_attempt_extended",
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: expect.stringContaining("expired"),
      }),
    );
  });

  it("reclaims expired attempts on extend", async ({
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

    let failed = false;
    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();
    const attemptConfig = { timeoutMs: 10, heartbeatMs: 100 } satisfies AttemptConfig;

    const worker1 = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: attemptConfig.timeoutMs,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig,
        processors: {
          test: {
            attemptHandler: async ({ signal, finish }) => {
              if (!failed) {
                failed = true;

                jobStarted.resolve();
                try {
                  await sleep(attemptConfig.heartbeatMs * 2, { signal });
                } finally {
                  expect(signal.aborted).toBe(true);
                  expect(signal.reason).toBeOneOf(["already_completed", "taken_by_another_worker"]);
                  jobCompleted.resolve();
                }
              }

              return withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const worker2 = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: attemptConfig.timeoutMs,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig,
        processors: {
          test: {
            attemptHandler: async ({ signal, finish }) => {
              if (!failed) {
                failed = true;

                jobStarted.resolve();
                try {
                  await sleep(attemptConfig.heartbeatMs * 2, { signal });
                } finally {
                  expect(signal.aborted).toBe(true);
                  expect(signal.reason).toBeOneOf(["already_completed", "taken_by_another_worker"]);
                  jobCompleted.resolve();
                }
              }

              return withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const failChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      }),
    );

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      await jobStarted.promise;
      await sleep(10);

      const successChain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      );

      await Promise.all([
        client.awaitChain(successChain, completionOptions),
        client.awaitChain(failChain, completionOptions),
      ]);

      await jobCompleted.promise;
    });

    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worker_error",
      }),
    );
  });

  it("reclaims expired attempts on finish", async ({
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

    let failed = false;
    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();
    const attemptConfig = { timeoutMs: 10, heartbeatMs: 100 } satisfies AttemptConfig;

    const worker1 = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: attemptConfig.timeoutMs,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig,
        processors: {
          test: {
            attemptHandler: async ({ finish }) => {
              if (!failed) {
                failed = true;

                jobStarted.resolve();
                await sleep(attemptConfig.heartbeatMs * 2);
                const finishError = await withTransaction(async (txCtx, transactionHooks) =>
                  finish({ ...txCtx, transactionHooks, output: null }),
                ).then(
                  () => undefined,
                  (error: unknown) => error,
                );
                expect(
                  finishError instanceof JobTakenByAnotherWorkerError ||
                    finishError instanceof JobAlreadyCompletedError,
                ).toBe(true);
                jobCompleted.resolve();
                throw new Error("attempt lost", { cause: finishError });
              }
              await sleep(10);

              return withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const worker2 = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: attemptConfig.timeoutMs,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig,
        processors: {
          test: {
            attemptHandler: async ({ finish }) => {
              if (!failed) {
                failed = true;

                jobStarted.resolve();
                await sleep(attemptConfig.heartbeatMs * 2);
                const finishError = await withTransaction(async (txCtx, transactionHooks) =>
                  finish({ ...txCtx, transactionHooks, output: null }),
                ).then(
                  () => undefined,
                  (error: unknown) => error,
                );
                expect(
                  finishError instanceof JobTakenByAnotherWorkerError ||
                    finishError instanceof JobAlreadyCompletedError,
                ).toBe(true);
                jobCompleted.resolve();
                throw new Error("attempt lost", { cause: finishError });
              }
              await sleep(10);

              return withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const failChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      }),
    );

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      await jobStarted.promise;
      await sleep(10);

      const successChain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      );

      await Promise.all([
        client.awaitChain(successChain, completionOptions),
        client.awaitChain(failChain, completionOptions),
      ]);

      await jobCompleted.promise;
    });

    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worker_error",
      }),
    );
  });

  it("does not reclaim its own in-progress attempts with concurrent slots", async ({
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
        input: { id: number };
        output: { id: number };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const jobsStarted = Promise.withResolvers<void>();
    const jobsCanComplete = Promise.withResolvers<void>();
    const processedJobs: number[] = [];
    const attemptConfig = { timeoutMs: 10, heartbeatMs: 1000 } satisfies AttemptConfig;

    const worker = await createInProcessWorker({
      client,
      concurrency: 2,
      pollIntervalMs: 10,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig,
        processors: {
          test: {
            attemptHandler: async ({ job, finish }) => {
              processedJobs.push(job.input.id);
              jobsStarted.resolve();

              await jobsCanComplete.promise;

              expect(job.attempt).toBe(1);

              return withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: { id: job.input.id } }),
              );
            },
          },
        },
      }),
    });

    const chain1 = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { id: 1 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await jobsStarted.promise;

      await sleep(attemptConfig.timeoutMs * 5);

      const chain2 = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { id: 2 },
        }),
      );

      jobsCanComplete.resolve();

      await Promise.all([
        client.awaitChain(chain1, completionOptions),
        client.awaitChain(chain2, completionOptions),
      ]);
    });

    expect(processedJobs.sort((a, b) => a - b)).toEqual([1, 2]);

    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "job_attempt_reclaimed",
      }),
    );

    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worker_error",
      }),
    );
  });

  it("reclaims an attempt after a crash before the first heartbeat", async ({
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

    // The lease is set at acquire, so an attempt that never reaches its first renewal still
    // expires and is reclaimed.
    const attemptConfig = { timeoutMs: 50, heartbeatMs: 60_000 } satisfies AttemptConfig;
    const crashedStarted = Promise.withResolvers<void>();
    const releaseCrashed = Promise.withResolvers<void>();

    const crashedWorker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig,
        processors: {
          test: {
            attemptHandler: async () => {
              crashedStarted.resolve();
              // Simulates a crashed process: the attempt never renews its lease or finishes.
              await releaseCrashed.promise;
              throw new Error("crashed");
            },
          },
        },
      }),
    });

    let reclaimedAttempt: { attempt: number; lastAttemptError: string | null } | undefined;
    const recoveringWorker = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 20,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig,
        processors: {
          test: {
            attemptHandler: async ({ job, finish }) => {
              reclaimedAttempt = { attempt: job.attempt, lastAttemptError: job.lastAttemptError };
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

    const stopCrashedWorker = await crashedWorker.start();
    try {
      await crashedStarted.promise;

      await withWorkers([await recoveringWorker.start()], async () => {
        await client.awaitChain(chain, completionOptions);
      });
    } finally {
      releaseCrashed.resolve();
      await stopCrashedWorker();
    }

    expect(reclaimedAttempt?.attempt).toBe(2);
    expect(reclaimedAttempt?.lastAttemptError).toContain("JobAttemptExpiredError");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "job_attempt_reclaimed",
      }),
    );
  });
};
