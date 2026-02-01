import { type TestAPI, expectTypeOf, vi } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createQueuertClient, createQueuertInProcessWorker, defineJobTypes } from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const processTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("executes long-running jobs", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectLogs,
    expectMetrics,
    expectHistograms,
    expect,
  }) => {
    const registry = defineJobTypes<{
      test: {
        entry: true;
        input: { test: boolean };
        output: { result: boolean };
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createQueuertInProcessWorker({
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

    const workerArgs = { workerId: "worker" };
    const jobChainArgs = {
      typeName: "test",
      id: jobChain.id,
      rootChainId: jobChain.id,
      originId: null,
    };
    const jobArgs = {
      typeName: "test",
      id: jobChain.id,
      rootChainId: jobChain.id,
      originId: null,
      chainId: jobChain.id,
      chainTypeName: "test",
    };
    expectLogs([
      { type: "job_chain_created", data: { ...jobChainArgs, input: { test: true } } },
      { type: "job_created", data: { ...jobArgs, input: { test: true } } },
      { type: "worker_started", data: { ...workerArgs, jobTypeNames: ["test"] } },
      {
        type: "job_attempt_started",
        data: { ...jobArgs, status: "running", attempt: 1, ...workerArgs },
      },
      {
        type: "job_attempt_completed",
        data: {
          ...jobArgs,
          status: "running",
          attempt: 1,
          output: { result: true },
          ...workerArgs,
        },
      },
      {
        type: "job_completed",
        data: {
          ...jobArgs,
          status: "completed",
          attempt: 1,
          output: { result: true },
          ...workerArgs,
        },
      },
      {
        type: "job_chain_completed",
        data: { ...jobChainArgs, output: { result: true } },
      },
      { type: "worker_stopping", data: { ...workerArgs } },
      { type: "worker_stopped", data: { ...workerArgs } },
    ]);

    await expectMetrics([
      { method: "jobChainCreated", args: { typeName: "test" } },
      { method: "jobCreated", args: { typeName: "test" } },
      { method: "workerStarted", args: { workerId: "worker" } },
      { method: "jobAttemptStarted", args: { typeName: "test", status: "running" } },
      { method: "jobAttemptCompleted", args: { typeName: "test", output: { result: true } } },
      { method: "jobCompleted", args: { typeName: "test", output: { result: true } } },
      { method: "jobChainCompleted", args: { typeName: "test", output: { result: true } } },
      { method: "workerStopping", args: { workerId: "worker" } },
      { method: "workerStopped", args: { workerId: "worker" } },
    ]);

    await expectHistograms([
      { method: "jobDuration", args: { typeName: "test" } },
      { method: "jobChainDuration", args: { typeName: "test" } },
      { method: "jobAttemptDuration", args: { typeName: "test", workerId: "worker" } },
    ]);
  });

  it("supports all job execution modes", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
      "atomic-complete": {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      "staged-complete": {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      "staged-with-callback": {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      "staged-without-callback": {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      "atomic-with-callback": {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      "atomic-without-callback": {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        "atomic-complete": {
          attemptHandler: async ({ job, complete }) => {
            return complete(async () => ({ result: job.input.value * 2 }));
          },
        },
        "staged-complete": {
          attemptHandler: async ({ job, complete }) => {
            await sleep(1);
            return complete(async () => ({ result: job.input.value * 3 }));
          },
        },
        "staged-with-callback": {
          attemptHandler: async ({ job, prepare, complete }) => {
            const multiplier = await prepare({ mode: "staged" }, () => 4);
            return complete(async () => ({ result: job.input.value * multiplier }));
          },
        },
        "staged-without-callback": {
          attemptHandler: async ({ job, prepare, complete }) => {
            await prepare({ mode: "staged" });
            return complete(async () => ({ result: job.input.value * 5 }));
          },
        },
        "atomic-with-callback": {
          attemptHandler: async ({ job, prepare, complete }) => {
            const multiplier = await prepare({ mode: "atomic" }, () => 6);
            return complete(async () => ({ result: job.input.value * multiplier }));
          },
        },
        "atomic-without-callback": {
          attemptHandler: async ({ job, prepare, complete }) => {
            await prepare({ mode: "atomic" });
            return complete(async () => ({ result: job.input.value * 7 }));
          },
        },
      },
    });

    const [
      atomicCompleteJob,
      stagedCompleteJob,
      stagedCallbackJob,
      stagedNoCallbackJob,
      atomicCallbackJob,
      atomicNoCallbackJob,
    ] = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        Promise.all([
          client.startJobChain({
            ...txContext,
            typeName: "atomic-complete",
            input: { value: 10 },
          }),
          client.startJobChain({
            ...txContext,
            typeName: "staged-complete",
            input: { value: 10 },
          }),
          client.startJobChain({
            ...txContext,
            typeName: "staged-with-callback",
            input: { value: 10 },
          }),
          client.startJobChain({
            ...txContext,
            typeName: "staged-without-callback",
            input: { value: 10 },
          }),
          client.startJobChain({
            ...txContext,
            typeName: "atomic-with-callback",
            input: { value: 10 },
          }),
          client.startJobChain({
            ...txContext,
            typeName: "atomic-without-callback",
            input: { value: 10 },
          }),
        ]),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const [
        completedAtomicComplete,
        completedStagedComplete,
        completedStagedCallback,
        completedStagedNoCallback,
        completedAtomicCallback,
        completedAtomicNoCallback,
      ] = await Promise.all([
        client.waitForJobChainCompletion(atomicCompleteJob, completionOptions),
        client.waitForJobChainCompletion(stagedCompleteJob, completionOptions),
        client.waitForJobChainCompletion(stagedCallbackJob, completionOptions),
        client.waitForJobChainCompletion(stagedNoCallbackJob, completionOptions),
        client.waitForJobChainCompletion(atomicCallbackJob, completionOptions),
        client.waitForJobChainCompletion(atomicNoCallbackJob, completionOptions),
      ]);

      expect(completedAtomicComplete.output).toEqual({ result: 20 });
      expect(completedStagedComplete.output).toEqual({ result: 30 });
      expect(completedStagedCallback.output).toEqual({ result: 40 });
      expect(completedStagedNoCallback.output).toEqual({ result: 50 });
      expect(completedAtomicCallback.output).toEqual({ result: 60 });
      expect(completedAtomicNoCallback.output).toEqual({ result: 70 });
    });
  });

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

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createQueuertInProcessWorker({
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

  it("allows to extend job lease after lease expiration if wasn't grabbed by another worker", async ({
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

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processDefaults: {
        leaseConfig: { leaseMs: 10, renewIntervalMs: 100 },
      },
      processors: {
        test: {
          attemptHandler: async ({ complete }) => {
            await sleep(100);

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

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: expect.stringContaining("expired"),
      }),
    );
  });

  it("executes a job only once", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const processFn = vi.fn(async ({ complete }) => {
      return complete(() => ({ success: true }));
    });

    const registry = defineJobTypes<{
      test: {
        entry: true;
        input: { test: boolean };
        output: { success: boolean };
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    const createWorker = async () =>
      createQueuertInProcessWorker({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
        concurrency: 1,
        processors: {
          test: {
            attemptHandler: processFn,
          },
        },
      });

    const job = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { test: true },
        }),
      ),
    );

    const [worker1, worker2] = await Promise.all([createWorker(), createWorker()]);

    await withWorkers(await Promise.all([worker1.start(), worker2.start()]), async () => {
      await client.waitForJobChainCompletion(job, completionOptions);
    });

    expect(processFn).toHaveBeenCalledTimes(1);
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

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createQueuertInProcessWorker({
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
    expectLogs,
    expectMetrics,
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

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createQueuertInProcessWorker({
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
    expectLogs([
      { type: "job_chain_created" },
      { type: "job_created" },
      { type: "worker_started" },
      { type: "job_attempt_started" },
      {
        type: "job_attempt_failed",
        data: { rescheduledAfterMs: 10 },
        error: expect.anything(),
      },
      { type: "job_attempt_started" },
      {
        type: "job_attempt_failed",
        data: { rescheduledAfterMs: 20 },
        error: expect.anything(),
      },
      { type: "job_attempt_started" },
      {
        type: "job_attempt_failed",
        data: { rescheduledAfterMs: 40 },
        error: expect.anything(),
      },
      { type: "job_attempt_started" },
      { type: "job_attempt_completed" },
      { type: "job_completed" },
      { type: "job_chain_completed" },
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);

    await expectMetrics([
      { method: "jobChainCreated" },
      { method: "jobCreated" },
      { method: "workerStarted" },
      { method: "jobAttemptStarted" },
      { method: "jobAttemptFailed", args: { rescheduledAfterMs: 10 } },
      { method: "jobAttemptStarted" },
      { method: "jobAttemptFailed", args: { rescheduledAfterMs: 20 } },
      { method: "jobAttemptStarted" },
      { method: "jobAttemptFailed", args: { rescheduledAfterMs: 40 } },
      { method: "jobAttemptStarted" },
      { method: "jobAttemptCompleted" },
      { method: "jobCompleted" },
      { method: "jobChainCompleted" },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);
  });

  it("handles errors in all phases", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
    expectGauges,
  }) => {
    type ErrorPhase = "prepare" | "process" | "complete";

    const registry = defineJobTypes<{
      test: {
        entry: true;
        input: { phase: ErrorPhase };
        output: null;
      };
    }>();

    const errors: { phase: ErrorPhase; error: string }[] = [];

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createQueuertInProcessWorker({
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
            if (job.lastAttemptError) {
              errors.push({
                phase: job.input.phase,
                error: job.lastAttemptError,
              });
            }

            await prepare({ mode: "staged" }, () => {
              if (job.input.phase === "prepare" && job.attempt === 1) {
                throw new Error("Simulated failure in prepare");
              }
            });

            if (job.input.phase === "process" && job.attempt === 1) {
              throw new Error("Simulated failure in process");
            }

            return complete(async () => {
              if (job.input.phase === "complete" && job.attempt === 1) {
                throw new Error("Simulated failure in complete");
              }

              return null;
            });
          },
        },
      },
    });

    const jobChains = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        Promise.all(
          (["prepare", "process", "complete"] as ErrorPhase[]).map(async (phase) =>
            client.startJobChain({
              ...txContext,
              typeName: "test",
              input: { phase },
            }),
          ),
        ),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await Promise.all(
        jobChains.map(async (job) => client.waitForJobChainCompletion(job, completionOptions)),
      );
    });

    expect(errors).toHaveLength(3);
    expect(errors.find((e) => e.phase === "prepare")?.error).toBe(
      "Error: Simulated failure in prepare",
    );
    expect(errors.find((e) => e.phase === "process")?.error).toBe(
      "Error: Simulated failure in process",
    );
    expect(errors.find((e) => e.phase === "complete")?.error).toBe(
      "Error: Simulated failure in complete",
    );

    // Verify gauges balance even with errors:
    // 3 jobs × 2 attempts each = 6 processing cycles
    // Each cycle: -1 idle (start), +1 idle (end), +1 processing (start), -1 processing (end)
    // Plus: +1 idle (worker start), -1 idle (worker stop)
    // Net idle: +1 - 6 + 6 - 1 = 0, Net processing: +6 - 6 = 0
    await expectGauges({
      jobTypeIdleChange: [
        // worker start
        { delta: 1, typeName: "test" },
        // 6 processing cycles (3 jobs × 2 attempts each)
        { delta: -1, typeName: "test" },
        { delta: 1, typeName: "test" },
        { delta: -1, typeName: "test" },
        { delta: 1, typeName: "test" },
        { delta: -1, typeName: "test" },
        { delta: 1, typeName: "test" },
        { delta: -1, typeName: "test" },
        { delta: 1, typeName: "test" },
        { delta: -1, typeName: "test" },
        { delta: 1, typeName: "test" },
        { delta: -1, typeName: "test" },
        { delta: 1, typeName: "test" },
        // worker stop
        { delta: -1, typeName: "test" },
      ],
      jobTypeProcessingChange: [
        // 6 processing cycles
        { delta: 1, typeName: "test" },
        { delta: -1, typeName: "test" },
        { delta: 1, typeName: "test" },
        { delta: -1, typeName: "test" },
        { delta: 1, typeName: "test" },
        { delta: -1, typeName: "test" },
        { delta: 1, typeName: "test" },
        { delta: -1, typeName: "test" },
        { delta: 1, typeName: "test" },
        { delta: -1, typeName: "test" },
        { delta: 1, typeName: "test" },
        { delta: -1, typeName: "test" },
      ],
    });
  });

  it("reschedules job when error thrown after complete callback finishes", async ({
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
        output: { result: string };
      };
    }>();

    let attempts = 0;

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        test: {
          retryConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
          attemptHandler: async ({ job, complete }) => {
            attempts++;
            const result = await complete(async () => ({ result: "completed" }));
            if (job.attempt === 1) {
              throw new Error("Error after complete");
            }
            return result;
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

    expect(attempts).toBe(2);
  });
};
