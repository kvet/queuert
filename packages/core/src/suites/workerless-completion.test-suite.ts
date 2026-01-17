import { expectTypeOf, TestAPI, vi } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createQueuert, defineJobTypes } from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

export const workerlessCompletionTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("completes a simple job sequence without worker", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
    expectLogs,
    expectMetrics,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { value: 42 },
        }),
      ),
    );

    const completedSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.completeJobSequence({
          ...context,
          typeName: "test",
          id: jobSequence.id,
          complete: async ({ job, complete }) => {
            expect(job.typeName).toEqual("test");
            expect(job.status).toEqual("pending");
            expect(job.input).toEqual({ value: 42 });

            return complete(job, async () => ({ result: 84 }));
          },
        }),
      ),
    );

    expectTypeOf<(typeof completedSequence)["status"]>().toEqualTypeOf<"completed">();
    expect(completedSequence.output).toEqual({ result: 84 });

    expectLogs([
      { type: "job_sequence_created", data: { input: { value: 42 } } },
      { type: "job_created", data: { input: { value: 42 } } },
      { type: "job_completed", data: { output: { result: 84 }, workerId: null } },
      { type: "job_sequence_completed", data: { output: { result: 84 } } },
    ]);

    await expectMetrics([
      { method: "jobSequenceCreated", args: { input: { value: 42 } } },
      { method: "jobCreated", args: { input: { value: 42 } } },
      { method: "jobCompleted", args: { output: { result: 84 }, workerId: null } },
      { method: "jobSequenceCompleted", args: { output: { result: 84 } } },
    ]);
  });

  it("completes a complex job sequence without worker", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
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
        "awaiting-approval": {
          entry: true;
          input: { requestId: string };
          continueWith: { typeName: "process-approved" };
        };
        "process-approved": {
          input: { approved: boolean };
          output: { done: boolean };
        };
      }>(),
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "awaiting-approval",
          input: { requestId: "req-123" },
        }),
      ),
    );

    expect(jobSequence.status).toEqual("pending");

    const completedSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.completeJobSequence({
          ...context,
          typeName: "awaiting-approval",
          id: jobSequence.id,
          complete: async ({ job, complete }) => {
            if (job.typeName === "awaiting-approval") {
              job = await complete(job, async ({ continueWith }) => {
                return continueWith({
                  typeName: "process-approved",
                  input: { approved: true },
                });
              });
              expectTypeOf<(typeof job)["typeName"]>().toEqualTypeOf<"process-approved">();
            }
            return complete(job, async () => ({ done: true }));
          },
        }),
      ),
    );

    expectTypeOf<(typeof completedSequence)["status"]>().toEqualTypeOf<"completed">();
    expect(completedSequence.output).toEqual({ done: true });
  });

  it("partially completes a complex job sequence without worker", async ({
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
        "awaiting-approval": {
          entry: true;
          input: { requestId: string };
          continueWith: { typeName: "process-approved" };
        };
        "process-approved": {
          input: { approved: boolean };
          output: { done: true };
        };
      }>(),
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "awaiting-approval",
          input: { requestId: "req-123" },
        }),
      ),
    );

    expect(jobSequence.status).toEqual("pending");

    const partiallyCompletedSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.completeJobSequence({
          ...context,
          typeName: "awaiting-approval",
          id: jobSequence.id,
          complete: async ({ job, complete }) => {
            if (job.typeName === "awaiting-approval") {
              job = await complete(job, async ({ continueWith }) => {
                return continueWith({
                  typeName: "process-approved",
                  input: { approved: true },
                });
              });
              expectTypeOf<(typeof job)["typeName"]>().toEqualTypeOf<"process-approved">();
            }
          },
        }),
      ),
    );

    const worker = queuert.createWorker().implementJobType({
      typeName: "process-approved",
      process: async ({ prepare, complete }) => {
        await prepare({ mode: "atomic" });
        return complete(async () => ({ done: true }));
      },
    });

    await withWorkers([await worker.start()], async () => {
      const succeededSequence = await queuert.waitForJobSequenceCompletion(
        partiallyCompletedSequence,
        completionOptions,
      );

      expectTypeOf<(typeof succeededSequence)["status"]>().toEqualTypeOf<"completed">();
      expect(succeededSequence.output).toEqual({ done: true });
    });
  });

  it("throws error when finalizing already completed job", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
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
        test: {
          entry: true;
          input: null;
          output: { result: boolean };
        };
      }>(),
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

    await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.completeJobSequence({
          ...context,
          typeName: "test",
          id: jobSequence.id,
          complete: async ({ job, complete }) => {
            return complete(job, async () => ({ result: false }));
          },
        }),
      ),
    );

    await expect(
      queuert.withNotify(async () =>
        runInTransaction(async (context) =>
          queuert.completeJobSequence({
            ...context,
            typeName: "test",
            id: jobSequence.id,
            complete: async ({ job, complete }) => {
              return complete(job, async () => ({ result: false }));
            },
          }),
        ),
      ),
    ).rejects.toThrow("job is already completed");
  });

  it("read-only update without calling complete", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
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
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { value: 42 },
        }),
      ),
    );

    const completeFn = vi.fn();
    const updatedSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.completeJobSequence({
          ...context,
          typeName: "test",
          id: jobSequence.id,
          complete: completeFn,
        }),
      ),
    );

    expect(completeFn).toHaveBeenCalledWith(
      expect.objectContaining({
        job: expect.objectContaining({ typeName: "test", status: "pending" }),
      }),
    );
    expect(updatedSequence).toMatchObject({
      id: jobSequence.id,
      status: "pending",
    });
  });

  it("signals running job when completed without worker", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();
    const processCompleted = Promise.withResolvers<void>();

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        test: {
          entry: true;
          input: null;
          output: { result: string };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
      process: async ({ signal, complete }) => {
        jobStarted.resolve();

        await jobCompleted.promise;

        try {
          await expect(complete(async () => ({ result: "from-worker" }))).rejects.toThrow();

          expect(signal.aborted).toBe(true);
          expect(signal.reason).toBe("already_completed");

          throw new Error();
        } finally {
          processCompleted.resolve();
        }
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

    await withWorkers([await worker.start({ workerId: "worker" })], async () => {
      await jobStarted.promise;
      await sleep(10);

      await queuert.withNotify(async () =>
        runInTransaction(async (context) =>
          queuert.completeJobSequence({
            ...context,
            typeName: "test",
            id: jobSequence.id,
            complete: async ({ job, complete }) => {
              await complete(job, async () => ({ result: "from-external" }));
            },
          }),
        ),
      );
      jobCompleted.resolve();

      await processCompleted.promise;
    });
  });

  it("correctly narrows sequenceTypeName in completeJobSequence", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
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
        entryA: { entry: true; input: null; continueWith: { typeName: "shared" } };
        entryB: { entry: true; input: null; continueWith: { typeName: "shared" } };
        shared: { input: null; output: { done: boolean } };
      }>(),
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({ ...context, typeName: "entryA", input: null }),
      ),
    );

    await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.completeJobSequence({
          ...context,
          typeName: "entryA",
          id: jobSequence.id,
          complete: async ({ job, complete }) => {
            // In completeJobSequence with typeName: "entryA", sequenceTypeName should be narrowed
            expectTypeOf(job.sequenceTypeName).toEqualTypeOf<"entryA">();
            expect(job.sequenceTypeName).toBe("entryA");

            if (job.typeName === "entryA") {
              job = await complete(job, async ({ continueWith }) =>
                continueWith({ typeName: "shared", input: null }),
              );
            }

            // After continuing, job is now "shared" but sequenceTypeName is still "entryA"
            expectTypeOf(job.sequenceTypeName).toEqualTypeOf<"entryA">();
            expect(job.sequenceTypeName).toBe("entryA");

            return complete(job, async () => ({ done: true }));
          },
        }),
      ),
    );
  });
};
