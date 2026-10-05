import { type TestAPI, expectTypeOf } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const processTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("throws error when finish is called incorrectly", async ({
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

    let finishAfterHandler: (() => Promise<unknown>) | undefined;
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ finish }) => {
              const result = await withTransaction(async (txCtx, transactionHooks) => {
                await expect(
                  finish({
                    ...txCtx,
                    transactionHooks,
                    output: null,
                    ...({ reschedule: { afterMs: 1 } } as object),
                  }),
                ).rejects.toThrow(
                  "finish requires exactly one of output, continueWith or reschedule",
                );
                await expect(
                  // @ts-expect-error transactionHooks is required
                  finish({ ...txCtx, output: null }),
                ).rejects.toThrow("finish requires transactionHooks");
                await expect(
                  // @ts-expect-error the caller's transaction context is required
                  finish({ transactionHooks, output: null }),
                ).rejects.toThrow(
                  "finish requires a transaction context from the caller's transaction",
                );

                return finish({ ...txCtx, transactionHooks, output: null });
              });
              finishAfterHandler = async () =>
                withTransaction(async (txCtx, transactionHooks) =>
                  finish({ ...txCtx, transactionHooks, output: null }),
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

    await expect(finishAfterHandler!()).rejects.toThrow(
      "finish cannot be called after the attempt handler has ended",
    );
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
            attemptHandler: async ({ job, finish }) => {
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
            attemptHandler: async ({ job, finish }) => {
              if (job.attempt < 2) {
                throw new Error("Simulated failure");
              }
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
            attemptHandler: async ({ job, finish }) => {
              if (job.lastAttemptError) {
                errors.push(job.lastAttemptError);
              }

              if (job.attempt < 4) {
                throw new Error("Unexpected error");
              }

              return withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: null }),
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
            attemptHandler: async ({ job, finish }) => {
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

                const completedJob = await finish({
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

  it("finish should be visible to reads later in the same transaction", async ({
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
            attemptHandler: async ({ job, finish }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                const completedJob = await finish({
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
            attemptHandler: async ({ job, finish }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                const completedJob = await finish({
                  ...txCtx,
                  transactionHooks,
                  continueWith: { typeName: "tail", input: null },
                });
                expect((await client.getJob({ ...txCtx, id: job.id }))?.status).toBe("completed");
                return completedJob;
              }),
          },
          tail: {
            attemptHandler: async ({ finish }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: { done: true } }),
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
};
