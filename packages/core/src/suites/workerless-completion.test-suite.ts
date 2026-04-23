import { type TestAPI, expectTypeOf, vi } from "vitest";

import { sleep } from "../helpers/sleep.js";
import {
  JobTypeMismatchError,
  TransactionContextRequiredError,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const workerlessCompletionTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("completes a simple job chain without worker", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 42 },
        }),
      ),
    );

    const completedChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          id: jobChain.id,
          complete: async ({ job, complete }) => {
            expect(job.typeName).toEqual("test");
            expect(job.status).toEqual("pending");
            expect(job.input).toEqual({ value: 42 });

            return complete(job, async ({ transactionHooks }) => {
              expect(transactionHooks).toBeDefined();
              return { result: 84 };
            });
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
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "awaiting-approval",
          input: { requestId: "req-123" },
        }),
      ),
    );

    expect(jobChain.status).toEqual("pending");

    const completedChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeJobChain({
          ...txCtx,
          transactionHooks,
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

  it("rejects continueWith typeName/input mismatches in completeJobChain", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      start: {
        entry: true;
        input: { requestId: string };
        continueWith: { typeName: "step-a" };
      };
      "step-a": {
        input: { valueA: number };
        continueWith: { typeName: "step-b" };
      };
      "step-b": {
        input: { valueB: boolean };
        output: { result: string };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "start",
          input: { requestId: "req-1" },
        }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "start",
          id: jobChain.id,
          complete: async ({ job, complete }) => {
            // @ts-expect-error complete() rejects un-narrowed union job types
            void complete(job, async () => ({ result: "done" }));

            if (job.typeName === "start") {
              job = await complete(job, async ({ continueWith }) => {
                expectTypeOf<
                  Parameters<typeof continueWith>[0]["typeName"]
                >().toEqualTypeOf<"step-a">();

                return continueWith({
                  typeName: "step-a",
                  input: { valueA: 42 },
                });
              });
            }

            if (job.typeName === "step-a") {
              job = await complete(job, async ({ continueWith }) => {
                expectTypeOf<
                  Parameters<typeof continueWith>[0]["typeName"]
                >().toEqualTypeOf<"step-b">();

                return continueWith({
                  typeName: "step-b",
                  input: { valueB: true },
                });
              });
            }

            if (job.typeName === "step-b") {
              return complete(job, async () => ({ result: "done" }));
            }
          },
        }),
      ),
    );
  });

  it("partially completes a complex job chain without worker", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          "process-approved": {
            attemptHandler: async ({ prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async () => ({ done: true }));
            },
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "awaiting-approval",
          input: { requestId: "req-123" },
        }),
      ),
    );

    expect(jobChain.status).toEqual("pending");

    const partiallyCompletedChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeJobChain({
          ...txCtx,
          transactionHooks,
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
      const succeededChain = await client.awaitJobChain(partiallyCompletedChain, completionOptions);

      expectTypeOf<(typeof succeededChain)["status"]>().toEqualTypeOf<"completed">();
      expect(succeededChain.output).toEqual({ done: true });
    });
  });

  it("throws error when finalizing already completed job", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          id: jobChain.id,
          complete: async ({ job, complete }) => {
            return complete(job, async () => ({ result: false }));
          },
        }),
      ),
    );

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeJobChain({
            ...txCtx,
            transactionHooks,
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
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 42 },
        }),
      ),
    );

    const completeFn = vi.fn();
    const updatedChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeJobChain({
          ...txCtx,
          transactionHooks,
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
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();
    const processCompleted = Promise.withResolvers<void>();

    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      workerId: "worker",
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
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
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await jobStarted.promise;
      await sleep(10);

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeJobChain({
            ...txCtx,
            transactionHooks,
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
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      entryA: { entry: true; input: null; continueWith: { typeName: "shared" } };
      entryB: { entry: true; input: null; continueWith: { typeName: "shared" } };
      shared: { input: null; output: { done: boolean } };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({ ...txCtx, transactionHooks, typeName: "entryA", input: null }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "entryA",
          id: jobChain.id,
          complete: async ({ job, complete }) => {
            expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA">();
            expect(job.chainTypeName).toBe("entryA");

            if (job.typeName === "entryA") {
              job = await complete(job, async ({ continueWith }) =>
                continueWith({ typeName: "shared", input: null }),
              );
            }

            expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA">();
            expect(job.chainTypeName).toBe("entryA");

            return complete(job, async () => ({ done: true }));
          },
        }),
      ),
    );
  });

  it("completeJobChain throws when called without transaction context", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 42 },
        }),
      ),
    );

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        // @ts-expect-error missing txCtx
        client.completeJobChain({
          transactionHooks,
          typeName: "test",
          id: jobChain.id,
          complete: async ({ job, complete }) => complete(job, async () => ({ result: 84 })),
        }),
      ),
    ).rejects.toThrow(TransactionContextRequiredError);
  });

  it("completeJobChain throws on typeName mismatch", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      order: { entry: true; input: { amount: number }; output: { receipt: string } };
      notification: { entry: true; input: { message: string }; output: { sent: boolean } };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "order",
          input: { amount: 42 },
        }),
      ),
    );

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "notification",
            id: jobChain.id,
            complete: async ({ job, complete }) => complete(job, async () => ({ sent: true })),
          }),
        ),
      ),
    ).rejects.toThrow(JobTypeMismatchError);
  });

  it("awaitJobChain throws on typeName mismatch", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      order: { entry: true; input: { amount: number }; output: { receipt: string } };
      notification: { entry: true; input: { message: string }; output: { sent: boolean } };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "order",
          input: { amount: 42 },
        }),
      ),
    );

    await expect(
      client.awaitJobChain({ typeName: "notification", id: jobChain.id }, { timeoutMs: 1000 }),
    ).rejects.toThrow(JobTypeMismatchError);
  });
};
