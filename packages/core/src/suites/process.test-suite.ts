import { type TestAPI, expectTypeOf } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { JobAlreadyCompletedError } from "../errors.js";
import { sleep } from "../helpers/sleep.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createSpyStateAdapter } from "../state-adapter/state-adapter.spy.spec-helper.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const processTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("throws error when finish is called incorrectly", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: null;
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    let finishAfterHandler: (() => Promise<unknown>) | undefined;
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ finish }) => {
              const result = await withTransaction(async (txCtx, transactionHooks) => {
                await expect(
                  finish({
                    ...txCtx,
                    transactionHooks,
                    output: null,
                    ...({ reschedule: { afterMs: 1 } } as object),
                  }),
                ).rejects.toThrow(
                  "finish requires exactly one of output, continueWith or reschedule",
                );
                await expect(
                  // @ts-expect-error transactionHooks is required
                  finish({ ...txCtx, output: null }),
                ).rejects.toThrow("finish requires transactionHooks");
                await expect(
                  // @ts-expect-error the caller's transaction context is required
                  finish({ transactionHooks, output: null }),
                ).rejects.toThrow(
                  "finish requires a transaction context from the caller's transaction",
                );

                return finish({ ...txCtx, transactionHooks, output: null });
              });
              finishAfterHandler = async () =>
                withTransaction(async (txCtx, transactionHooks) =>
                  finish({ ...txCtx, transactionHooks, output: null }),
                );
              return result;
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
      await client.awaitChain(chain, completionOptions);
    });

    await expect(finishAfterHandler!()).rejects.toThrow(
      "finish cannot be called after the attempt handler has ended",
    );
  });

  it("provides attempt information to job process", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        processors: {
          test: {
            attemptHandler: async ({ job, finish }) => {
              attempts.push(job.attempt);

              expectTypeOf(job.attempt).toEqualTypeOf<number>();
              expectTypeOf(job.lastAttemptAt).toEqualTypeOf<Date | null>();
              expectTypeOf(job.lastAttemptError).toEqualTypeOf<string | null>();

              expect(job.attempt).toBeGreaterThan(0);
              if (job.attempt > 1) {
                expect(job.lastAttemptAt).toBeInstanceOf(Date);
                expect(job.lastAttemptError).toContain("Error: Simulated failure");
              } else {
                expect(job.lastAttemptAt).toBeNull();
                expect(job.lastAttemptError).toBeNull();
              }

              if (job.attempt < 3) {
                throw new Error("Simulated failure");
              }

              return withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: null }),
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
        typeName: "test",
        input: null,
      }),
    );
    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(attempts).toEqual([1, 2, 3]);
  });

  it("clears lastAttemptError after a successful attempt following a failure", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: null;
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
        backoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        processors: {
          test: {
            attemptHandler: async ({ job, finish }) => {
              if (job.attempt < 2) {
                throw new Error("Simulated failure");
              }
              return withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: null }),
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
        typeName: "test",
        input: null,
      }),
    );
    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    const completedJob = await client.getJob({ id: chain.id });
    expect(completedJob?.status).toBe("completed");
    expect(completedJob?.lastAttemptError).toBeNull();
  });

  it("uses exponential backoff progression for repeated failures", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: {
          initialDelayMs: 10,
          multiplier: 2.0,
          maxDelayMs: 100,
        },
        processors: {
          test: {
            attemptHandler: async ({ job, finish }) => {
              if (job.lastAttemptError) {
                errors.push(job.lastAttemptError);
              }

              if (job.attempt < 4) {
                throw new Error("Unexpected error");
              }

              return withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const job = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(job, completionOptions);
    });

    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("Error: Unexpected error");
    expect(errors[1]).toContain("Error: Unexpected error");
    expect(errors[2]).toContain("Error: Unexpected error");
  });

  it("executes jobs", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      workerName: "worker",
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, finish }) => {
              expectTypeOf(job.typeName).toEqualTypeOf<"test">();
              expectTypeOf(job.input).toEqualTypeOf<{ test: boolean }>();
              expectTypeOf(job.status).toEqualTypeOf<"running">();
              expect(job.typeName).toBe("test");
              expect(job.input).toEqual({ test: true });
              expect(job.status).toBe("running");
              expect(job.id).toBeDefined();
              expect(job.chainId).toEqual(job.id);

              return withTransaction(async (txCtx, transactionHooks) => {
                expectTypeOf(txCtx).toEqualTypeOf<{ $test: true }>();

                const completedJob = await finish({
                  ...txCtx,
                  transactionHooks,
                  output: { result: true },
                });
                expectTypeOf(completedJob.typeName).toEqualTypeOf<"test">();
                expectTypeOf(completedJob.status).toEqualTypeOf<"completed">();
                expect(completedJob.typeName).toBe("test");
                expect(completedJob.status).toBe("completed");
                if (completedJob.status === "completed") {
                  expectTypeOf(completedJob.completedBy).toEqualTypeOf<string | null>();
                  expect(completedJob.completedBy).toMatch(/^worker-[0-9a-f-]{36}$/);
                }
                return completedJob;
              });
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
        input: { test: true },
      }),
    );
    // expectTypeOf<(typeof chain)["status"]>().toEqualTypeOf<"pending" | "blocked">();
    expectTypeOf<(typeof chain)["input"]>().toEqualTypeOf<{ test: boolean }>();
    expectTypeOf<(typeof chain)["typeName"]>().toEqualTypeOf<"test">();
    expect(chain.input).toEqual({ test: true });

    await withWorkers([await worker.start()], async () => {
      const completedChain = await client.awaitChain(chain, completionOptions);
      expectTypeOf<(typeof completedChain)["status"]>().toEqualTypeOf<"completed">();
      expectTypeOf<(typeof completedChain)["output"]>().toEqualTypeOf<{
        result: boolean;
      }>();
      expect(completedChain.status).toBe("completed");
      expect(completedChain.output).toEqual({ result: true });
    });

    const completedJob = await client.getJob({ id: chain.id });
    expect(completedJob?.status).toBe("completed");
    if (completedJob?.status === "completed") {
      expect(completedJob.completedBy).toMatch(/^worker-[0-9a-f-]{36}$/);
    }
  });

  it("finish should be visible to reads later in the same transaction", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      "output-then-read": {
        entry: true;
        input: null;
        output: { done: true };
      };
      "continue-then-read": {
        entry: true;
        input: null;
        continueWith: { typeName: "tail" };
      };
      tail: {
        input: null;
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
          "output-then-read": {
            attemptHandler: async ({ job, finish }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                const completedJob = await finish({
                  ...txCtx,
                  transactionHooks,
                  output: { done: true },
                });
                expect((await client.getJob({ ...txCtx, id: job.id }))?.status).toBe("completed");
                expect((await client.getChain({ ...txCtx, id: job.chainId }))?.status).toBe(
                  "completed",
                );
                return completedJob;
              }),
          },
          "continue-then-read": {
            attemptHandler: async ({ job, finish }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                const completedJob = await finish({
                  ...txCtx,
                  transactionHooks,
                  continueWith: { typeName: "tail", input: null },
                });
                expect((await client.getJob({ ...txCtx, id: job.id }))?.status).toBe("completed");
                return completedJob;
              }),
          },
          tail: {
            attemptHandler: async ({ finish }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: { done: true } }),
              ),
          },
        },
      }),
    });

    const [completedChain, continuedChain] = await withTransaction(
      async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "output-then-read", input: null },
            { typeName: "continue-then-read", input: null },
          ],
        }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(completedChain, completionOptions);
      await client.awaitChain(continuedChain, completionOptions);
    });
  });

  const slowBackoff = { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 };

  it("rolls back finish with the caller's transaction and reschedules the attempt", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
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
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: slowBackoff,
        processors: {
          test: {
            attemptHandler: async ({ finish }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                await finish({ ...txCtx, transactionHooks, output: null });
                throw new Error("rollback after finish");
              }),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await expect
        .poll(async () => (await client.getJob({ id: chain.id }))?.status, { timeout: 5000 })
        .toBe("pending");
    });

    const job = await client.getJob({ id: chain.id });
    expect(job?.attempt).toBe(1);
    expect(job?.lastAttemptError).toContain("rollback after finish");
  });

  it("keeps a committed finish when the handler throws afterwards", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      complete: { entry: true; input: null; output: { done: true } };
      reschedule: { entry: true; input: null; output: null };
    }>();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    let rescheduleAttempts = 0;
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: slowBackoff,
        processors: {
          complete: {
            attemptHandler: async ({ finish }) => {
              await withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: { done: true } }),
              );
              throw new Error("after a committed finish");
            },
          },
          reschedule: {
            attemptHandler: async ({ finish }) => {
              rescheduleAttempts++;
              await withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, reschedule: { afterMs: 60_000 } }),
              );
              throw new Error("after a committed reschedule");
            },
          },
        },
      }),
    });

    const [completeChain, rescheduleChain] = await withTransaction(
      async (txCtx, transactionHooks) =>
        Promise.all([
          client.createChain({ ...txCtx, transactionHooks, typeName: "complete", input: null }),
          client.createChain({ ...txCtx, transactionHooks, typeName: "reschedule", input: null }),
        ]),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(completeChain, completionOptions);
      expect(completed.output).toEqual({ done: true });
      await expect.poll(() => rescheduleAttempts, { timeout: 5000 }).toBe(1);
      await sleep(100);
    });

    const rescheduled = await client.getJob({ id: rescheduleChain.id });
    expect(rescheduled?.status).toBe("pending");
    expect(rescheduled?.lastAttemptError).toBeNull();
  });

  it("treats a handler that returns without a committed finish as a failed attempt", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
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
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: slowBackoff,
        processors: {
          test: {
            // @ts-expect-error the handler must return what finish returned
            attemptHandler: async () => {},
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await expect
        .poll(async () => (await client.getJob({ id: chain.id }))?.status, { timeout: 5000 })
        .toBe("pending");
    });

    const job = await client.getJob({ id: chain.id });
    expect(job?.lastAttemptError).toContain("Attempt handler returned without a committed finish");
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ type: "job_attempt_failed" }));
  });

  it("writes nothing when finish fails validation, so the caller may catch and finish again", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: { entry: true; input: null; output: null };
      test: { entry: true; input: null; continueWith: { typeName: "next" } };
      next: { input: null; output: null; blockers: [{ typeName: "blocker" }] };
    }>();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    let caughtError: unknown;
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ finish }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: null }),
              ),
          },
          test: {
            attemptHandler: async ({ finish }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                try {
                  await finish({
                    ...txCtx,
                    transactionHooks,
                    continueWith: {
                      typeName: "next",
                      input: null,
                      blockers: [
                        {
                          id: crypto.randomUUID(),
                          typeName: "blocker",
                          input: null,
                        } as never,
                      ],
                    },
                  });
                } catch (error) {
                  caughtError = error;
                }
                const blockerChain = await client.createChain({
                  ...txCtx,
                  transactionHooks,
                  typeName: "blocker",
                  input: null,
                });
                return finish({
                  ...txCtx,
                  transactionHooks,
                  continueWith: { typeName: "next", input: null, blockers: [blockerChain] },
                });
              }),
          },
          next: {
            attemptHandler: async ({ finish }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: null }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(caughtError).toBeDefined();
    const jobs = await client.listChainJobs({ chainId: chain.id });
    expect(jobs.items.map((job) => job.typeName)).toEqual(["test", "next"]);
  });

  it("lets the last finish win when the transaction callback is retried", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { try: number } };
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
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ finish }) =>
              withTransactionHooks(async (transactionHooks) => {
                for (let attempt = 1; ; attempt++) {
                  try {
                    return await stateAdapter.withTransaction(async (txCtx) => {
                      const result = await finish({
                        ...txCtx,
                        transactionHooks,
                        output: { try: attempt },
                      });
                      if (attempt === 1) throw new Error("serialization failure");
                      return result;
                    });
                  } catch (error) {
                    if (attempt > 1) throw error;
                  }
                }
              }),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ try: 2 });
    });

    const completedLogs = log.mock.calls
      .map((call) => call[0])
      .filter((entry) => entry.type === "job_completed");
    expect(completedLogs).toHaveLength(1);
    expect(completedLogs[0].data).toEqual(expect.objectContaining({ output: { try: 2 } }));
  });

  it("trusts a committed finish returned by the handler without rescheduling", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);
    const client = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ finish }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: null }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(spyStateAdapter.calls.map((call) => call.name)).not.toContain("rescheduleJobs");
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ type: "job_attempt_completed" }));
  });

  it("reschedules the attempt when finish rolls back in a savepoint", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withSavepoint,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
    skip,
  }) => {
    if (!withSavepoint) return skip();

    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
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
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: slowBackoff,
        processors: {
          test: {
            attemptHandler: async ({ finish }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                let receipt: Awaited<ReturnType<typeof finish>> | undefined;
                try {
                  await withSavepoint(txCtx, transactionHooks, async (txCtx, transactionHooks) => {
                    receipt = await finish({ ...txCtx, transactionHooks, output: null });
                    throw new Error("rollback to savepoint");
                  });
                } catch {}
                return receipt!;
              }),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await expect
        .poll(async () => (await client.getJob({ id: chain.id }))?.status, { timeout: 5000 })
        .toBe("pending");
    });

    const job = await client.getJob({ id: chain.id });
    expect(job?.lastAttemptError).toContain("Attempt handler returned without a committed finish");
    expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ type: "job_completed" }));
  });

  it("commits the finish made after one rolled back in a savepoint", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withSavepoint,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
    skip,
  }) => {
    if (!withSavepoint) return skip();

    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { from: string } };
    }>();
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);
    const client = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ finish }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                try {
                  await withSavepoint(txCtx, transactionHooks, async (txCtx, transactionHooks) => {
                    await finish({ ...txCtx, transactionHooks, output: { from: "savepoint" } });
                    throw new Error("rollback to savepoint");
                  });
                } catch {}
                return finish({ ...txCtx, transactionHooks, output: { from: "transaction" } });
              }),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ from: "transaction" });
    });

    expect(spyStateAdapter.calls.map((call) => call.name)).not.toContain("rescheduleJobs");
    const completedLogs = log.mock.calls
      .map((call) => call[0])
      .filter((entry) => entry.type === "job_completed");
    expect(completedLogs).toHaveLength(1);
    expect(completedLogs[0].data).toEqual(
      expect.objectContaining({ output: { from: "transaction" } }),
    );
  });

  it("keeps the attempt alive when a renewal lands after its own committed finish", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    let abortedReason: unknown;
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig: { timeoutMs: 1000, heartbeatMs: 20 },
        processors: {
          test: {
            attemptHandler: async ({ signal, finish }) => {
              const result = await withTransaction(async (txCtx, transactionHooks) => {
                const finished = await finish({ ...txCtx, transactionHooks, output: null });
                await sleep(60);
                return finished;
              });
              await sleep(100);
              abortedReason = signal.reason;
              return result;
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
      await expect.poll(() => abortedReason, { timeout: 5000 }).toBeUndefined();
      await sleep(200);
    });

    expect(abortedReason).toBeUndefined();
    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "job_attempt_taken_by_another_worker" }),
    );
  });

  it("fails finish and aborts the signal after a workerless takeover", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { by: string } };
    }>();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const { promise: started, resolve: onStarted } = Promise.withResolvers<void>();
    const { promise: takenOver, resolve: onTakenOver } = Promise.withResolvers<void>();
    let finishError: unknown;
    let abortReason: unknown;
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ signal, finish }) => {
              onStarted();
              await takenOver;
              try {
                return await withTransaction(async (txCtx, transactionHooks) =>
                  finish({ ...txCtx, transactionHooks, output: { by: "worker" } }),
                );
              } catch (error) {
                finishError = error;
                abortReason = signal.reason;
                throw error;
              }
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await started;
      await withTransaction(async (txCtx, transactionHooks) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) =>
            completeJob(job, async ({ finish }) => finish({ output: { by: "workerless" } })),
        }),
      );
      onTakenOver();
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ by: "workerless" });
      await expect.poll(() => finishError, { timeout: 5000 }).toBeDefined();
    });

    expect(finishError).toBeInstanceOf(JobAlreadyCompletedError);
    expect(abortReason).toBe("already_completed");
  });

  it("reads blockers on demand, with or without a transaction", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: { entry: true; input: { value: number }; output: { value: number } };
      test: {
        entry: true;
        input: null;
        output: { sum: number };
        blockers: [{ typeName: "blocker" }, { typeName: "blocker" }];
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
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, finish }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                finish({ ...txCtx, transactionHooks, output: { value: job.input.value } }),
              ),
          },
          test: {
            attemptHandler: async ({ getBlockers, finish }) => {
              const outside = await getBlockers();
              return withTransaction(async (txCtx, transactionHooks) => {
                const inside = await getBlockers(txCtx);
                expect(inside.map((blocker) => blocker.id)).toEqual(
                  outside.map((blocker) => blocker.id),
                );
                const [first, second] = inside;
                return finish({
                  ...txCtx,
                  transactionHooks,
                  output: { sum: first.output.value + second.output.value },
                });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) => {
      const [first, second] = await Promise.all([
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 1 },
        }),
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 2 },
        }),
      ]);
      return client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
        blockers: [first, second],
      });
    });

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ sum: 3 });
    });
  });
};
