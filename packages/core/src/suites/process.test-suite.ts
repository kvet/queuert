import { type TestAPI, expectTypeOf } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { sleep } from "../helpers/sleep.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const processTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("throws error when prepare, complete, or finish are called incorrectly", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      "test-prepare-twice": {
        entry: true;
        input: null;
        output: null;
      };
      "test-complete-twice": {
        entry: true;
        input: null;
        output: null;
      };
      "test-prepare-after-auto-setup": {
        entry: true;
        input: null;
        output: null;
      };
      "test-continueWith-twice": {
        entry: true;
        input: null;
        output: null;
        continueWith: { typeName: "test-next" };
      };
      "test-continue-after-complete": {
        entry: true;
        input: null;
        output: null;
        continueWith: { typeName: "test-next" };
      };
      "test-finish-concurrently": {
        entry: true;
        input: null;
        output: null;
        continueWith: { typeName: "test-next" };
      };
      "test-next": {
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
          "test-prepare-twice": {
            attemptHandler: async ({ prepare, complete }) => {
              await prepare({ mode: "atomic" });
              await expect(prepare({ mode: "atomic" })).rejects.toThrow(
                "prepare can only be called once",
              );
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
          "test-complete-twice": {
            attemptHandler: async ({ complete }) => {
              const result = complete(async ({ finish }) => finish({ output: null }));
              await expect(
                complete(async ({ finish }) => finish({ output: null })),
              ).rejects.toThrow("complete can only be called once");
              return result;
            },
          },
          "test-prepare-after-auto-setup": {
            attemptHandler: async (options) => {
              // Don't access prepare synchronously - auto-setup will run
              // Use 50ms to ensure auto-setup completes before we continue
              await sleep(50);
              // Now try to access prepare after auto-setup
              expect(() => options.prepare).toThrow("prepare cannot be accessed after auto-setup");
              return options.complete(async ({ finish }) => finish({ output: null }));
            },
          },
          "test-continueWith-twice": {
            attemptHandler: async ({ complete }) => {
              return complete(async ({ finish }) => {
                const completedJob = await finish({
                  continueWith: {
                    typeName: "test-next",
                    input: { value: 1 },
                  },
                });
                await expect(
                  finish({
                    continueWith: {
                      typeName: "test-next",
                      input: { value: 2 },
                    },
                  }),
                ).rejects.toThrow("finish can only be called once");
                await expect(finish({ output: null })).rejects.toThrow(
                  "finish can only be called once",
                );
                return completedJob;
              });
            },
          },
          "test-continue-after-complete": {
            attemptHandler: async ({ complete }) => {
              return complete(async ({ finish }) => {
                const completedJob = await finish({ output: null });
                await expect(
                  finish({ continueWith: { typeName: "test-next", input: { value: 1 } } }),
                ).rejects.toThrow("finish can only be called once");
                return completedJob;
              });
            },
          },
          "test-finish-concurrently": {
            attemptHandler: async ({ complete }) => {
              return complete(async ({ finish }) => {
                const first = finish({
                  continueWith: { typeName: "test-next", input: { value: 10 } },
                });
                const second = finish({
                  continueWith: { typeName: "test-next", input: { value: 20 } },
                });
                await expect(second).rejects.toThrow("finish can only be called once");
                return first;
              });
            },
          },
          "test-next": {
            attemptHandler: async ({ job, complete }) => {
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value } }),
              );
            },
          },
        },
      }),
    });

    const [
      prepareChain,
      completeChain,
      prepareAfterAutoSetupChain,
      continueWithChain,
      continueAfterCompleteChain,
      finishConcurrentlyChain,
    ] = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "test-prepare-twice", input: null },
          { typeName: "test-complete-twice", input: null },
          { typeName: "test-prepare-after-auto-setup", input: null },
          { typeName: "test-continueWith-twice", input: null },
          { typeName: "test-continue-after-complete", input: null },
          { typeName: "test-finish-concurrently", input: null },
        ],
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await Promise.all([
        client.awaitChain(prepareChain, completionOptions),
        client.awaitChain(completeChain, completionOptions),
        client.awaitChain(prepareAfterAutoSetupChain, completionOptions),
        client.awaitChain(continueWithChain, completionOptions),
        client.awaitChain(continueAfterCompleteChain, completionOptions),
        client.awaitChain(finishConcurrentlyChain, completionOptions),
      ]);
    });
  });

  it("provides attempt information to job process", async ({
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

              return complete(async ({ finish }) => finish({ output: null }));
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
              return complete(async ({ finish }) => finish({ output: null }));
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
    expect,
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

              return complete(async ({ finish }) => finish({ output: null }));
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
    expect,
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
            attemptHandler: async ({ job, prepare, complete }) => {
              expectTypeOf(job.typeName).toEqualTypeOf<"test">();
              expectTypeOf(job.input).toEqualTypeOf<{ test: boolean }>();
              expectTypeOf(job.status).toEqualTypeOf<"running">();
              expect(job.typeName).toBe("test");
              expect(job.input).toEqual({ test: true });
              expect(job.status).toBe("running");
              expect(job.id).toBeDefined();
              expect(job.chainId).toEqual(job.id);

              const result = await prepare({ mode: "staged" }, (txCtx) => {
                expectTypeOf(txCtx).toEqualTypeOf<{ $test: true }>();
                expect(txCtx).toBeDefined();

                return "prepare";
              });
              expect(result).toEqual("prepare");

              return complete(async ({ finish, transactionHooks, ...txCtx }) => {
                expectTypeOf(txCtx).toEqualTypeOf<{ $test: true }>();
                expect(txCtx).toBeDefined();
                expect(transactionHooks).toBeDefined();

                const completedJob = await finish({ output: { result: true } });
                expectTypeOf(completedJob.typeName).toEqualTypeOf<"test">();
                expectTypeOf(completedJob.status).toEqualTypeOf<"completed">();
                expect(completedJob.typeName).toBe("test");
                expect(completedJob.status).toBe("completed");
                if (completedJob.status === "completed") {
                  expectTypeOf(completedJob.completedBy).toEqualTypeOf<string | null>();
                  expect(completedJob.completedBy).toMatch(/^worker-[0-9a-f-]{36}$/);
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
      expect(completedJob.completedBy).toMatch(/^worker-[0-9a-f-]{36}$/);
    }
  });

  it("finish should be visible to reads later in the same callback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
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
              complete(async ({ finish, ...txCtx }) => {
                const completedJob = await finish({ output: { done: true } });
                expect((await client.getJob({ ...txCtx, id: job.id }))?.status).toBe("completed");
                expect((await client.getChain({ ...txCtx, id: job.chainId }))?.status).toBe(
                  "completed",
                );
                return completedJob;
              }),
          },
          "continue-then-read": {
            attemptHandler: async ({ job, complete }) =>
              complete(async ({ finish, ...txCtx }) => {
                const completedJob = await finish({
                  continueWith: { typeName: "tail", input: null },
                });
                expect((await client.getJob({ ...txCtx, id: job.id }))?.status).toBe("completed");
                return completedJob;
              }),
          },
          tail: {
            attemptHandler: async ({ complete }) =>
              complete(async ({ finish }) => finish({ output: { done: true } })),
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
};
