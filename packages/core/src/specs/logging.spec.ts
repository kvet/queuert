// oxlint-disable no-empty-pattern
import { it as baseIt, describe, expect } from "vitest";

import { sleep } from "../helpers/sleep.js";
import {
  type NotifyAdapter,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "../index.js";
import { extendWithStateInProcess } from "../state-adapter/state-adapter.in-process.spec-helper.js";
import { extendWithCommon, extendWithNotifyInProcess } from "../suites/spec-context.spec-helper.js";

type ExpectLogs = (
  expected: {
    type: string;
    data?: Record<string, unknown>;
    error?: unknown;
  }[],
) => void;

const it = extendWithNotifyInProcess(extendWithCommon(extendWithStateInProcess(baseIt))).extend<{
  expectLogs: ExpectLogs;
}>({
  expectLogs: [
    async ({ log }, use) => {
      await use((expected) => {
        expect(log.mock.calls.map((call) => call[0])).toEqual(
          expected.map((entry) => {
            const matcher: Record<string, unknown> = { type: entry.type };
            if (entry.data) {
              matcher.data = expect.objectContaining(entry.data);
            }
            if (entry.error !== undefined) {
              matcher.error = entry.error;
            }
            return expect.objectContaining(matcher);
          }),
        );
      });
    },
    { scope: "test" },
  ],
});

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};

