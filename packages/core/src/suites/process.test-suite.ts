import { type TestAPI, expectTypeOf } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { deriveJobStatus } from "../entities/job.js";
import { sleep } from "../helpers/sleep.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const processTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("throws error when prepare, complete, or continueWith called incorrectly", async ({
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
                "Prepare can only be called once",
              );
              return complete(async () => null);
            },
          },
          "test-complete-twice": {
            attemptHandler: async ({ prepare, complete }) => {
              await prepare({ mode: "atomic" });
              const result = complete(async () => null);
              await expect(complete(async () => null)).rejects.toThrow(
                "Complete can only be called once",
              );
              return result;
            },
          },
          "test-prepare-after-auto-setup": {
            attemptHandler: async (options) => {
              // Don't access prepare synchronously - auto-setup will run
              // Use 50ms to ensure auto-setup completes before we continue
              await sleep(50);
              // Now try to access prepare after auto-setup
              expect(() => options.prepare).toThrow("Prepare cannot be accessed after auto-setup");
              return options.complete(async () => null);
            },
          },
          "test-continueWith-twice": {
            attemptHandler: async ({ prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async ({ continueWith }) => {
                const continuation1 = await continueWith({
                  typeName: "test-next",
                  input: { value: 1 },
                });
                await expect(
                  continueWith({
                    typeName: "test-next",
                    input: { value: 2 },
                  }),
                ).rejects.toThrow("continueWith can only be called once");
                return continuation1;
              });
            },
          },
          "test-next": {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async () => ({ result: job.input.value }));
            },
          },
        },
      }),
    });

    const [prepareChain, completeChain, prepareAfterAutoSetupChain, continueWithChain] =
      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.startChains({
            ...txCtx,
            transactionHooks,
            items: [
              { typeName: "test-prepare-twice", input: null },
              { typeName: "test-complete-twice", input: null },
              { typeName: "test-prepare-after-auto-setup", input: null },
              { typeName: "test-continueWith-twice", input: null },
            ],
          }),
        ),
      );

    await withWorkers([await worker.start()], async () => {
      await Promise.all([
        client.awaitChain(prepareChain, completionOptions),
        client.awaitChain(completeChain, completionOptions),
        client.awaitChain(prepareAfterAutoSetupChain, completionOptions),
        client.awaitChain(continueWithChain, completionOptions),
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
            attemptHandler: async ({ job, prepare, complete }) => {
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

              await prepare({ mode: "atomic" });

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
            attemptHandler: async ({ job, prepare, complete }) => {
              if (job.attempt < 2) {
                throw new Error("Simulated failure");
              }
              await prepare({ mode: "atomic" });
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
      await client.awaitChain(chain, completionOptions);
    });

    const completedJob = await stateAdapter.getJob({ jobId: chain.id });
    expect(deriveJobStatus(completedJob!)).toBe("completed");
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

              return complete(async () => null);
            },
          },
        },
      }),
    });

    const job = await withTransactionHooks(async (transactionHooks) =>
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

              const completedJob = await complete(
                async ({ continueWith: _, transactionHooks, ...txCtx }) => {
                  expectTypeOf(txCtx).toEqualTypeOf<{ $test: true }>();
                  expect(txCtx).toBeDefined();
                  expect(transactionHooks).toBeDefined();

                  return { result: true };
                },
              );
              expectTypeOf(completedJob.typeName).toEqualTypeOf<"test">();
              expectTypeOf(completedJob.status).toEqualTypeOf<"completed">();
              expect(completedJob.typeName).toBe("test");
              expect(completedJob.status).toBe("completed");
              if (completedJob.status === "completed") {
                expectTypeOf(completedJob.completedBy).toEqualTypeOf<string | null>();
                expect(completedJob.completedBy).toMatch(/^worker-[0-9a-f-]{36}$/);
              }
              return completedJob;
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
          input: { test: true },
        }),
      ),
    );
    // expectTypeOf<(typeof chain)["status"]>().toEqualTypeOf<"pending" | "blocked">();
    expectTypeOf<(typeof chain)["input"]>().toEqualTypeOf<{ test: boolean }>();
    expectTypeOf<(typeof chain)["typeName"]>().toEqualTypeOf<"test">();
    expect(chain.input).toEqual({ test: true });

    await withWorkers([await worker.start()], async () => {
      const completedChain = await client.awaitChain(chain, completionOptions);
      expectTypeOf<(typeof completedChain)["status"]>().toEqualTypeOf<"closed">();
      expectTypeOf<(typeof completedChain)["output"]>().toEqualTypeOf<{
        result: boolean;
      }>();
      expect(completedChain.status).toBe("closed");
      expect(completedChain.output).toEqual({ result: true });
    });

    // Verify completedBy is set to workerId for worker completion
    const completedJob = await stateAdapter.getJob({ jobId: chain.id });
    expect(deriveJobStatus(completedJob!)).toBe("completed");
    expect(completedJob?.completedBy).toMatch(/^worker-[0-9a-f-]{36}$/);
  });
};
