import { type TestAPI, expect } from "vitest";

import { createClient } from "../client.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../job-type-processors/create-job-type-processors.js";
import { defineJobTypes } from "../job-types/define-job-types.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

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
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            backoffConfig: fastBackoff,
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt === 1) {
                throw new Error("Simulated handler error");
              }
              expect(job.lastAttemptError).toContain("Error: Simulated handler error");
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value * 2 } }),
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

    expect((await client.getJob({ id: chain.id }))?.attempt).toBe(2);
  });

  it("reschedules when handler throws inside its transaction before complete", async ({
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
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("Error: Simulated handler error");
              }
              return withTransaction(async (txCtx, transactionHooks) => {
                if (job.attempt === 1) {
                  throw new Error("Simulated handler error");
                }
                return complete({
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

    expect((await client.getJob({ id: chain.id }))?.attempt).toBe(2);
  });

  it("reschedules when handler throws inside its transaction after complete", async ({
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
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt > 1) {
                expect(job.lastAttemptError).toContain("Error: Error after complete");
              }
              return withTransaction(async (txCtx, transactionHooks) => {
                const result = await complete({
                  ...txCtx,
                  transactionHooks,
                  output: { result: job.input.value * 2 },
                });
                if (job.attempt === 1) {
                  throw new Error("Error after complete");
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

    expect((await client.getJob({ id: chain.id }))?.attempt).toBe(2);
  });

  it("reschedules when handler returns without calling complete", async ({
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
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: fastBackoff,
        processors: {
          test: {
            // @ts-expect-error the handler must return what complete returned
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt === 1) {
                return;
              }
              expect(job.lastAttemptError).toContain(
                "Attempt handler returned without a committed `complete` call",
              );
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { done: true } }),
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

    expect((await client.getJob({ id: chain.id }))?.attempt).toBe(2);
  });

  it("recovers when user code poisons its transaction before complete", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    poisonTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                if (job.attempt === 1) {
                  await poisonTransaction(txCtx);
                }
                return complete({
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

    expect((await client.getJob({ id: chain.id }))?.attempt).toBe(2);
  });

  it("recovers when user code poisons a separate transaction before complete", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    poisonTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt === 1) {
                await withTransaction(async (txCtx) => {
                  await poisonTransaction(txCtx);
                });
              }
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value * 2 } }),
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

  it("rolls back the continuation when handler throws after complete with continueWith inside its transaction", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
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
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          step1: {
            backoffConfig: fastBackoff,
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                const result = await complete({
                  ...txCtx,
                  transactionHooks,
                  continueWith: { typeName: "step2", input: { value: job.input.value * 2 } },
                });
                if (job.attempt === 1) {
                  throw new Error("Error after complete with continueWith");
                }
                return result;
              }),
          },
          step2: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value } }),
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

    expect((await client.getJob({ id: chain.id }))?.attempt).toBe(2);
    const jobs = await client.listChainJobs({ chainId: chain.id });
    expect(jobs.items.map((job) => job.typeName)).toEqual(["step1", "step2"]);
  });

  it("keeps the dependent blocked when the blocker handler throws after complete inside its transaction", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
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
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                const result = await complete({
                  ...txCtx,
                  transactionHooks,
                  output: { done: true },
                });
                if (job.attempt === 1) {
                  throw new Error("Error after blocker complete");
                }
                return result;
              }),
          },
          dependent: {
            attemptHandler: async ({ job, complete }) => {
              const [blocker] = job.blockers;
              expect((await client.getJob({ id: blocker.id }))?.attempt).toBe(2);
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: "ok" } }),
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
  });

  it("serializes various error types in lastAttemptError", async ({
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
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            backoffConfig: fastBackoff,
            // Each attempt checks the error the previous one left; any other attempt keeps failing.
            attemptHandler: async ({ job, complete }) => {
              switch (job.attempt) {
                case 1:
                  throw new Error("plain error");
                case 2:
                  expect(job.lastAttemptError).toContain("plain error");
                  expect(job.lastAttemptError).toMatch(/at\s/);
                  // oxlint-disable-next-line typescript/only-throw-error -- test intentionally throws non-Error values
                  throw { code: "ETIMEOUT", detail: "connection lost" };
                case 3:
                  expect(job.lastAttemptError).toContain("ETIMEOUT");
                  expect(job.lastAttemptError).toContain("connection lost");
                  // oxlint-disable-next-line typescript/only-throw-error -- test intentionally throws non-Error values
                  throw "string error";
                case 4:
                  expect(job.lastAttemptError).toBe("string error");
                  return withTransaction(async (txCtx, transactionHooks) =>
                    complete({ ...txCtx, transactionHooks, output: null }),
                  );
                default:
                  throw new Error(`unexpected attempt ${job.attempt}`);
              }
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
  });

  it("completes when handler catches an error from its own transaction and then finishes", async ({
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
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            backoffConfig: fastBackoff,
            attemptHandler: async ({ job, complete }) => {
              expect(job.attempt).toBe(1);
              await expect(
                withTransaction(async () => {
                  throw new Error("transaction boom");
                }),
              ).rejects.toThrow("transaction boom");
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
      await client.awaitChain(chain, completionOptions);
    });
  });

  it("reschedules with fractional backoff delays", async ({
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
            // 1.5 ms, then 2.25 ms
            backoffConfig: { initialDelayMs: 1.5, multiplier: 1.5, maxDelayMs: 10 },
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt < 3) {
                throw new Error(`Simulated error on attempt ${job.attempt}`);
              }
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value * 2 } }),
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
};