describe("Logging", () => {
  it("logs simple job lifecycle", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectLogs,
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
            attemptHandler: async ({ prepare, complete }) => {
              await prepare({ mode: "staged" });
              return complete(async ({ finish }) => finish({ output: { result: true } }));
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
          input: { test: true },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    const workerArgs = {
      workerId: expect.stringMatching(/^worker-[0-9a-f-]{36}$/) as unknown as string,
    };
    const chainArgs = {
      typeName: "test",
      id: chain.id,
    };
    const jobArgs = {
      typeName: "test",
      id: chain.id,
      chainId: chain.id,
      chainTypeName: "test",
    };
    expectLogs([
      { type: "chain_created", data: { ...chainArgs, input: { test: true } } },
      { type: "job_created", data: { ...jobArgs, input: { test: true } } },
      { type: "worker_started", data: { ...workerArgs, jobTypeNames: ["test"] } },
      {
        type: "job_attempt_started",
        data: { ...jobArgs, status: "running", attempt: 1, ...workerArgs },
      },
      {
        type: "job_completed",
        data: {
          ...jobArgs,
          status: "completed",
          attempt: 1,
          output: { result: true },
          ...workerArgs,
        },
      },
      {
        type: "chain_completed",
        data: { ...chainArgs, output: { result: true } },
      },
      {
        type: "job_attempt_completed",
        data: {
          ...jobArgs,
          status: "running",
          attempt: 1,
          output: { result: true },
          ...workerArgs,
        },
      },
      { type: "worker_stopping", data: { ...workerArgs } },
      { type: "worker_stopped", data: { ...workerArgs } },
    ]);
  });

  it("logs retry failures with backoff", async ({
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
          initialDelayMs: 10,
          multiplier: 2.0,
          maxDelayMs: 100,
        },
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt < 4) {
                throw new Error("Unexpected error");
              }
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const job = await withTransactionHooks(async (transactionHooks) =>
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
      await client.awaitChain(job, completionOptions);
    });

    const logs = log.mock.calls.map((call) => call[0]);

    const failedLogs = logs.filter((entry) => entry.type === "job_attempt_failed");
    expect(failedLogs).toEqual([
      expect.objectContaining({ type: "job_attempt_failed", error: expect.anything() }),
      expect.objectContaining({ type: "job_attempt_failed", error: expect.anything() }),
      expect.objectContaining({ type: "job_attempt_failed", error: expect.anything() }),
    ]);
    expect(failedLogs).not.toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({ scheduleAfterMs: expect.anything() }),
      }),
    );

    const rescheduledLogs = logs.filter((entry) => entry.type === "job_rescheduled");
    expect(rescheduledLogs).toEqual([
      expect.objectContaining({
        type: "job_rescheduled",
        data: expect.objectContaining({ scheduledAt: expect.any(Date) }),
      }),
      expect.objectContaining({
        type: "job_rescheduled",
        data: expect.objectContaining({ scheduledAt: expect.any(Date) }),
      }),
      expect.objectContaining({
        type: "job_rescheduled",
        data: expect.objectContaining({ scheduledAt: expect.any(Date) }),
      }),
    ]);
  });

  it("logs chain continuations", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectLogs,
  }) => {
    const jobTypes = defineJobTypes<{
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
          linear: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async ({ finish }) =>
                finish({
                  continueWith: {
                    typeName: "linear_next",
                    input: { valueNext: job.input.value + 1 },
                  },
                }),
              );
            },
          },
          linear_next: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async ({ finish }) =>
                finish({
                  continueWith: {
                    typeName: "linear_next_next",
                    input: { valueNextNext: job.input.valueNext + 1 },
                  },
                }),
              );
            },
          },
          linear_next_next: {
            attemptHandler: async ({ job, complete }) =>
              complete(async ({ finish }) =>
                finish({ output: { result: job.input.valueNextNext } }),
              ),
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "linear",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expectLogs([
      { type: "chain_created", data: { typeName: "linear" } },
      { type: "job_created", data: { typeName: "linear" } },
      { type: "worker_started" },
      { type: "job_attempt_started", data: { typeName: "linear" } },
      {
        type: "job_created",
        data: {
          typeName: "linear_next",
          chainId: chain.id,
          chainTypeName: "linear",
        },
      },
      { type: "job_completed", data: { typeName: "linear" } },
      { type: "job_attempt_completed", data: { typeName: "linear" } },
      { type: "job_attempt_started", data: { typeName: "linear_next" } },
      {
        type: "job_created",
        data: {
          typeName: "linear_next_next",
          chainId: chain.id,
          chainTypeName: "linear",
        },
      },
      { type: "job_completed", data: { typeName: "linear_next" } },
      { type: "job_attempt_completed", data: { typeName: "linear_next" } },
      { type: "job_attempt_started", data: { typeName: "linear_next_next" } },
      { type: "job_completed", data: { typeName: "linear_next_next" } },
      { type: "chain_completed", data: { typeName: "linear" } },
      { type: "job_attempt_completed", data: { typeName: "linear_next_next" } },
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);
  });

  it("logs blocker chains", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectLogs,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: { value: number };
        output: { done: true };
        continueWith: { typeName: "blocker" };
      };
      main: {
        entry: true;
        input: { start: boolean };
        output: { finalResult: number };
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
    let blockerChainId: string;

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) =>
              complete(async ({ finish }) =>
                job.input.value < 1
                  ? finish({
                      continueWith: {
                        typeName: "blocker",
                        input: { value: job.input.value + 1 },
                      },
                    })
                  : finish({ output: { done: true } }),
              ),
          },
          main: {
            attemptHandler: async ({
              job: {
                blockers: [blocker],
                input,
              },
              complete,
            }) =>
              complete(async ({ finish }) =>
                finish({
                  output: {
                    finalResult: (blocker.output.done ? 1 : 0) + (input.start ? 1 : 0),
                  },
                }),
              ),
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => {
        const dependencyChain = await client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 0 },
        });
        blockerChainId = dependencyChain.id;

        const chain = await client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: { start: true },
          blockers: [dependencyChain],
        });

        return chain;
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expectLogs([
      {
        type: "chain_created",
        data: {
          typeName: "blocker",
        },
      },
      { type: "job_created", data: { typeName: "blocker" } },
      { type: "chain_created", data: { typeName: "main" } },
      {
        type: "job_created",
        data: {
          typeName: "main",
          blockers: [
            {
              id: blockerChainId!,
              typeName: "blocker",
            },
          ],
        },
      },
      {
        type: "job_blocked",
        data: {
          typeName: "main",
          blockedByChains: [
            {
              id: blockerChainId!,
              typeName: "blocker",
            },
          ],
        },
      },
      { type: "worker_started" },
      { type: "job_attempt_started", data: { typeName: "blocker" } },
      { type: "job_created", data: { typeName: "blocker" } },
      { type: "job_completed", data: { typeName: "blocker" } },
      { type: "job_attempt_completed", data: { typeName: "blocker" } },
      { type: "job_attempt_started", data: { typeName: "blocker" } },
      { type: "job_completed", data: { typeName: "blocker" } },
      { type: "chain_completed", data: { typeName: "blocker" } },
      {
        type: "job_unblocked",
        data: {
          typeName: "main",
          unblockedByChain: {
            id: blockerChainId!,
            typeName: "blocker",
          },
        },
      },
      { type: "job_attempt_completed", data: { typeName: "blocker" } },
      { type: "job_attempt_started", data: { typeName: "main" } },
      { type: "job_completed", data: { typeName: "main" } },
      { type: "chain_completed", data: { typeName: "main" } },
      { type: "job_attempt_completed", data: { typeName: "main" } },
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);
  });

  it("logs workerless completion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectLogs,
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

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) => {
            return completeJob(job, async ({ finish }) => finish({ output: { result: 84 } }));
          },
        }),
      ),
    );

    expectLogs([
      { type: "chain_created", data: { input: { value: 42 } } },
      { type: "job_created", data: { input: { value: 42 } } },
      { type: "job_completed", data: { output: { result: 84 }, workerId: null } },
      { type: "chain_completed", data: { output: { result: 84 } } },
    ]);
  });

  it("logs attempt extension", async ({
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
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig: { timeoutMs: 500, heartbeatMs: 50 },
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              await sleep(200);
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    const renewalLogs = log.mock.calls
      .map((call) => call[0])
      .filter((entry) => entry.type === "job_attempt_extended");

    expect(renewalLogs.length).toBeGreaterThanOrEqual(1);
    expect(renewalLogs[0]).toEqual(
      expect.objectContaining({
        type: "job_attempt_extended",
        data: expect.objectContaining({ typeName: "test" }),
      }),
    );
  });

  it("logs attempt expiration", async ({
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
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig: { timeoutMs: 10, heartbeatMs: 100 },
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              await sleep(100);
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    const expiredLogs = log.mock.calls
      .map((call) => call[0])
      .filter((entry) => entry.type === "job_attempt_expired");

    expect(expiredLogs.length).toBeGreaterThanOrEqual(1);
    expect(expiredLogs[0]).toEqual(
      expect.objectContaining({
        type: "job_attempt_expired",
        level: "warn",
        data: expect.objectContaining({ typeName: "test" }),
      }),
    );
  });

  it("logs attempt reclaim events", async ({
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

    let failed = false;
    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();
    const attemptConfig = { timeoutMs: 10, heartbeatMs: 100 };

    const worker1 = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: attemptConfig.timeoutMs,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig,
        processors: {
          test: {
            attemptHandler: async ({ signal, complete }) => {
              if (!failed) {
                failed = true;
                jobStarted.resolve();
                try {
                  await sleep(attemptConfig.heartbeatMs * 2, { signal });
                } finally {
                  jobCompleted.resolve();
                }
              }
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });
    const worker2 = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: attemptConfig.timeoutMs,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig,
        processors: {
          test: {
            attemptHandler: async ({ signal, complete }) => {
              if (!failed) {
                failed = true;
                jobStarted.resolve();
                try {
                  await sleep(attemptConfig.heartbeatMs * 2, { signal });
                } finally {
                  jobCompleted.resolve();
                }
              }
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      await jobStarted.promise;
      await sleep(10);

      const successChain = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
        ),
      );

      await Promise.all([
        client.awaitChain(chain, completionOptions),
        client.awaitChain(successChain, completionOptions),
      ]);
      await jobCompleted.promise;
    });

    const logTypes = new Set(log.mock.calls.map((call) => call[0].type));
    expect(logTypes).toContain("job_attempt_reclaimed");
    expect(
      logTypes.has("job_attempt_taken_by_another_worker") ||
        logTypes.has("job_attempt_already_completed"),
    ).toBe(true);
  });

  it("logs state adapter and worker errors", async ({
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

    // Wrap startJobAttempt to throw once — triggers both
    // state_adapter_error (from logging middleware) and worker_error (from worker loop catch)
    let errorThrown = false;
    const erroringStateAdapter: typeof stateAdapter = {
      ...stateAdapter,
      startJobAttempt: async (args) => {
        if (!errorThrown) {
          errorThrown = true;
          throw new Error("connection error");
        }
        return stateAdapter.startJobAttempt(args);
      },
    };

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: erroringStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      recoveryBackoffConfig: { initialDelayMs: 10, multiplier: 1, maxDelayMs: 10 },
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    const logTypes = new Set(log.mock.calls.map((call) => call[0].type));
    expect(logTypes).toContain("state_adapter_error");
    expect(logTypes).toContain("worker_error");
  });

  it("logs notify adapter errors", async ({
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

    const failingNotifyAdapter: NotifyAdapter = {
      ...notifyAdapter!,
      notifyJobScheduled: async () => {
        throw new Error("notify error");
      },
    };

    const client = await createClient({
      stateAdapter,
      notifyAdapter: failingNotifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 100,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, {
        pollIntervalMs: 100,
        timeoutMs: 5000,
      });
    });

    const notifyErrorLogs = log.mock.calls
      .map((call) => call[0])
      .filter((entry) => entry.type === "notify_adapter_error");

    expect(notifyErrorLogs.length).toBeGreaterThanOrEqual(1);
    expect(notifyErrorLogs[0]).toEqual(
      expect.objectContaining({
        type: "notify_adapter_error",
        level: "warn",
        data: expect.objectContaining({ operation: "notifyJobScheduled" }),
        error: expect.anything(),
      }),
    );
  });
});

describe("Logging rollback", () => {
  it("discards creation events on rollback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
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

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => {
        await client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null });
        throw new Error("simulated rollback");
      }),
    ).catch(() => {});

    const logTypes = log.mock.calls.map((call) => call[0].type);
    expect(logTypes).not.toContain("chain_created");
    expect(logTypes).not.toContain("job_created");
  });

  it("discards creation events with blockers on rollback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: { entry: true; input: null; output: null };
      main: {
        entry: true;
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

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => {
        const blocker = await client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: null,
        });
        await client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: null,
          blockers: [blocker],
        });
        throw new Error("simulated rollback");
      }),
    ).catch(() => {});

    const logTypes = log.mock.calls.map((call) => call[0].type);
    expect(logTypes).not.toContain("chain_created");
    expect(logTypes).not.toContain("job_created");
    expect(logTypes).not.toContain("job_blocked");
  });

  it("discards workerless completion events on rollback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { result: number } };
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
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    log.mockClear();

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => {
        await client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) =>
            completeJob(job, async ({ finish }) => finish({ output: { result: 42 } })),
        });
        throw new Error("simulated rollback");
      }),
    ).catch(() => {});

    const logTypes = log.mock.calls.map((call) => call[0].type);
    expect(logTypes).not.toContain("job_completed");
    expect(logTypes).not.toContain("chain_completed");
  });

  it("discards completion events on worker complete rollback", async ({
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

    let completeJobErrorThrown = false;
    const erroringStateAdapter: typeof stateAdapter = {
      ...stateAdapter,
      finishJobAttempt: async (args) => {
        if (!("error" in args.outcome) && !completeJobErrorThrown) {
          completeJobErrorThrown = true;
          throw new Error("simulated completeJob failure");
        }
        return stateAdapter.finishJobAttempt(args);
      },
    };

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: erroringStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      pollIntervalMs: 100,
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        processors: {
          test: {
            attemptHandler: async ({ complete }) =>
              complete(async ({ finish }) => finish({ output: null })),
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    const logEntries = log.mock.calls.map((call) => call[0]);
    const attemptCompletedCount = logEntries.filter(
      (e) => e.type === "job_attempt_completed",
    ).length;
    const jobCompletedCount = logEntries.filter((e) => e.type === "job_completed").length;
    const attemptFailedCount = logEntries.filter((e) => e.type === "job_attempt_failed").length;

    expect(attemptCompletedCount).toBe(1);
    expect(jobCompletedCount).toBe(1);
    expect(attemptFailedCount).toBe(1);
  });

  it("discards error-handling events on reschedule rollback", async ({
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

    let rescheduleErrorThrown = false;
    let handlerFailed = false;
    const erroringStateAdapter: typeof stateAdapter = {
      ...stateAdapter,
      finishJobAttempt: async (args) => {
        if ("error" in args.outcome && !rescheduleErrorThrown) {
          rescheduleErrorThrown = true;
          throw new Error("simulated abandonJob failure");
        }
        return stateAdapter.finishJobAttempt(args);
      },
    };

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: erroringStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      pollIntervalMs: 50,
      processors: createProcessors({
        client,
        jobTypes,
        attemptConfig: { timeoutMs: 50, heartbeatMs: 500 },
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              if (!handlerFailed) {
                handlerFailed = true;
                throw new Error("simulated handler failure");
              }
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    const logEntries = log.mock.calls.map((call) => call[0]);
    const attemptFailedCount = logEntries.filter((e) => e.type === "job_attempt_failed").length;
    expect(attemptFailedCount).toBe(0);
  });

  it("discards continuation events when user callback throws after continueWith", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      linear: {
        entry: true;
        input: null;
        continueWith: { typeName: "linear_next" };
      };
      linear_next: {
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

    let throwOnce = true;
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 100,
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        processors: {
          linear: {
            attemptHandler: async ({ complete }) =>
              complete(async ({ finish }) => {
                const result = await finish({
                  continueWith: { typeName: "linear_next", input: null },
                });
                if (throwOnce) {
                  throwOnce = false;
                  throw new Error("user error after continueWith");
                }
                return result;
              }),
          },
          linear_next: {
            attemptHandler: async ({ complete }) =>
              complete(async ({ finish }) => finish({ output: null })),
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "linear", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    const logEntries = log.mock.calls.map((call) => call[0]);
    const continuationCreated = logEntries.filter(
      (e) => e.type === "job_created" && e.data.typeName === "linear_next",
    );
    const attemptFailedCount = logEntries.filter((e) => e.type === "job_attempt_failed").length;
    const attemptCompletedCount = logEntries.filter(
      (e) => e.type === "job_attempt_completed" && e.data.typeName === "linear",
    ).length;

    expect(continuationCreated).toHaveLength(1);
    expect(attemptFailedCount).toBe(1);
    expect(attemptCompletedCount).toBe(1);
  });

  it("discards completion events on unblockJobs rollback", async ({
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

    let unblockErrorThrown = false;
    const erroringStateAdapter: typeof stateAdapter = {
      ...stateAdapter,
      unblockJobs: async (args) => {
        if (!unblockErrorThrown) {
          unblockErrorThrown = true;
          throw new Error("simulated unblockJobs failure");
        }
        return stateAdapter.unblockJobs(args);
      },
    };

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: erroringStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      pollIntervalMs: 100,
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        processors: {
          test: {
            attemptHandler: async ({ complete }) =>
              complete(async ({ finish }) => finish({ output: null })),
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    const logEntries = log.mock.calls.map((call) => call[0]);
    const attemptCompletedCount = logEntries.filter(
      (e) => e.type === "job_attempt_completed",
    ).length;
    const jobCompletedCount = logEntries.filter((e) => e.type === "job_completed").length;
    const chainCompletedCount = logEntries.filter((e) => e.type === "chain_completed").length;
    const attemptFailedCount = logEntries.filter((e) => e.type === "job_attempt_failed").length;

    expect(attemptCompletedCount).toBe(1);
    expect(jobCompletedCount).toBe(1);
    expect(chainCompletedCount).toBe(1);
    expect(attemptFailedCount).toBe(1);
  });

  it("discards workerless completion events on finishJob internal failure", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { result: number } };
    }>();

    let unblockErrorThrown = false;
    const erroringStateAdapter: typeof stateAdapter = {
      ...stateAdapter,
      unblockJobs: async (args) => {
        if (!unblockErrorThrown) {
          unblockErrorThrown = true;
          throw new Error("simulated unblockJobs failure");
        }
        return stateAdapter.unblockJobs(args);
      },
    };

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const erroringClient = await createClient({
      stateAdapter: erroringStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    log.mockClear();

    // First attempt: unblockJobs fails inside finishJob → entire transaction rolls back
    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        erroringClient.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) =>
            completeJob(job, async ({ finish }) => finish({ output: { result: 42 } })),
        }),
      ),
    ).catch(() => {});

    const logTypesAfterFailure = log.mock.calls.map((call) => call[0].type);
    expect(logTypesAfterFailure).not.toContain("job_completed");
    expect(logTypesAfterFailure).not.toContain("chain_completed");

    // Second attempt: succeeds
    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) =>
            completeJob(job, async ({ finish }) => finish({ output: { result: 42 } })),
        }),
      ),
    );

    const logEntries = log.mock.calls.map((call) => call[0]);
    const jobCompletedCount = logEntries.filter((e) => e.type === "job_completed").length;
    const chainCompletedCount = logEntries.filter((e) => e.type === "chain_completed").length;
    expect(jobCompletedCount).toBe(1);
    expect(chainCompletedCount).toBe(1);
  });

  it("discards continuation events on createJob rollback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      linear: {
        entry: true;
        input: null;
        continueWith: { typeName: "linear_next" };
      };
      linear_next: {
        input: null;
        output: null;
      };
    }>();

    let createJobErrorThrown = false;
    const erroringStateAdapter: typeof stateAdapter = {
      ...stateAdapter,
      createContinuationJob: async (args) => {
        if (!createJobErrorThrown) {
          createJobErrorThrown = true;
          throw new Error("simulated createJob failure");
        }
        return stateAdapter.createContinuationJob(args);
      },
    };

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: erroringStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      pollIntervalMs: 100,
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        processors: {
          linear: {
            attemptHandler: async ({ complete }) =>
              complete(async ({ finish }) =>
                finish({ continueWith: { typeName: "linear_next", input: null } }),
              ),
          },
          linear_next: {
            attemptHandler: async ({ complete }) =>
              complete(async ({ finish }) => finish({ output: null })),
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "linear", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    const logEntries = log.mock.calls.map((call) => call[0]);
    const continuationCreated = logEntries.filter(
      (e) => e.type === "job_created" && e.data.typeName === "linear_next",
    );
    const attemptFailedCount = logEntries.filter((e) => e.type === "job_attempt_failed").length;

    expect(continuationCreated).toHaveLength(1);
    expect(attemptFailedCount).toBe(1);
  });

  it("logs chain deletion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectLogs,
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.deleteChains({ ...txCtx, transactionHooks, ids: [chain.id] }),
      ),
    );

    expectLogs([
      { type: "chain_created", data: { typeName: "test" } },
      { type: "job_created", data: { typeName: "test" } },
      { type: "chain_deleted", data: { id: chain.id, typeName: "test" } },
    ]);
  });

  it("logs job reschedule", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectLogs,
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
          schedule: { afterMs: 60 * 60 * 1000 },
        }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.rescheduleJob({ ...txCtx, transactionHooks, id: chain.id }),
      ),
    );

    expectLogs([
      { type: "chain_created", data: { typeName: "test" } },
      { type: "job_created", data: { typeName: "test" } },
      {
        type: "job_rescheduled",
        data: { id: chain.id, typeName: "test", chainId: chain.id, chainTypeName: "test" },
      },
    ]);
  });
});
