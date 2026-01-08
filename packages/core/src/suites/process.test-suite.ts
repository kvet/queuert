import { expectTypeOf, TestAPI, vi } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createQueuert, defineUnionJobTypes } from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

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
    log,
    expectLogs,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { test: boolean };
          output: { result: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
      process: async ({ job, prepare, complete }) => {
        expectTypeOf(job.typeName).toEqualTypeOf<"test">();
        expectTypeOf(job.input).toEqualTypeOf<{ test: boolean }>();
        expectTypeOf(job.status).toEqualTypeOf<"running">();
        expect(job.typeName).toBe("test");
        expect(job.input).toEqual({ test: true });
        expect(job.status).toBe("running");
        expect(job.id).toBeDefined();
        expect(job.sequenceId).toEqual(job.id);
        expect(job.originId).toBeNull();
        expect(job.rootSequenceId).toEqual(job.id);

        const result = await prepare({ mode: "staged" }, (context) => {
          expectTypeOf(context).toEqualTypeOf<{ $test: true }>();
          expect(context).toBeDefined();

          return "prepare";
        });
        expect(result).toEqual("prepare");

        const completedJob = await complete(async ({ continueWith: _, ...context }) => {
          expectTypeOf(context).toEqualTypeOf<{ $test: true }>();
          expect(context).toBeDefined();

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
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { test: true },
        }),
      ),
    );
    // expectTypeOf<(typeof jobSequence)["status"]>().toEqualTypeOf<"pending" | "blocked">();
    expectTypeOf<(typeof jobSequence)["input"]>().toEqualTypeOf<{ test: boolean }>();
    expectTypeOf<(typeof jobSequence)["typeName"]>().toEqualTypeOf<"test">();
    expect(jobSequence.input).toEqual({ test: true });

    await withWorkers([await worker.start({ workerId: "worker" })], async () => {
      const completedJobSequence = await queuert.waitForJobSequenceCompletion(
        jobSequence,
        completionOptions,
      );
      expectTypeOf<(typeof completedJobSequence)["status"]>().toEqualTypeOf<"completed">();
      expectTypeOf<(typeof completedJobSequence)["output"]>().toEqualTypeOf<{
        result: boolean;
      }>();
      expect(completedJobSequence.status).toBe("completed");
      expect(completedJobSequence.output).toEqual({ result: true });
    });

    // Verify completedBy is set to workerId for worker completion
    const completedJob = await stateAdapter.provideContext(async (context) =>
      stateAdapter.getJobById({ context, jobId: jobSequence.id }),
    );
    expect(completedJob?.status).toBe("completed");
    expect(completedJob?.completedBy).toBe("worker");

    const workerArgs = { workerId: "worker" };
    const jobSequenceArgs = {
      typeName: "test",
      id: jobSequence.id,
      rootSequenceId: jobSequence.id,
      originId: null,
    };
    const jobArgs = {
      typeName: "test",
      id: jobSequence.id,
      rootSequenceId: jobSequence.id,
      originId: null,
      sequenceId: jobSequence.id,
    };
    expectLogs([
      { type: "job_sequence_created", args: [{ ...jobSequenceArgs, input: { test: true } }] },
      { type: "job_created", args: [{ ...jobArgs, input: { test: true } }] },
      { type: "worker_started", args: [{ ...workerArgs, jobTypeNames: ["test"] }] },
      {
        type: "job_attempt_started",
        args: [{ ...jobArgs, status: "running", attempt: 1, ...workerArgs }],
      },
      {
        type: "job_completed",
        args: [{ ...jobArgs, output: { result: true }, ...workerArgs }],
      },
      { type: "job_sequence_completed", args: [{ ...jobSequenceArgs, output: { result: true } }] },
      { type: "worker_stopping", args: [{ ...workerArgs }] },
      { type: "worker_stopped", args: [{ ...workerArgs }] },
    ]);
  });

  it("supports all job execution modes", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        "atomic-complete": {
          input: { value: number };
          output: { result: number };
        };
        "staged-complete": {
          input: { value: number };
          output: { result: number };
        };
        "staged-with-callback": {
          input: { value: number };
          output: { result: number };
        };
        "staged-without-callback": {
          input: { value: number };
          output: { result: number };
        };
        "atomic-with-callback": {
          input: { value: number };
          output: { result: number };
        };
        "atomic-without-callback": {
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "atomic-complete",
        process: async ({ job, complete }) => {
          return complete(async () => ({ result: job.input.value * 2 }));
        },
      })
      .implementJobType({
        typeName: "staged-complete",
        process: async ({ job, complete }) => {
          await sleep(1);
          return complete(async () => ({ result: job.input.value * 3 }));
        },
      })
      .implementJobType({
        typeName: "staged-with-callback",
        process: async ({ job, prepare, complete }) => {
          const multiplier = await prepare({ mode: "staged" }, () => 4);
          return complete(async () => ({ result: job.input.value * multiplier }));
        },
      })
      .implementJobType({
        typeName: "staged-without-callback",
        process: async ({ job, prepare, complete }) => {
          await prepare({ mode: "staged" });
          return complete(async () => ({ result: job.input.value * 5 }));
        },
      })
      .implementJobType({
        typeName: "atomic-with-callback",
        process: async ({ job, prepare, complete }) => {
          const multiplier = await prepare({ mode: "atomic" }, () => 6);
          return complete(async () => ({ result: job.input.value * multiplier }));
        },
      })
      .implementJobType({
        typeName: "atomic-without-callback",
        process: async ({ job, prepare, complete }) => {
          await prepare({ mode: "atomic" });
          return complete(async () => ({ result: job.input.value * 7 }));
        },
      });

    const [
      atomicCompleteJob,
      stagedCompleteJob,
      stagedCallbackJob,
      stagedNoCallbackJob,
      atomicCallbackJob,
      atomicNoCallbackJob,
    ] = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        Promise.all([
          queuert.startJobSequence({
            ...context,
            typeName: "atomic-complete",
            input: { value: 10 },
          }),
          queuert.startJobSequence({
            ...context,
            typeName: "staged-complete",
            input: { value: 10 },
          }),
          queuert.startJobSequence({
            ...context,
            typeName: "staged-with-callback",
            input: { value: 10 },
          }),
          queuert.startJobSequence({
            ...context,
            typeName: "staged-without-callback",
            input: { value: 10 },
          }),
          queuert.startJobSequence({
            ...context,
            typeName: "atomic-with-callback",
            input: { value: 10 },
          }),
          queuert.startJobSequence({
            ...context,
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
        queuert.waitForJobSequenceCompletion(atomicCompleteJob, completionOptions),
        queuert.waitForJobSequenceCompletion(stagedCompleteJob, completionOptions),
        queuert.waitForJobSequenceCompletion(stagedCallbackJob, completionOptions),
        queuert.waitForJobSequenceCompletion(stagedNoCallbackJob, completionOptions),
        queuert.waitForJobSequenceCompletion(atomicCallbackJob, completionOptions),
        queuert.waitForJobSequenceCompletion(atomicNoCallbackJob, completionOptions),
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
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        "test-prepare-twice": {
          input: null;
          output: null;
        };
        "test-complete-twice": {
          input: null;
          output: null;
        };
        "test-prepare-after-auto-setup": {
          input: null;
          output: null;
        };
        "test-continueWith-twice": {
          input: null;
          output: { value: number };
        };
        "test-next": {
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "test-prepare-twice",
        process: async ({ prepare, complete }) => {
          await prepare({ mode: "atomic" });
          await expect(prepare({ mode: "atomic" })).rejects.toThrow(
            "Prepare can only be called once",
          );
          return complete(async () => null);
        },
      })
      .implementJobType({
        typeName: "test-complete-twice",
        process: async ({ prepare, complete }) => {
          await prepare({ mode: "atomic" });
          const result = complete(async () => null);
          await expect(complete(async () => null)).rejects.toThrow(
            "Complete can only be called once",
          );
          return result;
        },
      })
      .implementJobType({
        typeName: "test-prepare-after-auto-setup",
        process: async (options) => {
          // Don't access prepare synchronously - auto-setup will run
          // Use 50ms to ensure auto-setup completes before we continue
          await sleep(50);
          // Now try to access prepare after auto-setup
          expect(() => options.prepare).toThrow("Prepare cannot be accessed after auto-setup");
          return options.complete(async () => null);
        },
      })
      .implementJobType({
        typeName: "test-continueWith-twice",
        process: async ({ prepare, complete }) => {
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
      })
      .implementJobType({
        typeName: "test-next",
        process: async ({ job, prepare, complete }) => {
          await prepare({ mode: "atomic" });
          return complete(async () => ({ result: job.input.value }));
        },
      });

    const [
      prepareJobSequence,
      completeJobSequence,
      prepareAfterAutoSetupJobSequence,
      continueWithJobSequence,
    ] = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        Promise.all([
          queuert.startJobSequence({
            ...context,
            typeName: "test-prepare-twice",
            input: null,
          }),
          queuert.startJobSequence({
            ...context,
            typeName: "test-complete-twice",
            input: null,
          }),
          queuert.startJobSequence({
            ...context,
            typeName: "test-prepare-after-auto-setup",
            input: null,
          }),
          queuert.startJobSequence({
            ...context,
            typeName: "test-continueWith-twice",
            input: null,
          }),
        ]),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await Promise.all([
        queuert.waitForJobSequenceCompletion(prepareJobSequence, completionOptions),
        queuert.waitForJobSequenceCompletion(completeJobSequence, completionOptions),
        queuert.waitForJobSequenceCompletion(prepareAfterAutoSetupJobSequence, completionOptions),
        queuert.waitForJobSequenceCompletion(continueWithJobSequence, completionOptions),
      ]);
    });
  });

  it("allows to extend job lease after lease expiration if wasn't grabbed by another worker", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: null;
          output: null;
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
      process: async ({ complete }) => {
        await sleep(100);

        return complete(async () => null);
      },
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers(
      [await worker.start({ defaultLeaseConfig: { leaseMs: 1, renewIntervalMs: 100 } })],
      async () => {
        await queuert.waitForJobSequenceCompletion(jobSequence, completionOptions);
      },
    );

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
    log,
    expect,
  }) => {
    const processFn = vi.fn(async ({ complete }) => {
      return complete(() => ({ success: true }));
    });

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { test: boolean };
          output: { success: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
      process: processFn,
    });

    const job = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { test: true },
        }),
      ),
    );

    await withWorkers(await Promise.all([worker.start(), worker.start()]), async () => {
      await queuert.waitForJobSequenceCompletion(job, completionOptions);
    });

    expect(processFn).toHaveBeenCalledTimes(1);
  });

  it("provides attempt information to job process", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: null;
          output: null;
        };
      }>(),
    });

    const attempts: number[] = [];

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
      process: async ({ job, prepare, complete }) => {
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
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: null,
        }),
      ),
    );
    await withWorkers(
      [
        await worker.start({
          defaultRetryConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
        }),
      ],
      async () => {
        await queuert.waitForJobSequenceCompletion(jobSequence, completionOptions);
      },
    );

    expect(attempts).toEqual([1, 2, 3]);
  });

  it("uses exponential backoff progression for repeated failures", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    log,
    expectLogs,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: null;
          output: null;
        };
      }>(),
    });

    const errors: string[] = [];

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
      process: async ({ job, complete }) => {
        if (job.lastAttemptError) {
          errors.push(job.lastAttemptError);
        }

        if (job.attempt < 4) {
          throw new Error("Unexpected error");
        }

        return complete(async () => null);
      },
    });

    const job = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers(
      [
        await worker.start({
          defaultRetryConfig: {
            initialDelayMs: 10,
            multiplier: 2.0,
            maxDelayMs: 100,
          },
        }),
      ],
      async () => {
        await queuert.waitForJobSequenceCompletion(job, completionOptions);
      },
    );

    expect(errors).toHaveLength(3);
    expect(errors[0]).toBe("Error: Unexpected error");
    expect(errors[1]).toBe("Error: Unexpected error");
    expect(errors[2]).toBe("Error: Unexpected error");
    expectLogs([
      { type: "job_sequence_created" },
      { type: "job_created" },
      { type: "worker_started" },
      { type: "job_attempt_started" },
      { type: "job_attempt_failed", args: [{ rescheduledAfterMs: 10 }, expect.anything()] },
      { type: "job_attempt_started" },
      { type: "job_attempt_failed", args: [{ rescheduledAfterMs: 20 }, expect.anything()] },
      { type: "job_attempt_started" },
      { type: "job_attempt_failed", args: [{ rescheduledAfterMs: 40 }, expect.anything()] },
      { type: "job_attempt_started" },
      { type: "job_completed" },
      { type: "job_sequence_completed" },
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);
  });

  it("handles errors in all phases", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    log,
    expect,
  }) => {
    type ErrorPhase = "prepare" | "process" | "complete";

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { phase: ErrorPhase };
          output: null;
        };
      }>(),
    });

    const errors: { phase: ErrorPhase; error: string }[] = [];

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
      process: async ({ job, prepare, complete }) => {
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
    });

    const jobSequences = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        Promise.all(
          (["prepare", "process", "complete"] as ErrorPhase[]).map(async (phase) =>
            queuert.startJobSequence({
              ...context,
              typeName: "test",
              input: { phase },
            }),
          ),
        ),
      ),
    );

    await withWorkers(
      [
        await worker.start({
          defaultRetryConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
        }),
      ],
      async () => {
        await Promise.all(
          jobSequences.map(async (job) =>
            queuert.waitForJobSequenceCompletion(job, completionOptions),
          ),
        );
      },
    );

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
  });

  it("reschedules job when error thrown after complete callback finishes", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: null;
          output: { result: string };
        };
      }>(),
    });

    let attempts = 0;

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
      retryConfig: {
        initialDelayMs: 1,
        multiplier: 1,
        maxDelayMs: 1,
      },
      process: async ({ job, complete }) => {
        attempts++;
        const result = await complete(async () => ({ result: "completed" }));
        if (job.attempt === 1) {
          throw new Error("Error after complete");
        }
        return result;
      },
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await queuert.waitForJobSequenceCompletion(jobSequence, completionOptions);
    });

    expect(attempts).toBe(2);
  });
};
