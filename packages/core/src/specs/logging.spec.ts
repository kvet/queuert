// oxlint-disable no-empty-pattern
import { sleep } from "../helpers/sleep.js";
import {
  type NotifyAdapter,
  createClient,
  createInProcessWorker,
  defineJobTypes,
} from "../index.js";
import { extendWithStateInProcess } from "../state-adapter/state-adapter.in-process.spec-helper.js";
import { extendWithCommon, extendWithNotifyInProcess } from "../suites/spec-context.spec-helper.js";
import { it as baseIt, describe } from "vitest";

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
    async ({ log, expect }, use) => {
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
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectLogs,
  }) => {
    const registry = defineJobTypes<{
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
          attemptHandler: async ({ prepare, complete }) => {
            await prepare({ mode: "staged" });
            return complete(async () => ({ result: true }));
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { test: true },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);
    });

    const workerArgs = { workerId: "worker" };
    const jobChainArgs = {
      typeName: "test",
      id: jobChain.id,
      originId: null,
    };
    const jobArgs = {
      typeName: "test",
      id: jobChain.id,
      originId: null,
      chainId: jobChain.id,
      chainTypeName: "test",
    };
    expectLogs([
      { type: "job_chain_created", data: { ...jobChainArgs, input: { test: true } } },
      { type: "job_created", data: { ...jobArgs, input: { test: true } } },
      { type: "worker_started", data: { ...workerArgs, jobTypeNames: ["test"] } },
      {
        type: "job_attempt_started",
        data: { ...jobArgs, status: "running", attempt: 1, ...workerArgs },
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
        type: "job_chain_completed",
        data: { ...jobChainArgs, output: { result: true } },
      },
      { type: "worker_stopping", data: { ...workerArgs } },
      { type: "worker_stopped", data: { ...workerArgs } },
    ]);
  });

  it("logs retry failures with backoff", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processDefaults: {
        retryConfig: {
          initialDelayMs: 10,
          multiplier: 2.0,
          maxDelayMs: 100,
        },
      },
      processors: {
        test: {
          attemptHandler: async ({ job, complete }) => {
            if (job.attempt < 4) {
              throw new Error("Unexpected error");
            }
            return complete(async () => null);
          },
        },
      },
    });

    const job = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(job, completionOptions);
    });

    const failedLogs = log.mock.calls
      .map((call) => call[0])
      .filter((entry) => entry.type === "job_attempt_failed");

    expect(failedLogs).toEqual([
      expect.objectContaining({
        type: "job_attempt_failed",
        data: expect.objectContaining({ rescheduledAfterMs: 10 }),
        error: expect.anything(),
      }),
      expect.objectContaining({
        type: "job_attempt_failed",
        data: expect.objectContaining({ rescheduledAfterMs: 20 }),
        error: expect.anything(),
      }),
      expect.objectContaining({
        type: "job_attempt_failed",
        data: expect.objectContaining({ rescheduledAfterMs: 40 }),
        error: expect.anything(),
      }),
    ]);
  });

  it("logs chain continuations", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectLogs,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });
    const originIds: string[] = [];

    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        linear: {
          attemptHandler: async ({ job, complete }) => {
            originIds.push(job.id);
            return complete(async ({ continueWith }) =>
              continueWith({
                typeName: "linear_next",
                input: { valueNext: job.input.value + 1 },
              }),
            );
          },
        },
        linear_next: {
          attemptHandler: async ({ job, complete }) => {
            originIds.push(job.id);
            return complete(async ({ continueWith }) =>
              continueWith({
                typeName: "linear_next_next",
                input: { valueNextNext: job.input.valueNext + 1 },
              }),
            );
          },
        },
        linear_next_next: {
          attemptHandler: async ({ job, complete }) =>
            complete(async () => ({
              result: job.input.valueNextNext,
            })),
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "linear",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);
    });

    expectLogs([
      { type: "job_chain_created", data: { typeName: "linear" } },
      { type: "job_created", data: { typeName: "linear" } },
      { type: "worker_started" },
      { type: "job_attempt_started", data: { typeName: "linear" } },
      {
        type: "job_created",
        data: {
          typeName: "linear_next",
          chainId: jobChain.id,
          chainTypeName: "linear",
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
          chainId: jobChain.id,
          chainTypeName: "linear",
          originId: originIds[1],
        },
      },
      { type: "job_attempt_completed", data: { typeName: "linear_next" } },
      { type: "job_completed", data: { typeName: "linear_next" } },
      { type: "job_attempt_started", data: { typeName: "linear_next_next" } },
      { type: "job_attempt_completed", data: { typeName: "linear_next_next" } },
      { type: "job_completed", data: { typeName: "linear_next_next" } },
      { type: "job_chain_completed", data: { typeName: "linear" } },
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);
  });

  it("logs blocker chains", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectLogs,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });
    let blockerChainId: string;

    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        blocker: {
          attemptHandler: async ({ job, complete }) =>
            complete(async ({ continueWith }) =>
              job.input.value < 1
                ? continueWith({
                    typeName: "blocker",
                    input: { value: job.input.value + 1 },
                  })
                : { done: true },
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
            complete(async () => ({
              finalResult: (blocker.output.done ? 1 : 0) + (input.start ? 1 : 0),
            })),
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) => {
        const dependencyJobChain = await client.startJobChain({
          ...txContext,
          typeName: "blocker",
          input: { value: 0 },
        });
        blockerChainId = dependencyJobChain.id;

        const jobChain = await client.startJobChain({
          ...txContext,
          typeName: "main",
          input: { start: true },
          blockers: [dependencyJobChain],
        });

        return jobChain;
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);
    });

    expectLogs([
      {
        type: "job_chain_created",
        data: {
          typeName: "blocker",
          originId: null,
        },
      },
      { type: "job_created", data: { typeName: "blocker" } },
      { type: "job_chain_created", data: { typeName: "main" } },
      {
        type: "job_created",
        data: {
          typeName: "main",
          blockers: [
            {
              id: blockerChainId!,
              typeName: "blocker",
              originId: null,
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
              originId: null,
            },
          ],
        },
      },
      { type: "worker_started" },
      { type: "job_attempt_started", data: { typeName: "blocker" } },
      { type: "job_created", data: { typeName: "blocker" } },
      { type: "job_attempt_completed", data: { typeName: "blocker" } },
      { type: "job_completed", data: { typeName: "blocker" } },
      { type: "job_attempt_started", data: { typeName: "blocker" } },
      { type: "job_attempt_completed", data: { typeName: "blocker" } },
      { type: "job_completed", data: { typeName: "blocker" } },
      { type: "job_chain_completed", data: { typeName: "blocker" } },
      {
        type: "job_unblocked",
        data: {
          typeName: "main",
          unblockedByChain: {
            id: blockerChainId!,
            typeName: "blocker",
            originId: null,
          },
        },
      },
      { type: "job_attempt_started", data: { typeName: "main" } },
      { type: "job_attempt_completed", data: { typeName: "main" } },
      { type: "job_completed", data: { typeName: "main" } },
      { type: "job_chain_completed", data: { typeName: "main" } },
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);
  });

  it("logs workerless completion", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expectLogs,
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

    await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.completeJobChain({
          ...txContext,
          typeName: "test",
          id: jobChain.id,
          complete: async ({ job, complete }) => {
            return complete(job, async () => ({ result: 84 }));
          },
        }),
      ),
    );

    expectLogs([
      { type: "job_chain_created", data: { input: { value: 42 } } },
      { type: "job_created", data: { input: { value: 42 } } },
      { type: "job_completed", data: { output: { result: 84 }, workerId: null } },
      { type: "job_chain_completed", data: { output: { result: 84 } } },
    ]);
  });

  it("logs notify context absence", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    // Create job WITHOUT withNotify — triggers notify_context_absence
    await runInTransaction(async (txContext) =>
      client.startJobChain({ ...txContext, typeName: "test", input: null }),
    );

    const absenceLogs = log.mock.calls
      .map((call) => call[0])
      .filter((entry) => entry.type === "notify_context_absence");

    expect(absenceLogs).toHaveLength(1);
    expect(absenceLogs[0]).toEqual(
      expect.objectContaining({
        type: "notify_context_absence",
        level: "warn",
        data: expect.objectContaining({ typeName: "test" }),
      }),
    );
  });

  it("logs lease renewal", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
      test: { entry: true; input: null; output: null };
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
      processDefaults: {
        leaseConfig: { leaseMs: 500, renewIntervalMs: 50 },
      },
      processors: {
        test: {
          attemptHandler: async ({ complete }) => {
            await sleep(200);
            return complete(async () => null);
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({ ...txContext, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);
    });

    const renewalLogs = log.mock.calls
      .map((call) => call[0])
      .filter((entry) => entry.type === "job_attempt_lease_renewed");

    expect(renewalLogs.length).toBeGreaterThanOrEqual(1);
    expect(renewalLogs[0]).toEqual(
      expect.objectContaining({
        type: "job_attempt_lease_renewed",
        data: expect.objectContaining({ typeName: "test" }),
      }),
    );
  });

  it("logs lease expiration", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
      test: { entry: true; input: null; output: null };
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
      processDefaults: {
        leaseConfig: { leaseMs: 10, renewIntervalMs: 100 },
      },
      processors: {
        test: {
          attemptHandler: async ({ complete }) => {
            await sleep(100);
            return complete(async () => null);
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({ ...txContext, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);
    });

    const expiredLogs = log.mock.calls
      .map((call) => call[0])
      .filter((entry) => entry.type === "job_attempt_lease_expired");

    expect(expiredLogs.length).toBeGreaterThanOrEqual(1);
    expect(expiredLogs[0]).toEqual(
      expect.objectContaining({
        type: "job_attempt_lease_expired",
        level: "warn",
        data: expect.objectContaining({ typeName: "test" }),
      }),
    );
  });

  it("logs reaper events", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    let failed = false;
    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();
    const leaseConfig = { leaseMs: 10, renewIntervalMs: 100 };

    const worker1 = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      workerId: "w1",
      concurrency: 1,
      processDefaults: { leaseConfig, pollIntervalMs: leaseConfig.leaseMs },
      processors: {
        test: {
          attemptHandler: async ({ signal, complete }) => {
            if (!failed) {
              failed = true;
              jobStarted.resolve();
              try {
                await sleep(leaseConfig.renewIntervalMs * 2, { signal });
              } finally {
                jobCompleted.resolve();
              }
            }
            return complete(async () => null);
          },
        },
      },
    });
    const worker2 = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      workerId: "w2",
      concurrency: 1,
      processDefaults: { leaseConfig, pollIntervalMs: leaseConfig.leaseMs },
      processors: {
        test: {
          attemptHandler: async ({ signal, complete }) => {
            if (!failed) {
              failed = true;
              jobStarted.resolve();
              try {
                await sleep(leaseConfig.renewIntervalMs * 2, { signal });
              } finally {
                jobCompleted.resolve();
              }
            }
            return complete(async () => null);
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({ ...txContext, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      await jobStarted.promise;
      await sleep(10);

      const successJob = await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.startJobChain({ ...txContext, typeName: "test", input: null }),
        ),
      );

      await Promise.all([
        client.waitForJobChainCompletion(jobChain, completionOptions),
        client.waitForJobChainCompletion(successJob, completionOptions),
      ]);
      await jobCompleted.promise;
    });

    const logTypes = new Set(log.mock.calls.map((call) => call[0].type));
    expect(logTypes).toContain("job_reaped");
    expect(
      logTypes.has("job_attempt_taken_by_another_worker") ||
        logTypes.has("job_attempt_already_completed"),
    ).toBe(true);
  });

  it("logs state adapter and worker errors", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    // Wrap getNextJobAvailableInMs to throw once — triggers both
    // state_adapter_error (from logging wrapper) and worker_error (from worker loop catch)
    let errorThrown = false;
    const erroringStateAdapter: typeof stateAdapter = {
      ...stateAdapter,
      getNextJobAvailableInMs: async (args) => {
        if (!errorThrown) {
          errorThrown = true;
          throw new Error("connection error");
        }
        return stateAdapter.getNextJobAvailableInMs(args);
      },
    };

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter: erroringStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      retryConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
      processors: {
        test: {
          attemptHandler: async ({ complete }) => {
            return complete(async () => null);
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({ ...txContext, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);
    });

    const logTypes = new Set(log.mock.calls.map((call) => call[0].type));
    expect(logTypes).toContain("state_adapter_error");
    expect(logTypes).toContain("worker_error");
  });

  it("logs notify adapter errors", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter: failingNotifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processDefaults: { pollIntervalMs: 100 },
      processors: {
        test: {
          attemptHandler: async ({ complete }) => {
            return complete(async () => null);
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({ ...txContext, typeName: "test", input: null }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, {
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
