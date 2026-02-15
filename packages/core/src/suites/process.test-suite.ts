import { type TestAPI, expectTypeOf } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createClient, createInProcessWorker, defineJobTypes } from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const processTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("throws error when prepare, complete, or continueWith called incorrectly", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
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
    });

    const [prepareJobChain, completeJobChain, prepareAfterAutoSetupJobChain, continueWithJobChain] =
      await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          Promise.all([
            client.startJobChain({
              ...txContext,
              typeName: "test-prepare-twice",
              input: null,
            }),
            client.startJobChain({
              ...txContext,
              typeName: "test-complete-twice",
              input: null,
            }),
            client.startJobChain({
              ...txContext,
              typeName: "test-prepare-after-auto-setup",
              input: null,
            }),
            client.startJobChain({
              ...txContext,
              typeName: "test-continueWith-twice",
              input: null,
            }),
          ]),
        ),
      );

    await withWorkers([await worker.start()], async () => {
      await Promise.all([
        client.waitForJobChainCompletion(prepareJobChain, completionOptions),
        client.waitForJobChainCompletion(completeJobChain, completionOptions),
        client.waitForJobChainCompletion(prepareAfterAutoSetupJobChain, completionOptions),
        client.waitForJobChainCompletion(continueWithJobChain, completionOptions),
      ]);
    });
  });

  it("provides attempt information to job process", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processDefaults: {
        retryConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
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
              expect(job.lastAttemptError).toBe("Error: Simulated failure");
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
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: null,
        }),
      ),
    );
    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);
    });

    expect(attempts).toEqual([1, 2, 3]);
  });

  it("uses exponential backoff progression for repeated failures", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processDefaults: {
        retryConfig: {
          initialDelayMs: 10,
          multiplier: 2.0,
          maxDelayMs: 100,
        },
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
    });

    const job = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(job, completionOptions);
    });

    expect(errors).toHaveLength(3);
    expect(errors[0]).toBe("Error: Unexpected error");
    expect(errors[1]).toBe("Error: Unexpected error");
    expect(errors[2]).toBe("Error: Unexpected error");
  });

  it("executes jobs", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      workerId: "worker",
      concurrency: 1,
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
            expect(job.originId).toBeNull();
            expect(job.rootChainId).toEqual(job.id);

            const result = await prepare({ mode: "staged" }, (txContext) => {
              expectTypeOf(txContext).toEqualTypeOf<{ $test: true }>();
              expect(txContext).toBeDefined();

              return "prepare";
            });
            expect(result).toEqual("prepare");

            const completedJob = await complete(async ({ continueWith: _, ...txContext }) => {
              expectTypeOf(txContext).toEqualTypeOf<{ $test: true }>();
              expect(txContext).toBeDefined();

              return { result: true };
            });
            expectTypeOf(completedJob.typeName).toEqualTypeOf<"test">();
            expectTypeOf(completedJob.status).toEqualTypeOf<"completed">();
            expect(completedJob.typeName).toBe("test");
            expect(completedJob.status).toBe("completed");
            if (completedJob.status === "completed") {
              expectTypeOf(completedJob.completedBy).toEqualTypeOf<string | null>();
              expect(completedJob.completedBy).toBe("worker");
            }
            return completedJob;
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { test: true },
        }),
      ),
    );
    // expectTypeOf<(typeof jobChain)["status"]>().toEqualTypeOf<"pending" | "blocked">();
    expectTypeOf<(typeof jobChain)["input"]>().toEqualTypeOf<{ test: boolean }>();
    expectTypeOf<(typeof jobChain)["typeName"]>().toEqualTypeOf<"test">();
    expect(jobChain.input).toEqual({ test: true });

    await withWorkers([await worker.start()], async () => {
      const completedJobChain = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expectTypeOf<(typeof completedJobChain)["status"]>().toEqualTypeOf<"completed">();
      expectTypeOf<(typeof completedJobChain)["output"]>().toEqualTypeOf<{
        result: boolean;
      }>();
      expect(completedJobChain.status).toBe("completed");
      expect(completedJobChain.output).toEqual({ result: true });
    });

    // Verify completedBy is set to workerId for worker completion
    const completedJob = await stateAdapter.getJobById({ jobId: jobChain.id });
    expect(completedJob?.status).toBe("completed");
    expect(completedJob?.completedBy).toBe("worker");
  });
};
