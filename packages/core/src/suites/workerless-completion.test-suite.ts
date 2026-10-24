import { sleep } from "@queuert/helpers";
import { type TestAPI, expect, expectTypeOf, vi } from "vitest";

import { createClient } from "../client.js";
import {
  BlockerLimitExceededError,
  ChainTypeMismatchError,
  JobAlreadyCompletedError,
} from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../job-type-processors/create-job-type-processors.js";
import { defineJobTypes } from "../job-types/define-job-types.js";
import { withTransactionHooks } from "../transaction-hooks.js";
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

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 42 },
      }),
    );

    const completedChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) => {
          expect(job.typeName).toEqual("test");
          expect(job.status).toEqual("pending");
          expect(job.input).toEqual({ value: 42 });

          return completeJob(job, async ({ complete, transactionHooks }) => {
            expect(transactionHooks).toBeDefined();
            return complete({ output: { result: 84 } });
          });
        },
      }),
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

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "awaiting-approval",
        input: { requestId: "req-123" },
      }),
    );

    expect(chain.status).toEqual("running");
    const initialJob = await client.getJob({ id: chain.id });
    expect(initialJob!.status).toBe("pending");

    const completedChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) => {
          if (job.typeName === "awaiting-approval") {
            job = await completeJob(job, async ({ complete }) => {
              return complete({
                continueWith: {
                  typeName: "process-approved",
                  input: { approved: true },
                },
              });
            });
            expectTypeOf<(typeof job)["typeName"]>().toEqualTypeOf<"process-approved">();
            return completeJob(job, async ({ complete }) => complete({ output: { done: true } }));
          }
          return completeJob(job, async ({ complete }) => complete({ output: { done: true } }));
        },
      }),
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

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "start",
        input: { requestId: "req-1" },
      }),
    );

    await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) => {
          if (false as boolean) {
            // @ts-expect-error complete({ output: ... }) rejects un-narrowed union job types
            void completeJob(job, async ({ complete }) => complete({ output: { result: "done" } }));
          }

          if (job.typeName === "start") {
            job = await completeJob(job, async ({ complete }) =>
              complete({ continueWith: { typeName: "step-a", input: { valueA: 42 } } }),
            );
          }

          if (job.typeName === "step-a") {
            job = await completeJob(job, async ({ complete }) =>
              complete({ continueWith: { typeName: "step-b", input: { valueB: true } } }),
            );
          }

          if (job.typeName === "step-b") {
            return completeJob(job, async ({ complete }) =>
              complete({ output: { result: "done" } }),
            );
          }
        },
      }),
    );
  });

  it("rejects continueWith declaring more blockers than the limit in completeChain", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const blockerChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "blocker",
        input: null,
      }),
    );

    const starterChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "starter",
        input: null,
      }),
    );

    try {
      await withTransaction(async (txCtx, transactionHooks) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...starterChain,
          handler: async ({ job, completeJob }) => {
            if (job.typeName === "starter") {
              return completeJob(job, async ({ complete }) =>
                complete({
                  continueWith: {
                    typeName: "next",
                    input: null,
                    blockers: Array.from(
                      { length: stateAdapter.config.maxBlockersPerJob + 1 },
                      () => blockerChain,
                    ) as [typeof blockerChain],
                  },
                }),
              );
            }
          },
        }),
      );
      expect.fail("Expected continueWith to throw an error due to exceeding blocker limit");
    } catch (error) {
      expect(error).toBeInstanceOf(BlockerLimitExceededError);
      expect((error as BlockerLimitExceededError).count).toBe(
        stateAdapter.config.maxBlockersPerJob + 1,
      );
      expect((error as BlockerLimitExceededError).limit).toBe(
        stateAdapter.config.maxBlockersPerJob,
      );
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
            attemptHandler: async ({ complete }) => {
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { done: true } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "awaiting-approval",
        input: { requestId: "req-123" },
      }),
    );

    expect(chain.status).toEqual("running");
    const initialJob = await client.getJob({ id: chain.id });
    expect(initialJob!.status).toBe("pending");

    const partiallyCompletedChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) => {
          if (job.typeName === "awaiting-approval") {
            job = await completeJob(job, async ({ complete }) => {
              return complete({
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

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      }),
    );

    await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) => {
          const completed = await completeJob(job, async ({ complete }) =>
            complete({ output: { result: false } }),
          );

          await expect(
            completeJob(job, async ({ complete }) => complete({ output: { result: true } })),
          ).rejects.toThrow(JobAlreadyCompletedError);

          return completed;
        },
      }),
    );

    await expect(
      withTransaction(async (txCtx, transactionHooks) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) => {
            return completeJob(job, async ({ complete }) =>
              complete({ output: { result: false } }),
            );
          },
        }),
      ),
    ).rejects.toThrow("job is already completed");
  });

  it("read-only update without calling complete", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 42 },
      }),
    );

    const handlerFn = vi.fn();
    const updatedChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: handlerFn,
      }),
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
                  withTransaction(async (txCtx, transactionHooks) =>
                    complete({ ...txCtx, transactionHooks, output: { result: "from-worker" } }),
                  ),
                ).rejects.toThrow(JobAlreadyCompletedError);

                expect(signal.aborted).toBe(true);

                throw new Error();
              } finally {
                processCompleted.resolve();
              }
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await jobStarted.promise;
      await sleep(10);

      await withTransaction(async (txCtx, transactionHooks) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) => {
            await completeJob(job, async ({ complete }) =>
              complete({ output: { result: "from-external" } }),
            );
          },
        }),
      );
      jobCompleted.resolve();

      await processCompleted.promise;
    });
  });

  it("skips the current job in workers while the completeChain handler runs", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    skip,
    transactionConcurrency,
  }) => {
    if (transactionConcurrency === "serialized") return skip();

    const jobTypes = defineJobTypes<{
      first: { entry: true; input: null; continueWith: { typeName: "second" } };
      second: { input: null; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    // The current job must not be the head, which the chain lock already covers. See "Decouple
    // chain from jobs" in TODO.md.
    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "first", input: null }),
    );
    await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) => {
          if (job.typeName !== "first") throw new Error(`unexpected ${job.typeName}`);
          return completeJob(job, async ({ complete }) =>
            complete({ continueWith: { typeName: "second", input: null } }),
          );
        },
      }),
    );

    const secondAttempted = vi.fn();
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          second: {
            attemptHandler: async () => {
              secondAttempted();
              throw new Error("acquired the job locked by completeChain");
            },
          },
        },
      }),
    });

    const handlerEntered = Promise.withResolvers<void>();
    const handlerGate = Promise.withResolvers<void>();
    const completion = withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) => {
          handlerEntered.resolve();
          await handlerGate.promise;
          if (job.typeName !== "second") throw new Error(`unexpected ${job.typeName}`);
          return completeJob(job, async ({ complete }) => complete({ output: null }));
        },
      }),
    );

    try {
      await handlerEntered.promise;
      await withWorkers([await worker.start()], async () => sleep(100));
      expect(secondAttempted).not.toHaveBeenCalled();
    } finally {
      handlerGate.resolve();
      await completion;
    }
  });

  it("correctly narrows chainTypeName in completeChain", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "entryA", input: null }),
    );

    await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) => {
          expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA">();
          expect(job.chainTypeName).toBe("entryA");

          if (job.typeName === "entryA") {
            job = await completeJob(job, async ({ complete }) =>
              complete({ continueWith: { typeName: "shared", input: null } }),
            );
          }

          expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA">();
          expect(job.chainTypeName).toBe("entryA");

          return completeJob(job, async ({ complete }) => complete({ output: { done: true } }));
        },
      }),
    );
  });

  it("completeChain throws when called without transaction context or transactionHooks", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 42 },
      }),
    );

    await expect(
      // @ts-expect-error missing txCtx
      client.completeChain({
        typeName: "test",
        id: chain.id,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ complete }) => complete({ output: { result: 84 } })),
      }),
    ).rejects.toThrow("requires a transaction context");
    await withTransaction(async (txCtx) => {
      await expect(
        // @ts-expect-error missing transactionHooks
        client.completeChain({
          ...txCtx,
          typeName: "test",
          id: chain.id,
          handler: async ({ job, completeJob }) =>
            completeJob(job, async ({ complete }) => complete({ output: { result: 84 } })),
        }),
      ).rejects.toThrow("completeChain requires transactionHooks");
    });
  });

  it("completeChain throws when the context is not in a transaction", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withNonTransactionContext,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: { value: number }; output: { result: number } };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: { value: 42 } }),
    );

    await withNonTransactionContext(async (txCtx) =>
      withTransactionHooks(async (transactionHooks) => {
        await expect(
          client.completeChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            id: chain.id,
            handler: async ({ job, completeJob }) =>
              completeJob(job, async ({ complete }) => complete({ output: { result: 84 } })),
          }),
        ).rejects.toThrow("not in a transaction");
      }),
    );

    const job = await client.getJob({ id: chain.id });
    expect(job!.status).toBe("pending");
  });

  it("completeChain throws on typeName mismatch", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "order",
        input: { amount: 42 },
      }),
    );

    await expect(
      withTransaction(async (txCtx, transactionHooks) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          typeName: "notification",
          id: chain.id,
          handler: async ({ job, completeJob }) =>
            completeJob(job, async ({ complete }) => complete({ output: { sent: true } })),
        }),
      ),
    ).rejects.toThrow(ChainTypeMismatchError);
  });

  it("applies the terminal transition inline and rejects a second one", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "review",
        input: { requestId: "req-1" },
      }),
    );

    const completedChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) => {
          if (job.typeName !== "review") throw new Error("unexpected job type");
          return completeJob(job, async ({ complete }) => {
            const completedJob = await complete({ output: { approved: true } });

            await expect(
              complete({ continueWith: { typeName: "archive", input: { requestId: "req-1" } } }),
            ).rejects.toThrow("complete can only be called once");

            return completedJob;
          });
        },
      }),
    );

    expectTypeOf(completedChain.status).toEqualTypeOf<"completed">();
    expect(completedChain.output).toEqual({ approved: true });
  });

  it("re-throws a swallowed complete failure instead of committing half of it", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const [blockerChain, chain] = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "blocker", input: null },
          { typeName: "review", input: { requestId: "req-1" } },
        ],
      }),
    );

    await expect(
      withTransaction(async (txCtx, transactionHooks) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) => {
            if (job.typeName !== "review") throw new Error("unexpected job type");
            return completeJob(job, async ({ complete }) => {
              await expect(
                complete({
                  continueWith: {
                    typeName: "archive",
                    input: { requestId: "req-1" },
                    blockers: Array.from(
                      { length: stateAdapter.config.maxBlockersPerJob + 1 },
                      () => blockerChain,
                    ) as [typeof blockerChain],
                  },
                }),
              ).rejects.toBeInstanceOf(BlockerLimitExceededError);

              return complete({ output: { approved: false } });
            });
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BlockerLimitExceededError);

    const jobs = await client.listChainJobs({ chainId: chain.id, limit: 10 });
    expect(jobs.items).toHaveLength(1);
    const [onlyJob] = jobs.items;
    expect(onlyJob.status).toBe("pending");
  });
};
