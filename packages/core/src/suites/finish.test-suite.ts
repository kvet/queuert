import { type TestAPI } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { JobAlreadyCompletedError } from "../errors.js";
import { sleep } from "../helpers/sleep.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const finishTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };
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
