import { type NotifyAdapter, createClient, createInProcessWorker, defineJobTypes } from "queuert";
import { sleep } from "queuert/internal";
import {
  extendWithCommon,
  extendWithNotifyInProcess,
  extendWithStateInProcess,
} from "queuert/testing";
import { it as baseIt, describe } from "vitest";
import { extendWithObservabilityOtel } from "./observability-adapter.otel.spec-helper.js";

const it = extendWithObservabilityOtel(
  extendWithNotifyInProcess(extendWithCommon(extendWithStateInProcess(baseIt))),
);

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};

describe("Metrics", () => {
  it("tracks metrics and histograms for simple job lifecycle", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectMetrics,
    expectHistograms,
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

    await expectMetrics([
      { method: "jobChainCreated", args: { typeName: "test" } },
      { method: "jobCreated", args: { typeName: "test" } },
      { method: "workerStarted", args: { workerId: "worker" } },
      { method: "jobAttemptStarted", args: { typeName: "test", status: "running" } },
      { method: "jobAttemptCompleted", args: { typeName: "test", output: { result: true } } },
      { method: "jobCompleted", args: { typeName: "test", output: { result: true } } },
      { method: "jobChainCompleted", args: { typeName: "test", output: { result: true } } },
      { method: "workerStopping", args: { workerId: "worker" } },
      { method: "workerStopped", args: { workerId: "worker" } },
    ]);

    await expectHistograms([
      { method: "jobDuration", args: { typeName: "test" } },
      { method: "jobChainDuration", args: { typeName: "test" } },
      { method: "jobAttemptDuration", args: { typeName: "test", workerId: "worker" } },
    ]);
  });

  it("tracks error metrics on retry", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectMetrics,
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

    await expectMetrics([
      { method: "jobChainCreated" },
      { method: "jobCreated" },
      { method: "workerStarted" },
      { method: "jobAttemptStarted" },
      { method: "jobAttemptFailed", args: { rescheduledAfterMs: 10 } },
      { method: "jobAttemptStarted" },
      { method: "jobAttemptFailed", args: { rescheduledAfterMs: 20 } },
      { method: "jobAttemptStarted" },
      { method: "jobAttemptFailed", args: { rescheduledAfterMs: 40 } },
      { method: "jobAttemptStarted" },
      { method: "jobAttemptCompleted" },
      { method: "jobCompleted" },
      { method: "jobChainCompleted" },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);
  });

  it("tracks metrics for chain continuations", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectMetrics,
    expectHistograms,
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
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        linear: {
          attemptHandler: async ({ job, complete }) =>
            complete(async ({ continueWith }) =>
              continueWith({
                typeName: "linear_next",
                input: { valueNext: job.input.value + 1 },
              }),
            ),
        },
        linear_next: {
          attemptHandler: async ({ job, complete }) =>
            complete(async ({ continueWith }) =>
              continueWith({
                typeName: "linear_next_next",
                input: { valueNextNext: job.input.valueNext + 1 },
              }),
            ),
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

    await expectMetrics([
      { method: "jobChainCreated", args: { typeName: "linear" } },
      { method: "jobCreated", args: { typeName: "linear" } },
      { method: "workerStarted" },
      { method: "jobAttemptStarted", args: { typeName: "linear" } },
      { method: "jobCreated", args: { typeName: "linear_next", chainTypeName: "linear" } },
      { method: "jobAttemptCompleted", args: { typeName: "linear" } },
      { method: "jobCompleted", args: { typeName: "linear" } },
      { method: "jobAttemptStarted", args: { typeName: "linear_next" } },
      { method: "jobCreated", args: { typeName: "linear_next_next", chainTypeName: "linear" } },
      { method: "jobAttemptCompleted", args: { typeName: "linear_next" } },
      { method: "jobCompleted", args: { typeName: "linear_next" } },
      { method: "jobAttemptStarted", args: { typeName: "linear_next_next" } },
      { method: "jobAttemptCompleted", args: { typeName: "linear_next_next" } },
      { method: "jobCompleted", args: { typeName: "linear_next_next" } },
      { method: "jobChainCompleted", args: { typeName: "linear" } },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);

    await expectHistograms([
      { method: "jobDuration", args: { typeName: "linear" } },
      { method: "jobAttemptDuration", args: { typeName: "linear" } },
      { method: "jobDuration", args: { typeName: "linear_next" } },
      { method: "jobAttemptDuration", args: { typeName: "linear_next" } },
      { method: "jobDuration", args: { typeName: "linear_next_next" } },
      { method: "jobChainDuration", args: { typeName: "linear" } },
      { method: "jobAttemptDuration", args: { typeName: "linear_next_next" } },
    ]);
  });

  it("tracks metrics for blocker chains", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectMetrics,
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

        return client.startJobChain({
          ...txContext,
          typeName: "main",
          input: { start: true },
          blockers: [dependencyJobChain],
        });
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);
    });

    await expectMetrics([
      { method: "jobChainCreated", args: { typeName: "blocker" } },
      { method: "jobCreated", args: { typeName: "blocker" } },
      { method: "jobChainCreated", args: { typeName: "main" } },
      { method: "jobCreated", args: { typeName: "main" } },
      { method: "jobBlocked", args: { typeName: "main" } },
      { method: "workerStarted" },
      { method: "jobAttemptStarted", args: { typeName: "blocker" } },
      { method: "jobCreated", args: { typeName: "blocker" } },
      { method: "jobAttemptCompleted", args: { typeName: "blocker" } },
      { method: "jobCompleted", args: { typeName: "blocker" } },
      { method: "jobAttemptStarted", args: { typeName: "blocker" } },
      { method: "jobAttemptCompleted", args: { typeName: "blocker" } },
      { method: "jobCompleted", args: { typeName: "blocker" } },
      { method: "jobChainCompleted", args: { typeName: "blocker" } },
      { method: "jobUnblocked", args: { typeName: "main" } },
      { method: "jobAttemptStarted", args: { typeName: "main" } },
      { method: "jobAttemptCompleted", args: { typeName: "main" } },
      { method: "jobCompleted", args: { typeName: "main" } },
      { method: "jobChainCompleted", args: { typeName: "main" } },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);
  });

  it("tracks workerless completion metrics", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expectMetrics,
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

    await expectMetrics([
      { method: "jobChainCreated", args: { input: { value: 42 } } },
      { method: "jobCreated", args: { input: { value: 42 } } },
      { method: "jobCompleted", args: { output: { result: 84 }, workerId: null } },
      { method: "jobChainCompleted", args: { output: { result: 84 } } },
    ]);
  });

  it("tracks notify context absence metric", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expectMetrics,
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

    // Create job WITHOUT withNotify — triggers notifyContextAbsence
    await runInTransaction(async (txContext) =>
      client.startJobChain({ ...txContext, typeName: "test", input: null }),
    );

    await expectMetrics([
      { method: "jobChainCreated" },
      { method: "jobCreated" },
      { method: "notifyContextAbsence" },
    ]);
  });

  it("tracks lease renewal metric", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    getMetricNames,
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

    const metricNames = await getMetricNames();
    expect(metricNames).toContain("queuert.job.attempt.lease_renewed");
  });

  it("tracks lease expiration metric", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    getMetricNames,
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

    const metricNames = await getMetricNames();
    expect(metricNames).toContain("queuert.job.attempt.lease_expired");
  });

  it("tracks reaper metrics", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    getMetricNames,
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

    const metricNames = await getMetricNames();
    expect(metricNames).toContain("queuert.job.reaped");
    expect(
      metricNames.has("queuert.job.attempt.taken_by_another_worker") ||
        metricNames.has("queuert.job.attempt.already_completed"),
    ).toBe(true);
  });

  it("tracks state adapter and worker error metrics", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    getMetricNames,
    expect,
  }) => {
    const registry = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    // Wrap getNextJobAvailableInMs to throw once — this is a wrapped operation
    // so the logging wrapper will emit stateAdapterError, and the error propagates
    // to the worker loop's outer catch which emits workerError
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

    const metricNames = await getMetricNames();
    expect(metricNames).toContain("queuert.state_adapter.error");
    expect(metricNames).toContain("queuert.worker.error");
  });

  it("tracks notify adapter error metric", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    getMetricNames,
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
      processDefaults: {
        pollIntervalMs: 100,
      },
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

    const metricNames = await getMetricNames();
    expect(metricNames).toContain("queuert.notify_adapter.error");
  });
});

