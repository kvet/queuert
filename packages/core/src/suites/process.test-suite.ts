import { sleep } from "@queuert/helpers";
import { type TestAPI, expect, expectTypeOf } from "vitest";

import { createClient } from "../client.js";
import { ChainNotFoundError, JobAlreadyCompletedError } from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../job-type-processors/create-job-type-processors.js";
import { defineJobTypes } from "../job-types/define-job-types.js";
import { createSpyStateAdapter } from "../state-adapter/state-adapter.spy.spec-helper.js";
import { type TransactionHooks, withTransactionHooks } from "../transaction-hooks.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const processTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("throws error when complete is called incorrectly", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withNonTransactionContext,
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

    const completeAfterHandler = Promise.withResolvers<() => Promise<unknown>>();
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              await withNonTransactionContext(async (nonTransactionCtx) =>
                withTransactionHooks(async (transactionHooks) =>
                  expect(
                    complete({ ...nonTransactionCtx, transactionHooks, output: null }),
                  ).rejects.toThrow("not in a transaction"),
                ),
              );
              const result = await withTransaction(async (txCtx, transactionHooks) => {
                await expect(
                  complete({
                    ...txCtx,
                    transactionHooks,
                    output: null,
                    ...({ reschedule: { afterMs: 1 } } as object),
                  }),
                ).rejects.toThrow(
                  "complete requires exactly one of output, continueWith or reschedule",
                );
                await expect(
                  // @ts-expect-error transactionHooks is required
                  complete({ ...txCtx, output: null }),
                ).rejects.toThrow("complete requires transactionHooks");
                await expect(
                  // @ts-expect-error the caller's transaction context is required
                  complete({ transactionHooks, output: null }),
                ).rejects.toThrow(
                  "complete requires a transaction context from the caller's transaction",
                );

                return complete({ ...txCtx, transactionHooks, output: null });
              });
              completeAfterHandler.resolve(async () =>
                withTransaction(async (txCtx, transactionHooks) =>
                  complete({ ...txCtx, transactionHooks, output: null }),
                ),
              );
              return result;
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

    const callComplete = await completeAfterHandler.promise;
    await expect(callComplete()).rejects.toThrow(
      "complete cannot be called after the attempt handler has ended",
    );
  });

  it("provides attempt information to job process", async ({
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

    const attempts: number[] = [];

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
        backoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              attempts.push(job.attempt);

              expectTypeOf(job.attempt).toEqualTypeOf<number>();
              expectTypeOf(job.lastAttemptAt).toEqualTypeOf<Date | null>();
              expectTypeOf(job.lastAttemptError).toEqualTypeOf<string | null>();

              expect(job.attempt).toBeGreaterThan(0);
              if (job.attempt > 1) {
                expect(job.lastAttemptAt).toBeInstanceOf(Date);
                expect(job.lastAttemptError).toContain("Error: Simulated failure");
              } else {
                expect(job.lastAttemptAt).toBeNull();
                expect(job.lastAttemptError).toBeNull();
              }

              if (job.attempt < 3) {
                throw new Error("Simulated failure");
              }

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

    expect(attempts).toEqual([1, 2, 3]);
  });

  it("clears lastAttemptError after a successful attempt following a failure", async ({
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
        backoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt < 2) {
                throw new Error("Simulated failure");
              }
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

    const completedJob = await client.getJob({ id: chain.id });
    expect(completedJob?.status).toBe("completed");
    expect(completedJob?.lastAttemptError).toBeNull();
  });

  it("uses exponential backoff progression for repeated failures", async ({
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

    const errors: string[] = [];

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
        backoffConfig: {
          initialDelayMs: 10,
          multiplier: 2.0,
          maxDelayMs: 100,
        },
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.lastAttemptError) {
                errors.push(job.lastAttemptError);
              }

              if (job.attempt < 4) {
                throw new Error("Unexpected error");
              }

              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const job = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(job, completionOptions);
    });

    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("Error: Unexpected error");
    expect(errors[1]).toContain("Error: Unexpected error");
    expect(errors[2]).toContain("Error: Unexpected error");
  });

  it("executes jobs", async ({
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
        input: { test: boolean };
        output: { result: boolean };
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
      workerName: "worker",
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf(job.typeName).toEqualTypeOf<"test">();
              expectTypeOf(job.input).toEqualTypeOf<{ test: boolean }>();
              expectTypeOf(job.status).toEqualTypeOf<"running">();
              expect(job.typeName).toBe("test");
              expect(job.input).toEqual({ test: true });
              expect(job.status).toBe("running");
              expect(job.id).toBeDefined();
              expect(job.chainId).toEqual(job.id);

              return withTransaction(async (txCtx, transactionHooks) => {
                expectTypeOf(txCtx).toEqualTypeOf<{ $test: true }>();

                const completedJob = await complete({
                  ...txCtx,
                  transactionHooks,
                  output: { result: true },
                });
                expectTypeOf(completedJob.typeName).toEqualTypeOf<"test">();
                expectTypeOf(completedJob.status).toEqualTypeOf<"completed">();
                expect(completedJob.typeName).toBe("test");
                expect(completedJob.status).toBe("completed");
                if (completedJob.status === "completed") {
                  expectTypeOf(completedJob.completedBy).toEqualTypeOf<string | null>();
                  expect(completedJob.completedBy).toMatch(/^[0-9a-f-]{36}$/);
                }
                return completedJob;
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
        input: { test: true },
      }),
    );
    // expectTypeOf<(typeof chain)["status"]>().toEqualTypeOf<"pending" | "blocked">();
    expectTypeOf<(typeof chain)["input"]>().toEqualTypeOf<{ test: boolean }>();
    expectTypeOf<(typeof chain)["typeName"]>().toEqualTypeOf<"test">();
    expect(chain.input).toEqual({ test: true });

    await withWorkers([await worker.start()], async () => {
      const completedChain = await client.awaitChain(chain, completionOptions);
      expectTypeOf<(typeof completedChain)["status"]>().toEqualTypeOf<"completed">();
      expectTypeOf<(typeof completedChain)["output"]>().toEqualTypeOf<{
        result: boolean;
      }>();
      expect(completedChain.status).toBe("completed");
      expect(completedChain.output).toEqual({ result: true });
    });

    const completedJob = await client.getJob({ id: chain.id });
    expect(completedJob?.status).toBe("completed");
    if (completedJob?.status === "completed") {
      expect(completedJob.completedBy).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("complete should be visible to reads later in the same transaction", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      "output-then-read": {
        entry: true;
        input: null;
        output: { done: true };
      };
      "continue-then-read": {
        entry: true;
        input: null;
        continueWith: { typeName: "tail" };
      };
      tail: {
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
        processors: {
          "output-then-read": {
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                const completedJob = await complete({
                  ...txCtx,
                  transactionHooks,
                  output: { done: true },
                });
                expect((await client.getJob({ ...txCtx, id: job.id }))?.status).toBe("completed");
                expect((await client.getChain({ ...txCtx, id: job.chainId }))?.status).toBe(
                  "completed",
                );
                return completedJob;
              }),
          },
          "continue-then-read": {
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                const completedJob = await complete({
                  ...txCtx,
                  transactionHooks,
                  continueWith: { typeName: "tail", input: null },
                });
                expect((await client.getJob({ ...txCtx, id: job.id }))?.status).toBe("completed");
                return completedJob;
              }),
          },
          tail: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { done: true } }),
              ),
          },
        },
      }),
    });

    const [completedChain, continuedChain] = await withTransaction(
      async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "output-then-read", input: null },
            { typeName: "continue-then-read", input: null },
          ],
        }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(completedChain, completionOptions);
      await client.awaitChain(continuedChain, completionOptions);
    });
  });

  it("keeps a committed `complete` call when the handler throws afterwards", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { done: true } };
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
      processors: createProcessors({
        client,
        jobTypes,
        // A throw that failed the attempt would delay the next one past the test timeout.
        backoffConfig: { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 },
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt === 1) {
                await withTransaction(async (txCtx, transactionHooks) =>
                  complete({ ...txCtx, transactionHooks, reschedule: { afterMs: 1 } }),
                );
                throw new Error("after a committed reschedule");
              }
              await withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { done: true } }),
              );
              throw new Error("after a committed output");
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ done: true });
    });

    const job = await client.getJob({ id: chain.id });
    expect(job?.attempt).toBe(2);
  });

  it("writes nothing when complete fails validation, so the caller may catch and complete again", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: { entry: true; input: null; output: null };
      test: { entry: true; input: null; output: null; continueWith: { typeName: "next" } };
      next: { input: null; output: null; blockers: [{ typeName: "blocker" }] };
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
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                // A missing blocker chain is the validation that reads the database, so it
                // proves validation runs before the first write.
                await expect(
                  complete({
                    ...txCtx,
                    transactionHooks,
                    continueWith: {
                      typeName: "next",
                      input: null,
                      blockers: [{ id: crypto.randomUUID(), typeName: "blocker" }],
                    },
                  }),
                ).rejects.toThrow(ChainNotFoundError);
                return complete({ ...txCtx, transactionHooks, output: null });
              }),
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

    const jobs = await client.listChainJobs({ chainId: chain.id });
    expect(jobs.items.map((job) => job.typeName)).toEqual(["test"]);
  });

  it("fails the attempt when a retried transaction reuses the transactionHooks of a successful complete", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { try: number } };
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
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: { initialDelayMs: 1, maxDelayMs: 1 },
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              // The first try commits `complete`, then its transaction rolls back.
              const runTry = async (transactionHooks: TransactionHooks, tryNumber: number) =>
                stateAdapter.withTransaction(async (txCtx) => {
                  const result = await complete({
                    ...txCtx,
                    transactionHooks,
                    output: { try: tryNumber },
                  });
                  if (tryNumber === 1) throw new Error("serialization failure");
                  return result;
                });
              if (job.attempt === 1) {
                return withTransactionHooks(async (transactionHooks) => {
                  await runTry(transactionHooks, 1).catch(() => {});
                  return runTry(transactionHooks, 2);
                });
              }
              return withTransactionHooks(async (transactionHooks) =>
                runTry(transactionHooks, 1),
              ).catch(async () =>
                withTransactionHooks(async (transactionHooks) => runTry(transactionHooks, 2)),
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
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ try: 2 });
    });

    expect((await client.getJob({ id: chain.id }))?.attempt).toBe(2);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "job_attempt_failed",
        error: expect.objectContaining({
          message: expect.stringContaining("complete already succeeded"),
        }),
      }),
    );
    const completedLogs = log.mock.calls
      .map((call) => call[0])
      .filter((entry) => entry.type === "job_completed");
    expect(completedLogs).toHaveLength(1);
    expect(completedLogs[0].data).toEqual(expect.objectContaining({ output: { try: 2 } }));
  });

  it("rejects a concurrent `complete` call with the same transactionHooks without losing the attempt", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);
    const client = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ signal, complete }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                const completed = complete({ ...txCtx, transactionHooks, output: null });
                await expect(
                  complete({ ...txCtx, transactionHooks, output: null }),
                ).rejects.toThrow("complete is already in progress with these transactionHooks");
                await expect(completed).resolves.toMatchObject({ status: "completed" });
                expect(signal.aborted).toBe(false);
                return completed;
              }),
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

    expect(spyStateAdapter.calls.map((call) => call.name)).not.toContain("rescheduleJobs");
  });

  it("trusts a committed `complete` result returned by the handler without rescheduling", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);
    const client = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ),
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

    expect(spyStateAdapter.calls.map((call) => call.name)).not.toContain("rescheduleJobs");
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ type: "job_attempt_completed" }));
  });

  it("completes the attempt on a committed `complete` call when the handler returns another object", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);
    const client = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 },
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              const completed = await withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
              return { ...completed };
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

    expect(spyStateAdapter.calls.map((call) => call.name)).not.toContain("rescheduleJobs");
  });

  it("completes the attempt and reports a worker error when the handler throws after a committed `complete` call", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);
    const workerError = Promise.withResolvers<unknown>();
    const client = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter: {
        ...observabilityAdapter,
        workerError: ({ error }) => {
          workerError.resolve(error);
        },
      },
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 },
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              await withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
              throw new Error("after a committed complete");
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
      await expect(workerError.promise).resolves.toMatchObject({
        message: "after a committed complete",
      });
    });

    expect(spyStateAdapter.calls.map((call) => call.name)).not.toContain("rescheduleJobs");
    expect((await client.getJob({ id: chain.id }))?.attempt).toBe(1);
  });

  it("reschedules the attempt when complete rolls back in a savepoint", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withSavepoint,
    withWorkers,
    observabilityAdapter,
    log,
    skip,
  }) => {
    if (!withSavepoint) return skip();

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
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 },
        processors: {
          test: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                let receipt: Awaited<ReturnType<typeof complete>> | undefined;
                try {
                  await transactionHooks.withSavepoint(async (transactionHooks) =>
                    withSavepoint(txCtx, async (txCtx) => {
                      receipt = await complete({ ...txCtx, transactionHooks, output: null });
                      throw new Error("rollback to savepoint");
                    }),
                  );
                } catch {}
                return receipt!;
              }),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await expect
        .poll(
          async () => {
            const job = await client.getJob({ id: chain.id });
            return { status: job?.status, attempt: job?.attempt };
          },
          { timeout: 5000 },
        )
        .toEqual({ status: "pending", attempt: 1 });
    });

    const job = await client.getJob({ id: chain.id });
    expect(job?.lastAttemptError).toContain(
      "Attempt handler returned without a committed `complete` call",
    );
    expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ type: "job_completed" }));
  });

  it("commits the `complete` call made after one rolled back in a savepoint", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withSavepoint,
    withWorkers,
    observabilityAdapter,
    log,
    skip,
  }) => {
    if (!withSavepoint) return skip();

    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { from: string } };
    }>();
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);
    const client = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                // A failed call before the savepoint, so the savepoint restores an existing slot.
                await expect(
                  complete({
                    ...txCtx,
                    transactionHooks,
                    continueWith: {
                      typeName: "test",
                      input: null,
                      blockers: [{ id: crypto.randomUUID(), typeName: "test" }],
                    },
                  } as never),
                ).rejects.toThrow(ChainNotFoundError);
                try {
                  await transactionHooks.withSavepoint(async (transactionHooks) =>
                    withSavepoint(txCtx, async (txCtx) => {
                      await complete({ ...txCtx, transactionHooks, output: { from: "savepoint" } });
                      throw new Error("rollback to savepoint");
                    }),
                  );
                } catch {}
                return complete({ ...txCtx, transactionHooks, output: { from: "transaction" } });
              }),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ from: "transaction" });
    });

    expect(spyStateAdapter.calls.map((call) => call.name)).not.toContain("rescheduleJobs");
    const completedLogs = log.mock.calls
      .map((call) => call[0])
      .filter((entry) => entry.type === "job_completed");
    expect(completedLogs).toHaveLength(1);
    expect(completedLogs[0].data).toEqual(
      expect.objectContaining({ output: { from: "transaction" } }),
    );
  });

  it("keeps the attempt alive when an extension lands after its own committed `complete` call", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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
    let aborted: boolean | undefined;
    const worker = await createInProcessWorker({
      client,
      lease: { durationMs: 1000, heartbeatMs: 20 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ signal, complete }) => {
              const result = await withTransaction(async (txCtx, transactionHooks) => {
                const finished = await complete({ ...txCtx, transactionHooks, output: null });
                await sleep(60);
                return finished;
              });
              await sleep(100);
              aborted = signal.aborted;
              return result;
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
      await expect.poll(() => aborted, { timeout: 5000 }).toBe(false);
      await sleep(200);
    });

    expect(aborted).toBe(false);
    expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ type: "job_attempt_lost" }));
  });

  it("fails complete and aborts the signal after a workerless takeover", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { by: string } };
    }>();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const started = Promise.withResolvers<void>();
    const takenOver = Promise.withResolvers<void>();
    const handlerAsserted = Promise.withResolvers<void>();
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ signal, complete }) => {
              started.resolve();
              await takenOver.promise;
              await expect(
                withTransaction(async (txCtx, transactionHooks) =>
                  complete({ ...txCtx, transactionHooks, output: { by: "worker" } }),
                ),
              ).rejects.toThrow(JobAlreadyCompletedError);
              expect(signal.aborted).toBe(true);
              handlerAsserted.resolve();
              throw new Error("attempt lost");
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await started.promise;
      await withTransaction(async (txCtx, transactionHooks) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) =>
            completeJob(job, async ({ complete }) => complete({ output: { by: "workerless" } })),
        }),
      );
      takenOver.resolve();
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ by: "workerless" });
      await handlerAsserted.promise;
    });
  });

  it("aborts the signal when the attempt is lost after its `complete` call rolled back", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { by: string } };
    }>();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const rolledBack = Promise.withResolvers<AbortSignal>();
    const worker = await createInProcessWorker({
      client,
      lease: { durationMs: 1000, heartbeatMs: 20 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ signal, complete }) => {
              await expect(
                withTransaction(async (txCtx, transactionHooks) => {
                  await complete({ ...txCtx, transactionHooks, output: { by: "worker" } });
                  throw new Error("rollback");
                }),
              ).rejects.toThrow("rollback");
              rolledBack.resolve(signal);
              await sleep(completionOptions.timeoutMs, { signal });
              throw new Error("attempt lost");
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      const signal = await rolledBack.promise;
      await withTransaction(async (txCtx, transactionHooks) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) =>
            completeJob(job, async ({ complete }) => complete({ output: { by: "workerless" } })),
        }),
      );
      await expect.poll(() => signal.aborted, { timeout: 5000 }).toBe(true);
    });
  });

  it("reschedules a failed attempt when disposing its attempt-lost listener fails", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    skip,
  }) => {
    if (!notifyAdapter) return skip();

    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const client = await createClient({
      stateAdapter,
      notifyAdapter: {
        ...notifyAdapter,
        listenJobAttemptLost: async (jobId, onNotification) => {
          const dispose = await notifyAdapter.listenJobAttemptLost(jobId, onNotification);
          return async () => {
            await dispose();
            throw new Error("dispose failed");
          };
        },
      },
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt === 1) throw new Error("first attempt fails");
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
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
};
