import { sleep } from "@queuert/helpers";
import { type TestAPI, expect } from "vitest";

import { createClient } from "../client.js";
import { JobAlreadyCompletedError, JobTakenByAnotherWorkerError } from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../job-type-processors/create-job-type-processors.js";
import { defineJobTypes } from "../job-types/define-job-types.js";
import { type AttemptConfig } from "../worker/attempt-heartbeat.js";
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
    const handlerAsserted = Promise.withResolvers<void>();
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig: { timeoutMs: 10, heartbeatMs: 100 },
        processors: {
          test: {
            attemptHandler: async ({ job, signal, complete }) => {
              // The attempt expires after 10ms; the extension at 100ms moves its deadline forward.
              await sleep(150);
              const current = await client.getJob({ id: job.id });
              if (current?.status !== "running") throw new Error(`job is ${current?.status}`);
              expect(current.attemptUntil.getTime()).toBeGreaterThan(job.attemptUntil.getTime());
              expect(signal.aborted).toBe(false);
              handlerAsserted.resolve();

              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
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
      await handlerAsserted.promise;
      await client.awaitChain(chain, completionOptions);
    });
  });

  it("reclaims expired attempts on extend", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { fail: boolean };
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
            attemptHandler: async ({ job, signal, complete }) => {
              if (job.attempt === 2) {
                expect(job.lastAttemptError).toMatch(/^JobAttemptExpiredError: /);
                expect(job.lastAttemptError).toContain('"reclaimedBy"');
              }
              if (job.input.fail && job.attempt === 1) {
                jobStarted.resolve();
                try {
                  await sleep(attemptConfig.heartbeatMs * 2, { signal });
                } finally {
                  expect(signal.aborted).toBe(true);
                  jobCompleted.resolve();
                }
              }

              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
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
            attemptHandler: async ({ job, signal, complete }) => {
              if (job.attempt === 2) {
                expect(job.lastAttemptError).toMatch(/^JobAttemptExpiredError: /);
                expect(job.lastAttemptError).toContain('"reclaimedBy"');
              }
              if (job.input.fail && job.attempt === 1) {
                jobStarted.resolve();
                try {
                  await sleep(attemptConfig.heartbeatMs * 2, { signal });
                } finally {
                  expect(signal.aborted).toBe(true);
                  jobCompleted.resolve();
                }
              }

              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
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
        input: { fail: true },
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
          input: { fail: false },
        }),
      );

      await Promise.all([
        client.awaitChain(successChain, completionOptions),
        client.awaitChain(failChain, completionOptions),
      ]);

      await jobCompleted.promise;
    });
  });

  it("reclaims expired attempts when `complete` runs late", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { fail: boolean };
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
            attemptHandler: async ({ job, complete }) => {
              if (job.input.fail && job.attempt === 1) {
                jobStarted.resolve();
                await sleep(attemptConfig.heartbeatMs * 2);
                await expect(
                  withTransaction(async (txCtx, transactionHooks) =>
                    complete({ ...txCtx, transactionHooks, output: null }),
                  ),
                ).rejects.toSatisfy(
                  (error) =>
                    error instanceof JobTakenByAnotherWorkerError ||
                    error instanceof JobAlreadyCompletedError,
                );
                jobCompleted.resolve();
                throw new Error("attempt lost");
              }
              await sleep(10);

              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
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
            attemptHandler: async ({ job, complete }) => {
              if (job.input.fail && job.attempt === 1) {
                jobStarted.resolve();
                await sleep(attemptConfig.heartbeatMs * 2);
                await expect(
                  withTransaction(async (txCtx, transactionHooks) =>
                    complete({ ...txCtx, transactionHooks, output: null }),
                  ),
                ).rejects.toSatisfy(
                  (error) =>
                    error instanceof JobTakenByAnotherWorkerError ||
                    error instanceof JobAlreadyCompletedError,
                );
                jobCompleted.resolve();
                throw new Error("attempt lost");
              }
              await sleep(10);

              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
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
        input: { fail: true },
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
          input: { fail: false },
        }),
      );

      await Promise.all([
        client.awaitChain(successChain, completionOptions),
        client.awaitChain(failChain, completionOptions),
      ]);

      await jobCompleted.promise;
    });
  });

  it("rejects complete from a slot whose attempt another slot of the same worker re-acquired", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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

    const attemptConfig = { timeoutMs: 10, heartbeatMs: 1000 } satisfies AttemptConfig;
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    const releaseSecond = Promise.withResolvers<void>();
    const firstRejected = Promise.withResolvers<void>();

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
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt === 1) {
                firstStarted.resolve();
                await releaseFirst.promise;
                await expect(
                  withTransaction(async (txCtx, transactionHooks) =>
                    complete({ ...txCtx, transactionHooks, output: null }),
                  ),
                ).rejects.toThrow(JobTakenByAnotherWorkerError);
                firstRejected.resolve();
                throw new Error("attempt lost");
              }

              secondStarted.resolve();
              await releaseSecond.promise;
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const reclaimer = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 10,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig,
        processors: {
          test: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, reschedule: { afterMs: 100 } }),
              ),
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
      await firstStarted.promise;
      await withWorkers([await reclaimer.start()], async () => {
        await secondStarted.promise;
      });

      releaseFirst.resolve();
      await firstRejected.promise;

      releaseSecond.resolve();
      await client.awaitChain(chain, completionOptions);
    });
  });

  it("does not reclaim its own in-progress attempts with concurrent slots", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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
            attemptHandler: async ({ job, complete }) => {
              jobsStarted.resolve();

              await jobsCanComplete.promise;

              expect(job.attempt).toBe(1);

              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { id: job.input.id } }),
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
  });

  it("reclaims an attempt after a crash before the first heartbeat", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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

    // `attemptUntil` is set at acquire, so an attempt that never reaches its first extension still
    // expires and is reclaimed.
    const attemptConfig = { timeoutMs: 50, heartbeatMs: 60_000 } satisfies AttemptConfig;
    const crashedStarted = Promise.withResolvers<void>();

    const crashedWorker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig,
        processors: {
          test: {
            attemptHandler: async ({ signal }) => {
              crashedStarted.resolve();
              // Simulates a crashed process: the attempt is never extended or finished, and the
              // handler only returns once its worker stops.
              await sleep(Number.POSITIVE_INFINITY, { signal });
              throw new Error("crashed");
            },
          },
        },
      }),
    });

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
            attemptHandler: async ({ job, complete }) => {
              expect(job.attempt).toBe(2);
              expect(job.lastAttemptError).toContain("JobAttemptExpiredError");
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
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

    await withWorkers([await crashedWorker.start()], async () => {
      await crashedStarted.promise;
      await withWorkers([await recoveringWorker.start()], async () => {
        await client.awaitChain(chain, completionOptions);
      });
    });
  });
};