describe("Spans", () => {
  it("tracks spans for simple job lifecycle", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectSpans,
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

    await expectSpans([
      { name: "create chain.test", kind: "PRODUCER" },
      { name: "create job.test", kind: "PRODUCER", parentName: "create chain.test" },
      { name: "prepare", kind: "INTERNAL", parentName: "start job-attempt.test" },
      { name: "complete", kind: "INTERNAL", parentName: "start job-attempt.test" },
      {
        name: "complete chain.test",
        kind: "CONSUMER",
        parentName: "start job-attempt.test",
        links: 1,
      },
      { name: "start job-attempt.test", kind: "CONSUMER", parentName: "create job.test" },
    ]);
  });

  it("tracks error spans on retry", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectSpans,
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

    await expectSpans([
      { name: "create chain.test", kind: "PRODUCER" },
      { name: "create job.test", kind: "PRODUCER", parentName: "create chain.test" },
      // Attempts 1-3: auto-setup prepare runs, then handler throws
      { name: "prepare", kind: "INTERNAL", parentName: "start job-attempt.test" },
      {
        name: "start job-attempt.test",
        kind: "CONSUMER",
        parentName: "create job.test",
        status: "ERROR",
      },
      { name: "prepare", kind: "INTERNAL", parentName: "start job-attempt.test" },
      {
        name: "start job-attempt.test",
        kind: "CONSUMER",
        parentName: "create job.test",
        status: "ERROR",
      },
      { name: "prepare", kind: "INTERNAL", parentName: "start job-attempt.test" },
      {
        name: "start job-attempt.test",
        kind: "CONSUMER",
        parentName: "create job.test",
        status: "ERROR",
      },
      // Attempt 4: prepare + complete + chain completion
      { name: "prepare", kind: "INTERNAL", parentName: "start job-attempt.test" },
      { name: "complete", kind: "INTERNAL", parentName: "start job-attempt.test" },
      {
        name: "complete chain.test",
        kind: "CONSUMER",
        parentName: "start job-attempt.test",
        links: 1,
      },
      {
        name: "start job-attempt.test",
        kind: "CONSUMER",
        parentName: "create job.test",
        status: "OK",
      },
    ]);
  });

  it("tracks spans for chain continuations with origin links", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectSpans,
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
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        linear: {
          attemptHandler: async ({ job, complete }) =>
            complete(async ({ continueWith }) =>
              continueWith({
                typeName: "linear_next",
                input: { valueNext: job.input.value + 1 },
              }),
            ),
        },
        linear_next: {
          attemptHandler: async ({ job, complete }) =>
            complete(async ({ continueWith }) =>
              continueWith({
                typeName: "linear_next_next",
                input: { valueNextNext: job.input.valueNext + 1 },
              }),
            ),
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

    await expectSpans([
      { name: "create chain.linear", kind: "PRODUCER" },
      { name: "create job.linear", kind: "PRODUCER", parentName: "create chain.linear" },
      { name: "prepare", kind: "INTERNAL", parentName: "start job-attempt.linear" },
      {
        name: "create job.linear_next",
        kind: "PRODUCER",
        parentName: "create chain.linear",
        links: 1,
      },
      { name: "complete", kind: "INTERNAL", parentName: "start job-attempt.linear" },
      { name: "start job-attempt.linear", kind: "CONSUMER", parentName: "create job.linear" },
      { name: "prepare", kind: "INTERNAL", parentName: "start job-attempt.linear_next" },
      {
        name: "create job.linear_next_next",
        kind: "PRODUCER",
        parentName: "create chain.linear",
        links: 1,
      },
      { name: "complete", kind: "INTERNAL", parentName: "start job-attempt.linear_next" },
      {
        name: "start job-attempt.linear_next",
        kind: "CONSUMER",
        parentName: "create job.linear_next",
      },
      { name: "prepare", kind: "INTERNAL", parentName: "start job-attempt.linear_next_next" },
      { name: "complete", kind: "INTERNAL", parentName: "start job-attempt.linear_next_next" },
      {
        name: "complete chain.linear",
        kind: "CONSUMER",
        parentName: "start job-attempt.linear_next_next",
        links: 1,
      },
      {
        name: "start job-attempt.linear_next_next",
        kind: "CONSUMER",
        parentName: "create job.linear_next_next",
      },
    ]);
  });

  it("tracks spans for blocker chains with blocker links", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectSpans,
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

        return client.startJobChain({
          ...txContext,
          typeName: "main",
          input: { start: true },
          blockers: [dependencyJobChain],
        });
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);
    });

    await expectSpans([
      // Blocker chain created independently (no links yet)
      { name: "create chain.blocker", kind: "PRODUCER" },
      { name: "create job.blocker", kind: "PRODUCER", parentName: "create chain.blocker" },
      // Main chain creation: blocker PRODUCER ends after addJobBlockers (before chain/job)
      { name: "await chain.blocker", kind: "PRODUCER", parentName: "create job.main", links: 1 },
      { name: "create chain.main", kind: "PRODUCER" },
      { name: "create job.main", kind: "PRODUCER", parentName: "create chain.main" },
      // Processing blocker job 1: continueWith creates blocker job 2
      { name: "prepare", kind: "INTERNAL", parentName: "start job-attempt.blocker" },
      {
        name: "create job.blocker",
        kind: "PRODUCER",
        parentName: "create chain.blocker",
        links: 1,
      },
      { name: "complete", kind: "INTERNAL", parentName: "start job-attempt.blocker" },
      { name: "start job-attempt.blocker", kind: "CONSUMER", parentName: "create job.blocker" },
      // Processing blocker job 2: chain completes, blocker CONSUMER span ends
      { name: "prepare", kind: "INTERNAL", parentName: "start job-attempt.blocker" },
      { name: "resolve chain.blocker", kind: "CONSUMER", parentName: "await chain.blocker" },
      { name: "complete", kind: "INTERNAL", parentName: "start job-attempt.blocker" },
      {
        name: "complete chain.blocker",
        kind: "CONSUMER",
        parentName: "start job-attempt.blocker",
        links: 1,
      },
      { name: "start job-attempt.blocker", kind: "CONSUMER", parentName: "create job.blocker" },
      // Processing main job: unblocked, completes
      { name: "prepare", kind: "INTERNAL", parentName: "start job-attempt.main" },
      { name: "complete", kind: "INTERNAL", parentName: "start job-attempt.main" },
      {
        name: "complete chain.main",
        kind: "CONSUMER",
        parentName: "start job-attempt.main",
        links: 1,
      },
      { name: "start job-attempt.main", kind: "CONSUMER", parentName: "create job.main" },
    ]);
  });

  it("tracks blocker spans when blocker chain is already completed", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectSpans,
  }) => {
    const registry = defineJobTypes<{
      blocker: {
        entry: true;
        input: { value: number };
        output: { done: true };
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
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        blocker: {
          attemptHandler: async ({ complete }) => complete(async () => ({ done: true })),
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

    // Create and complete the blocker chain first
    const dependencyJobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "blocker",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(dependencyJobChain, completionOptions);
    });

    // Now create main chain with already-completed blocker
    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "main",
          input: { start: true },
          blockers: [dependencyJobChain],
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);
    });

    await expectSpans([
      // Phase 1: blocker chain created and processed
      { name: "create chain.blocker", kind: "PRODUCER" },
      { name: "create job.blocker", kind: "PRODUCER", parentName: "create chain.blocker" },
      { name: "prepare", kind: "INTERNAL", parentName: "start job-attempt.blocker" },
      { name: "complete", kind: "INTERNAL", parentName: "start job-attempt.blocker" },
      {
        name: "complete chain.blocker",
        kind: "CONSUMER",
        parentName: "start job-attempt.blocker",
        links: 1,
      },
      { name: "start job-attempt.blocker", kind: "CONSUMER", parentName: "create job.blocker" },
      // Phase 2: main chain with already-completed blocker — both PRODUCER and CONSUMER end immediately
      { name: "await chain.blocker", kind: "PRODUCER", parentName: "create job.main", links: 1 },
      { name: "resolve chain.blocker", kind: "CONSUMER", parentName: "await chain.blocker" },
      { name: "create chain.main", kind: "PRODUCER" },
      { name: "create job.main", kind: "PRODUCER", parentName: "create chain.main" },
      // Phase 3: main job processes immediately (no blocking wait)
      { name: "prepare", kind: "INTERNAL", parentName: "start job-attempt.main" },
      { name: "complete", kind: "INTERNAL", parentName: "start job-attempt.main" },
      {
        name: "complete chain.main",
        kind: "CONSUMER",
        parentName: "start job-attempt.main",
        links: 1,
      },
      { name: "start job-attempt.main", kind: "CONSUMER", parentName: "create job.main" },
    ]);
  });

  it("tracks deduplication attributes on spans", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expectSpans,
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

    await client.withNotify(async () =>
      runInTransaction(async (txContext) => [
        await client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 1 },
          deduplication: { key: "same-key" },
        }),
        await client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 2 },
          deduplication: { key: "same-key" },
        }),
        await client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 3 },
          deduplication: { key: "different-key" },
        }),
      ]),
    );

    await expectSpans([
      // Chain 1: created normally
      { name: "create chain.test", kind: "PRODUCER" },
      { name: "create job.test", kind: "PRODUCER", parentName: "create chain.test" },
      // Chain 2: deduplicated (same key)
      {
        name: "create chain.test",
        kind: "PRODUCER",
        attributes: { "queuert.chain.deduplicated": true },
      },
      {
        name: "create job.test",
        kind: "PRODUCER",
        attributes: { "queuert.chain.deduplicated": true },
      },
      // Chain 3: created normally (different key)
      { name: "create chain.test", kind: "PRODUCER" },
      { name: "create job.test", kind: "PRODUCER", parentName: "create chain.test" },
    ]);
  });

  it("tracks workerless completion spans", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expectSpans,
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

    await expectSpans([
      { name: "create chain.test", kind: "PRODUCER" },
      { name: "create job.test", kind: "PRODUCER", parentName: "create chain.test" },
      { name: "complete chain.test", kind: "CONSUMER", parentName: "complete job.test", links: 1 },
      { name: "complete job.test", kind: "CONSUMER", parentName: "create job.test" },
    ]);
  });

  it("tracks complex workerless completion spans", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expectSpans,
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
            }
            return complete(job, async () => ({ done: true }));
          },
        }),
      ),
    );

    expect(completedChain.output).toEqual({ done: true });

    await expectSpans([
      { name: "create chain.awaiting-approval", kind: "PRODUCER" },
      {
        name: "create job.awaiting-approval",
        kind: "PRODUCER",
        parentName: "create chain.awaiting-approval",
      },
      {
        name: "create job.process-approved",
        kind: "PRODUCER",
        parentName: "create chain.awaiting-approval",
        links: 1,
      },
      {
        name: "complete job.awaiting-approval",
        kind: "CONSUMER",
        parentName: "create job.awaiting-approval",
      },
      {
        name: "complete chain.awaiting-approval",
        kind: "CONSUMER",
        parentName: "complete job.process-approved",
        links: 1,
      },
      {
        name: "complete job.process-approved",
        kind: "CONSUMER",
        parentName: "create job.process-approved",
      },
    ]);
  });
});

