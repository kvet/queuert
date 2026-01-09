import { expectTypeOf, TestAPI } from "vitest";
import {
  CompletedJobSequence,
  createQueuert,
  DefineContinuationInput,
  DefineContinuationOutput,
  defineUnionJobTypes,
} from "../index.js";
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
    log,
    expectLogs,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        linear: {
          input: { value: number };
          output: DefineContinuationOutput<"linear_next">;
        };
        linear_next: {
          input: DefineContinuationInput<{ valueNext: number }>;
          output: DefineContinuationOutput<"linear_next_next">;
        };
        linear_next_next: {
          input: DefineContinuationInput<{ valueNextNext: number }>;
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
  });

  it("handles branched sequences", async ({
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
        main: {
          input: { value: number };
          output: DefineContinuationOutput<"branch1"> | DefineContinuationOutput<"branch2">;
        };
        branch1: {
          input: DefineContinuationInput<{ valueBranched: number }>;
          output: { result1: number };
        };
        branch2: {
          input: DefineContinuationInput<{ valueBranched: number }>;
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
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        loop: {
          input: { counter: number };
          output: DefineContinuationOutput<"loop"> | { done: true };
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
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        start: {
          input: { value: number };
          output: DefineContinuationOutput<"end">;
        };
        end: {
          input: DefineContinuationInput<{ result: number }>;
          output: DefineContinuationOutput<"start"> | { finalResult: number };
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

  // TODO: add a test where a sequence is distributed across multiple workers
};
