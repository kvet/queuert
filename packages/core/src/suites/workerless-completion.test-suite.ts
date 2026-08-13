import { type TestAPI, expectTypeOf, vi } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { BlockerLimitExceededError, ChainTypeMismatchError } from "../errors.js";
import { sleep } from "../helpers/sleep.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const workerlessCompletionTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("completes a simple chain without worker", async ({
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 42 },
        }),
      ),
    );

    const completedChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) => {
            expect(job.typeName).toEqual("test");
            expect(job.status).toEqual("pending");
            expect(job.input).toEqual({ value: 42 });

            return completeJob(job, async ({ finish, transactionHooks }) => {
              expect(transactionHooks).toBeDefined();
              return finish({ output: { result: 84 } });
            });
          },
        }),
      ),
    );

    expectTypeOf(completedChain.status).toEqualTypeOf<"completed">();
    expectTypeOf(completedChain.output).toEqualTypeOf<{ result: number }>();
    expect(completedChain.output).toEqual({ result: 84 });
  });

  it("completes a complex chain without worker", async ({
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "awaiting-approval",
          input: { requestId: "req-123" },
        }),
      ),
    );

    expect(chain.status).toEqual("running");
    const initialJob = await client.getJob({ id: chain.id });
    expect(initialJob!.status).toBe("pending");

    const completedChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) => {
            if (job.typeName === "awaiting-approval") {
              job = await completeJob(job, async ({ finish }) => {
                return finish({
                  continueWith: {
                    typeName: "process-approved",
                    input: { approved: true },
                  },
                });
              });
              expectTypeOf<(typeof job)["typeName"]>().toEqualTypeOf<"process-approved">();
              return completeJob(job, async ({ finish }) => finish({ output: { done: true } }));
            }
            return completeJob(job, async ({ finish }) => finish({ output: { done: true } }));
          },
        }),
      ),
    );

    expectTypeOf(completedChain.status).toEqualTypeOf<"completed">();
    expect(completedChain.output).toEqual({ done: true });
  });

  it("rejects continueWith typeName/input mismatches in completeChain", async ({
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "start",
          input: { requestId: "req-1" },
        }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) => {
            if (false as boolean) {
              // @ts-expect-error finish({ output: ... }) rejects un-narrowed union job types
              void completeJob(job, async ({ finish }) => finish({ output: { result: "done" } }));
            }

            if (job.typeName === "start") {
              job = await completeJob(job, async ({ finish }) =>
                finish({ continueWith: { typeName: "step-a", input: { valueA: 42 } } }),
              );
            }

            if (job.typeName === "step-a") {
              job = await completeJob(job, async ({ finish }) =>
                finish({ continueWith: { typeName: "step-b", input: { valueB: true } } }),
              );
            }

            if (job.typeName === "step-b") {
              return completeJob(job, async ({ finish }) => finish({ output: { result: "done" } }));
            }
          },
        }),
      ),
    );
  });

  it("rejects continueWith declaring more blockers than the limit in completeChain", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: null;
        output: null;
      };
      starter: {
        entry: true;
        input: null;
        output: null;
        continueWith: { typeName: "next" };
      };
      next: {
        input: null;
        output: null;
        blockers: [{ typeName: "blocker" }];
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const blockerChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: null,
        }),
      ),
    );

    const starterChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "starter",
          input: null,
        }),
      ),
    );

    try {
      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...starterChain,
            handler: async ({ job, completeJob }) => {
              if (job.typeName === "starter") {
                return completeJob(job, async ({ finish }) =>
                  finish({
                    continueWith: {
                      typeName: "next",
                      input: null,
                      blockers: Array.from({ length: 101 }, () => blockerChain) as [
                        typeof blockerChain,
                      ],
                    },
                  }),
                );
              }
            },
          }),
        ),
      );
      expect.fail("Expected continueWith to throw an error due to exceeding blocker limit");
    } catch (error) {
      expect(error).toBeInstanceOf(BlockerLimitExceededError);
      expect((error as BlockerLimitExceededError).count).toBe(101);
      expect((error as BlockerLimitExceededError).limit).toBe(100);
      expect((error as BlockerLimitExceededError).typeName).toBe("next");
    }
  });

  it("partially completes a complex chain without worker", async ({
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
              return complete(async ({ finish }) => finish({ output: { done: true } }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "awaiting-approval",
          input: { requestId: "req-123" },
        }),
      ),
    );

    expect(chain.status).toEqual("running");
    const initialJob = await client.getJob({ id: chain.id });
    expect(initialJob!.status).toBe("pending");

    const partiallyCompletedChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) => {
            if (job.typeName === "awaiting-approval") {
              job = await completeJob(job, async ({ finish }) => {
                return finish({
                  continueWith: {
                    typeName: "process-approved",
                    input: { approved: true },
                  },
                });
              });
              expectTypeOf<(typeof job)["typeName"]>().toEqualTypeOf<"process-approved">();
            }
          },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededChain = await client.awaitChain(partiallyCompletedChain, completionOptions);

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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) => {
            return completeJob(job, async ({ finish }) => finish({ output: { result: false } }));
          },
        }),
      ),
    );

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...chain,
            handler: async ({ job, completeJob }) => {
              return completeJob(job, async ({ finish }) => finish({ output: { result: false } }));
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 42 },
        }),
      ),
    );

    const handlerFn = vi.fn();
    const updatedChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: handlerFn,
        }),
      ),
    );

    expect(handlerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        job: expect.objectContaining({ typeName: "test", status: "pending" }),
      }),
    );
    expect(updatedChain).toMatchObject({
      id: chain.id,
      status: "running",
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
                await expect(
                  complete(async ({ finish }) => finish({ output: { result: "from-worker" } })),
                ).rejects.toThrow();

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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
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
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...chain,
            handler: async ({ job, completeJob }) => {
              await completeJob(job, async ({ finish }) =>
                finish({ output: { result: "from-external" } }),
              );
            },
          }),
        ),
      );
      jobCompleted.resolve();

      await processCompleted.promise;
    });
  });

  it("correctly narrows chainTypeName in completeChain", async ({
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "entryA", input: null }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) => {
            expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA">();
            expect(job.chainTypeName).toBe("entryA");

            if (job.typeName === "entryA") {
              job = await completeJob(job, async ({ finish }) =>
                finish({ continueWith: { typeName: "shared", input: null } }),
              );
            }

            expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA">();
            expect(job.chainTypeName).toBe("entryA");

            return completeJob(job, async ({ finish }) => finish({ output: { done: true } }));
          },
        }),
      ),
    );
  });

  it("completeChain throws when called without transaction context", async ({
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
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
        client.completeChain({
          transactionHooks,
          typeName: "test",
          id: chain.id,
          handler: async ({ job, completeJob }) =>
            completeJob(job, async ({ finish }) => finish({ output: { result: 84 } })),
        }),
      ),
    ).rejects.toThrow("requires a transaction context");
  });

  it("completeChain throws on typeName mismatch", async ({
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
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
          client.completeChain({
            ...txCtx,
            transactionHooks,
            typeName: "notification",
            id: chain.id,
            handler: async ({ job, completeJob }) =>
              completeJob(job, async ({ finish }) => finish({ output: { sent: true } })),
          }),
        ),
      ),
    ).rejects.toThrow(ChainTypeMismatchError);
  });

  it("applies the terminal transition inline and rejects a second one", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      review: {
        entry: true;
        input: { requestId: string };
        output: { approved: boolean };
        continueWith: { typeName: "archive" };
      };
      archive: {
        input: { requestId: string };
        output: { archived: boolean };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "review",
          input: { requestId: "req-1" },
        }),
      ),
    );

    const completedChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) => {
            if (job.typeName !== "review") throw new Error("unexpected job type");
            return completeJob(job, async ({ finish }) => {
              const completedJob = await finish({ output: { approved: true } });

              await expect(
                finish({ continueWith: { typeName: "archive", input: { requestId: "req-1" } } }),
              ).rejects.toThrow("finish can only be called once");

              return completedJob;
            });
          },
        }),
      ),
    );

    expectTypeOf(completedChain.status).toEqualTypeOf<"completed">();
    expect(completedChain.output).toEqual({ approved: true });
  });

  it("re-throws a swallowed finish failure instead of committing half of it", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: { entry: true; input: null; output: null };
      review: {
        entry: true;
        input: { requestId: string };
        output: { approved: boolean };
        continueWith: { typeName: "archive" };
      };
      archive: {
        input: { requestId: string };
        output: { archived: boolean };
        blockers: [{ typeName: "blocker" }];
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const [blockerChain, chain] = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "blocker", input: null },
            { typeName: "review", input: { requestId: "req-1" } },
          ],
        }),
      ),
    );

    // The blocker limit is checked after the predecessor has already been
    // committed, so this apply leaves the predecessor pointing at a successor
    // that was never inserted. The handler swallows the failure and returns
    // normally, so the latched failure is the only thing standing between that
    // half-write and a finish.
    await expect(
      withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...chain,
            handler: async ({ job, completeJob }) => {
              if (job.typeName !== "review") throw new Error("unexpected job type");
              return completeJob(job, async ({ finish }) => {
                await expect(
                  finish({
                    continueWith: {
                      typeName: "archive",
                      input: { requestId: "req-1" },
                      blockers: Array.from({ length: 101 }, () => blockerChain) as [
                        typeof blockerChain,
                      ],
                    },
                  }),
                ).rejects.toBeInstanceOf(BlockerLimitExceededError);

                return finish({ output: { approved: false } });
              });
            },
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(BlockerLimitExceededError);

    const jobs = await client.listChainJobs({ chainId: chain.id, limit: 10 });
    expect(jobs.items).toHaveLength(1);
    const [onlyJob] = jobs.items;
    expect(onlyJob.status).toBe("pending");
  });
};