describe("Gauges", () => {
  it("tracks idle and processing gauges", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectGauges,
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
      concurrency: 1,
      processors: {
        test: {
          attemptHandler: async ({ job, complete }) => {
            return complete(async () => ({ result: job.input.test }));
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

    await expectGauges({
      jobTypeIdleChange: [],
      jobTypeProcessingChange: [],
    });
    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);

      await sleep(100);
      await expectGauges({
        jobTypeIdleChange: [
          { delta: 1, typeName: "test" },
          { delta: -1, typeName: "test" },
          { delta: 1, typeName: "test" },
        ],
        jobTypeProcessingChange: [
          { delta: 1, typeName: "test" },
          { delta: -1, typeName: "test" },
        ],
      });
    });

    await expectGauges({
      jobTypeIdleChange: [{ delta: -1, typeName: "test" }],
      jobTypeProcessingChange: [],
    });
  });

  it("tracks gauges for multiple job types", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectGauges,
    expect,
  }) => {
    const processedTypes: string[] = [];

    const registry = defineJobTypes<{
      email: { entry: true; input: { to: string }; output: { sent: boolean } };
      sms: { entry: true; input: { phone: string }; output: { sent: boolean } };
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
        email: {
          attemptHandler: async ({ complete }) => {
            processedTypes.push("email");
            return complete(async () => ({ sent: true }));
          },
        },
        sms: {
          attemptHandler: async ({ complete }) => {
            processedTypes.push("sms");
            return complete(async () => ({ sent: true }));
          },
        },
      },
    });

    const emailJob = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "email",
          input: { to: "test@example.com" },
        }),
      ),
    );
    const smsJob = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({ ...txContext, typeName: "sms", input: { phone: "+1234567890" } }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await Promise.all([
        client.waitForJobChainCompletion(emailJob, completionOptions),
        client.waitForJobChainCompletion(smsJob, completionOptions),
      ]);

      expect(processedTypes).toContain("email");
      expect(processedTypes).toContain("sms");
      expect(processedTypes).toHaveLength(2);

      await sleep(100);
      await expectGauges({
        jobTypeIdleChange: [
          { delta: 1, typeName: processedTypes[0] },
          { delta: 1, typeName: processedTypes[1] },
          { delta: -1, typeName: processedTypes[0] },
          { delta: -1, typeName: processedTypes[1] },
          { delta: 1, typeName: processedTypes[0] },
          { delta: 1, typeName: processedTypes[1] },
          { delta: -1, typeName: processedTypes[0] },
          { delta: -1, typeName: processedTypes[1] },
          { delta: 1, typeName: processedTypes[0] },
          { delta: 1, typeName: processedTypes[1] },
        ],
        jobTypeProcessingChange: [
          { delta: 1, typeName: processedTypes[0] },
          { delta: -1, typeName: processedTypes[0] },
          { delta: 1, typeName: processedTypes[1] },
          { delta: -1, typeName: processedTypes[1] },
        ],
      });
    });

    await expectGauges({
      jobTypeIdleChange: [
        { delta: -1, typeName: "email" },
        { delta: -1, typeName: "sms" },
      ],
      jobTypeProcessingChange: [],
    });
  });
});
