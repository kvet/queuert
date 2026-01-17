import { expectTypeOf, TestAPI } from "vitest";
import { CompletedJobSequence, createQueuert, defineJobTypes } from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

export const sequencesTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("handles sequenced jobs", async ({
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
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        linear: {
          entry: true;
          input: { value: number };
          continueWith: { typeName: "linear_next" };
        };
        linear_next: {
          input: { valueNext: number };
          continueWith: { typeName: "linear_next_next" };
        };
        linear_next_next: {
          input: { valueNextNext: number };
          output: { result: number };
        };
      }>(),
    });

    const originIds: string[] = [];

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "linear",
        process: async ({ job, complete }) => {
          expect(job.id).toEqual(jobSequence.id);
          expect(job.sequenceId).toEqual(jobSequence.id);
          expect(job.originId).toBeNull();
          expect(job.rootSequenceId).toEqual(jobSequence.id);
          originIds.push(job.id);

          return complete(async ({ continueWith }) => {
            expectTypeOf<
              Parameters<typeof continueWith>[0]["typeName"]
            >().toEqualTypeOf<"linear_next">();

            const continuedJob = await continueWith({
              typeName: "linear_next",
              input: { valueNext: job.input.value + 1 },
            });
            expectTypeOf(continuedJob.typeName).toEqualTypeOf<"linear_next">();
            expectTypeOf(continuedJob.status).toEqualTypeOf<"pending" | "blocked">();
            expect(continuedJob.typeName).toBe("linear_next");
            expect(continuedJob.status).toBeOneOf(["pending", "blocked"]);
            expect(continuedJob.sequenceId).toEqual(jobSequence.id);
            return continuedJob;
          });
        },
      })
      .implementJobType({
        typeName: "linear_next",
        process: async ({ job, complete }) => {
          expect(job.id).not.toEqual(jobSequence.id);
          expect(job.sequenceId).toEqual(jobSequence.id);
          expect(job.originId).toEqual(originIds[0]);
          expect(job.rootSequenceId).toEqual(jobSequence.id);
          originIds.push(job.id);

          return complete(async ({ continueWith }) => {
            expectTypeOf<
              Parameters<typeof continueWith>[0]["typeName"]
            >().toEqualTypeOf<"linear_next_next">();

            const continuedJob = await continueWith({
              typeName: "linear_next_next",
              input: { valueNextNext: job.input.valueNext + 1 },
            });
            expectTypeOf(continuedJob.typeName).toEqualTypeOf<"linear_next_next">();
            expectTypeOf(continuedJob.status).toEqualTypeOf<"pending" | "blocked">();
            return continuedJob;
          });
        },
      })
      .implementJobType({
        typeName: "linear_next_next",
        process: async ({ job, complete }) => {
          expect(job.id).not.toEqual(jobSequence.id);
          expect(job.sequenceId).toEqual(jobSequence.id);
          expect(job.originId).toEqual(originIds[1]);
          expect(job.rootSequenceId).toEqual(jobSequence.id);

          const result = await complete(async () => ({
            result: job.input.valueNextNext,
          }));
          expectTypeOf(result.typeName).toEqualTypeOf<"linear_next_next">();
          expectTypeOf(result.status).toEqualTypeOf<"completed">();
          return result;
        },
      });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) => {
        return queuert.startJobSequence({
          ...context,
          typeName: "linear",
          input: { value: 1 },
        });
      }),
    );
    expectTypeOf<CompletedJobSequence<typeof jobSequence>["output"]>().toEqualTypeOf<{
      result: number;
    }>();
    expectTypeOf<
      Parameters<(typeof queuert)["startJobSequence"]>[0]["typeName"]
    >().toEqualTypeOf<"linear">();
    expectTypeOf<
      Parameters<(typeof queuert)["getJobSequence"]>[0]["typeName"]
    >().toEqualTypeOf<"linear">();

    await withWorkers([await worker.start()], async () => {
      const finishedJobSequence = await queuert.waitForJobSequenceCompletion(
        jobSequence,
        completionOptions,
      );

      expectTypeOf(finishedJobSequence.output).toEqualTypeOf<{ result: number }>();
      expect(finishedJobSequence.output).toEqual({ result: 3 });
    });

    expectLogs([
      { type: "job_sequence_created", data: { typeName: "linear" } },
      { type: "job_created", data: { typeName: "linear" } },
      { type: "worker_started" },
      { type: "job_attempt_started", data: { typeName: "linear" } },
      {
        type: "job_created",
        data: {
          typeName: "linear_next",
          sequenceId: jobSequence.id,
          sequenceTypeName: "linear",
          rootSequenceId: jobSequence.id,
          originId: originIds[0],
        },
      },
      { type: "job_attempt_completed", data: { typeName: "linear" } },
      { type: "job_completed", data: { typeName: "linear" } },
      { type: "job_attempt_started", data: { typeName: "linear_next" } },
      {
        type: "job_created",
        data: {
          typeName: "linear_next_next",
          sequenceId: jobSequence.id,
          sequenceTypeName: "linear",
          rootSequenceId: jobSequence.id,
          originId: originIds[1],
        },
      },
      { type: "job_attempt_completed", data: { typeName: "linear_next" } },
      { type: "job_completed", data: { typeName: "linear_next" } },
      { type: "job_attempt_started", data: { typeName: "linear_next_next" } },
      { type: "job_attempt_completed", data: { typeName: "linear_next_next" } },
      { type: "job_completed", data: { typeName: "linear_next_next" } },
      { type: "job_sequence_completed", data: { typeName: "linear" } },
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);

    await expectMetrics([
      { method: "jobSequenceCreated", args: { typeName: "linear" } },
      { method: "jobCreated", args: { typeName: "linear" } },
      { method: "workerStarted" },
      { method: "jobAttemptStarted", args: { typeName: "linear" } },
      { method: "jobCreated", args: { typeName: "linear_next", sequenceTypeName: "linear" } },
      { method: "jobAttemptCompleted", args: { typeName: "linear" } },
      { method: "jobCompleted", args: { typeName: "linear" } },
      { method: "jobAttemptStarted", args: { typeName: "linear_next" } },
      { method: "jobCreated", args: { typeName: "linear_next_next", sequenceTypeName: "linear" } },
      { method: "jobAttemptCompleted", args: { typeName: "linear_next" } },
      { method: "jobCompleted", args: { typeName: "linear_next" } },
      { method: "jobAttemptStarted", args: { typeName: "linear_next_next" } },
      { method: "jobAttemptCompleted", args: { typeName: "linear_next_next" } },
      { method: "jobCompleted", args: { typeName: "linear_next_next" } },
      { method: "jobSequenceCompleted", args: { typeName: "linear" } },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);

    await expectHistograms([
      { method: "jobDuration", args: { typeName: "linear" } },
      { method: "jobAttemptDuration", args: { typeName: "linear" } },
      { method: "jobDuration", args: { typeName: "linear_next" } },
      { method: "jobAttemptDuration", args: { typeName: "linear_next" } },
      { method: "jobDuration", args: { typeName: "linear_next_next" } },
      { method: "jobSequenceDuration", args: { typeName: "linear" } },
      { method: "jobAttemptDuration", args: { typeName: "linear_next_next" } },
    ]);
  });

  it("handles branched sequences", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        main: {
          entry: true;
          input: { value: number };
          continueWith: { typeName: "branch1" | "branch2" };
        };
        branch1: {
          input: { valueBranched: number };
          output: { result1: number };
        };
        branch2: {
          input: { valueBranched: number };
          output: { result2: number };
        };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "main",
        process: async ({ job, prepare, complete }) => {
          await prepare({ mode: "atomic" });
          return complete(async ({ continueWith }) => {
            expectTypeOf<Parameters<typeof continueWith>[0]["typeName"]>().toEqualTypeOf<
              "branch1" | "branch2"
            >();

            return continueWith({
              typeName: job.input.value % 2 === 0 ? "branch1" : "branch2",
              input: { valueBranched: job.input.value },
            });
          });
        },
      })
      .implementJobType({
        typeName: "branch1",
        process: async ({ job, prepare, complete }) => {
          await prepare({ mode: "atomic" });
          return complete(async () => ({
            result1: job.input.valueBranched,
          }));
        },
      })
      .implementJobType({
        typeName: "branch2",
        process: async ({ job, prepare, complete }) => {
          await prepare({ mode: "atomic" });
          return complete(async () => ({
            result2: job.input.valueBranched,
          }));
        },
      });

    const evenJobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "main",
          input: { value: 2 },
        }),
      ),
    );
    const oddJobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "main",
          input: { value: 3 },
        }),
      ),
    );
    expectTypeOf<CompletedJobSequence<typeof evenJobSequence>["output"]>().toEqualTypeOf<
      { result1: number } | { result2: number }
    >();
    expectTypeOf<CompletedJobSequence<typeof oddJobSequence>["output"]>().toEqualTypeOf<
      { result1: number } | { result2: number }
    >();

    await withWorkers([await worker.start()], async () => {
      const [succeededJobEven, succeededJobOdd] = await Promise.all([
        queuert.waitForJobSequenceCompletion(evenJobSequence, completionOptions),
        queuert.waitForJobSequenceCompletion(oddJobSequence, completionOptions),
      ]);

      expectTypeOf(succeededJobEven.output).toEqualTypeOf<
        { result1: number } | { result2: number }
      >();
      expectTypeOf(succeededJobOdd.output).toEqualTypeOf<
        { result1: number } | { result2: number }
      >();
      expect(succeededJobEven.output).toEqual({ result1: 2 });
      expect(succeededJobOdd.output).toEqual({ result2: 3 });
    });
  });

  it("handles loops", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        loop: {
          entry: true;
          input: { counter: number };
          output: { done: true };
          continueWith: { typeName: "loop" };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      typeName: "loop",
      process: async ({ job, prepare, complete }) => {
        await prepare({ mode: "atomic" });
        return complete(async ({ continueWith }) => {
          expectTypeOf<Parameters<typeof continueWith>[0]["typeName"]>().toEqualTypeOf<"loop">();

          return job.input.counter < 3
            ? continueWith({
                typeName: "loop",
                input: { counter: job.input.counter + 1 },
              })
            : { done: true };
        });
      },
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "loop",
          input: { counter: 0 },
        }),
      ),
    );
    expectTypeOf<CompletedJobSequence<typeof jobSequence>["output"]>().toEqualTypeOf<{
      done: true;
    }>();

    await withWorkers([await worker.start()], async () => {
      const succeededJobSequence = await queuert.waitForJobSequenceCompletion(
        jobSequence,
        completionOptions,
      );
      expect(succeededJobSequence.output).toEqual({ done: true });
    });
  });

  it("handles go-to", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        start: {
          entry: true;
          input: { value: number };
          continueWith: { typeName: "end" };
        };
        end: {
          input: { result: number };
          output: { finalResult: number };
          continueWith: { typeName: "start" };
        };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "start",
        process: async ({ job, prepare, complete }) => {
          await prepare({ mode: "atomic" });
          return complete(async ({ continueWith }) => {
            expectTypeOf<Parameters<typeof continueWith>[0]["typeName"]>().toEqualTypeOf<"end">();

            return continueWith({
              typeName: "end",
              input: { result: job.input.value + 1 },
            });
          });
        },
      })
      .implementJobType({
        typeName: "end",
        process: async ({ job, prepare, complete }) => {
          await prepare({ mode: "atomic" });
          return complete(async ({ continueWith }) => {
            expectTypeOf<Parameters<typeof continueWith>[0]["typeName"]>().toEqualTypeOf<"start">();

            if (job.input.result < 3) {
              return continueWith({
                typeName: "start",
                input: { value: job.input.result },
              });
            } else {
              return { finalResult: job.input.result };
            }
          });
        },
      });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "start",
          input: { value: 0 },
        }),
      ),
    );
    expectTypeOf<CompletedJobSequence<typeof jobSequence>["output"]>().toEqualTypeOf<{
      finalResult: number;
    }>();

    await withWorkers([await worker.start()], async () => {
      const succeededJobSequence = await queuert.waitForJobSequenceCompletion(
        jobSequence,
        completionOptions,
      );

      expectTypeOf(succeededJobSequence.output).toEqualTypeOf<{ finalResult: number }>();
      expect(succeededJobSequence.output).toEqual({ finalResult: 3 });
    });
  });

  it("correctly types sequenceTypeName for jobs reachable from multiple sequences", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        entryA: { entry: true; input: { fromA: true }; continueWith: { typeName: "shared" } };
        entryB: { entry: true; input: { fromB: true }; continueWith: { typeName: "shared" } };
        shared: { input: { data: number }; output: { done: true } };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "entryA",
        process: async ({ job, complete }) => {
          // Entry job's sequenceTypeName should match its own typeName
          expectTypeOf(job.sequenceTypeName).toEqualTypeOf<"entryA">();
          expect(job.sequenceTypeName).toBe("entryA");
          return complete(async ({ continueWith }) =>
            continueWith({ typeName: "shared", input: { data: 1 } }),
          );
        },
      })
      .implementJobType({
        typeName: "entryB",
        process: async ({ job, complete }) => {
          // Entry job's sequenceTypeName should match its own typeName
          expectTypeOf(job.sequenceTypeName).toEqualTypeOf<"entryB">();
          expect(job.sequenceTypeName).toBe("entryB");
          return complete(async ({ continueWith }) =>
            continueWith({ typeName: "shared", input: { data: 2 } }),
          );
        },
      })
      .implementJobType({
        typeName: "shared",
        process: async ({ job, complete }) => {
          // Shared job's sequenceTypeName should be union of both entry types
          expectTypeOf(job.sequenceTypeName).toEqualTypeOf<"entryA" | "entryB">();
          expect(["entryA", "entryB"]).toContain(job.sequenceTypeName);
          return complete(async () => ({ done: true }));
        },
      });

    const sequenceA = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({ ...context, typeName: "entryA", input: { fromA: true } }),
      ),
    );
    const sequenceB = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({ ...context, typeName: "entryB", input: { fromB: true } }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const [resultA, resultB] = await Promise.all([
        queuert.waitForJobSequenceCompletion(sequenceA, { pollIntervalMs: 100, timeoutMs: 5000 }),
        queuert.waitForJobSequenceCompletion(sequenceB, { pollIntervalMs: 100, timeoutMs: 5000 }),
      ]);
      expect(resultA.output).toEqual({ done: true });
      expect(resultB.output).toEqual({ done: true });
    });
  });

  // TODO: add a test where a sequence is distributed across multiple workers
};
