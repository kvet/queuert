import { type TestAPI, expectTypeOf, vi } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createClient, createInProcessWorker, defineJobTypes } from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const workerlessCompletionTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("completes a simple job chain without worker", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
      test: {
        entry: true;
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

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 42 },
        }),
      ),
    );

    const completedChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.completeJobChain({
          ...txContext,
          typeName: "test",
          id: jobChain.id,
          complete: async ({ job, complete }) => {
            expect(job.typeName).toEqual("test");
            expect(job.status).toEqual("pending");
            expect(job.input).toEqual({ value: 42 });

            return complete(job, async () => ({ result: 84 }));
          },
        }),
      ),
    );

    expectTypeOf<(typeof completedChain)["status"]>().toEqualTypeOf<"completed">();
    expect(completedChain.output).toEqual({ result: 84 });
  });

  it("completes a complex job chain without worker", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
      "awaiting-approval": {
        entry: true;
        input: { requestId: string };
        continueWith: { typeName: "process-approved" };
      };
      "process-approved": {
        input: { approved: boolean };
        output: { done: boolean };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "awaiting-approval",
          input: { requestId: "req-123" },
        }),
      ),
    );

    expect(jobChain.status).toEqual("pending");

    const completedChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.completeJobChain({
          ...txContext,
          typeName: "awaiting-approval",
          id: jobChain.id,
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

    expectTypeOf<(typeof completedChain)["status"]>().toEqualTypeOf<"completed">();
    expect(completedChain.output).toEqual({ done: true });
  });

  it("partially completes a complex job chain without worker", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
      "awaiting-approval": {
        entry: true;
        input: { requestId: string };
        continueWith: { typeName: "process-approved" };
      };
      "process-approved": {
        input: { approved: boolean };
        output: { done: true };
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
        "process-approved": {
          attemptHandler: async ({ prepare, complete }) => {
            await prepare({ mode: "atomic" });
            return complete(async () => ({ done: true }));
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "awaiting-approval",
          input: { requestId: "req-123" },
        }),
      ),
    );

    expect(jobChain.status).toEqual("pending");

    const partiallyCompletedChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.completeJobChain({
          ...txContext,
          typeName: "awaiting-approval",
          id: jobChain.id,
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

    await withWorkers([await worker.start()], async () => {
      const succeededChain = await client.waitForJobChainCompletion(
        partiallyCompletedChain,
        completionOptions,
      );

      expectTypeOf<(typeof succeededChain)["status"]>().toEqualTypeOf<"completed">();
      expect(succeededChain.output).toEqual({ done: true });
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
    const registry = defineJobTypes<{
      test: {
        entry: true;
        input: null;
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

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.completeJobChain({
          ...txContext,
          typeName: "test",
          id: jobChain.id,
          complete: async ({ job, complete }) => {
            return complete(job, async () => ({ result: false }));
          },
        }),
      ),
    );

    await expect(
      client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.completeJobChain({
            ...txContext,
            typeName: "test",
            id: jobChain.id,
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
    const registry = defineJobTypes<{
      test: {
        entry: true;
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

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 42 },
        }),
      ),
    );

    const completeFn = vi.fn();
    const updatedChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.completeJobChain({
          ...txContext,
          typeName: "test",
          id: jobChain.id,
          complete: completeFn,
        }),
      ),
    );

    expect(completeFn).toHaveBeenCalledWith(
      expect.objectContaining({
        job: expect.objectContaining({ typeName: "test", status: "pending" }),
      }),
    );
    expect(updatedChain).toMatchObject({
      id: jobChain.id,
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

    const registry = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: { result: string };
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
          attemptHandler: async ({ signal, complete }) => {
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
      await jobStarted.promise;
      await sleep(10);

      await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.completeJobChain({
            ...txContext,
            typeName: "test",
            id: jobChain.id,
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

  it("correctly narrows chainTypeName in completeJobChain", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
      entryA: { entry: true; input: null; continueWith: { typeName: "shared" } };
      entryB: { entry: true; input: null; continueWith: { typeName: "shared" } };
      shared: { input: null; output: { done: boolean } };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({ ...txContext, typeName: "entryA", input: null }),
      ),
    );

    await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.completeJobChain({
          ...txContext,
          typeName: "entryA",
          id: jobChain.id,
          complete: async ({ job, complete }) => {
            // In completeJobChain with typeName: "entryA", chainTypeName should be narrowed
            expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA">();
            expect(job.chainTypeName).toBe("entryA");

            if (job.typeName === "entryA") {
              job = await complete(job, async ({ continueWith }) =>
                continueWith({ typeName: "shared", input: null }),
              );
            }

            // After continuing, job is now "shared" but chainTypeName is still "entryA"
            expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA">();
            expect(job.chainTypeName).toBe("entryA");

            return complete(job, async () => ({ done: true }));
          },
        }),
      ),
    );
  });
};
