import { sleep } from "@queuert/helpers";
import {
  type NotifyAdapter,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";
import {
  extendWithCommon,
  extendWithNotifyInProcess,
  extendWithStateInProcess,
} from "queuert/testing";
import { it as baseIt, describe, expect, expectTypeOf } from "vitest";

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
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectMetrics,
    expectHistograms,
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
            attemptHandler: async ({ complete }) => {
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: true } }),
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
        input: { test: true },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    const workerIdMatcher = expect.stringMatching(/^worker-[0-9a-f-]{36}$/);

    await expectMetrics([
      { method: "chainCreated", args: { typeName: "test" } },
      { method: "jobCreated", args: { typeName: "test" } },
      { method: "workerStarted", args: { workerId: workerIdMatcher } },
      { method: "jobAttemptStarted", args: { typeName: "test", status: "running" } },
      { method: "jobCompleted", args: { typeName: "test", output: { result: true } } },
      { method: "chainCompleted", args: { typeName: "test", output: { result: true } } },
      { method: "jobAttemptCompleted", args: { typeName: "test", output: { result: true } } },
      { method: "workerStopping", args: { workerId: workerIdMatcher } },
      { method: "workerStopped", args: { workerId: workerIdMatcher } },
    ]);

    await expectHistograms([
      { method: "jobDuration", args: { typeName: "test" } },
      { method: "chainDuration", args: { typeName: "test" } },
      { method: "jobAttemptDuration", args: { typeName: "test", workerId: workerIdMatcher } },
    ]);
  });

  it("tracks error metrics on retry", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectMetrics,
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
          multiplier: 1,
          maxDelayMs: 10,
        },
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt < 2) {
                throw new Error("Unexpected error");
              }
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
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

    await expectMetrics([
      { method: "chainCreated" },
      { method: "jobCreated" },
      { method: "workerStarted" },
      { method: "jobAttemptStarted" },
      { method: "jobAttemptFailed" },
      { method: "jobRescheduled" },
      { method: "jobAttemptStarted" },
      { method: "jobCompleted" },
      { method: "chainCompleted" },
      { method: "jobAttemptCompleted" },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);
  });

  it("tracks metrics for job rescheduling", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectMetrics,
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
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt < 2) {
                return withTransaction(async (txCtx, transactionHooks) =>
                  complete({ ...txCtx, transactionHooks, reschedule: { afterMs: 100 } }),
                );
              }
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
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

    await expectMetrics([
      { method: "chainCreated" },
      { method: "jobCreated" },
      { method: "workerStarted" },
      { method: "jobAttemptStarted" },
      { method: "jobRescheduled" },
      { method: "jobAttemptCompleted" },
      { method: "jobAttemptStarted" },
      { method: "jobCompleted" },
      { method: "chainCompleted" },
      { method: "jobAttemptCompleted" },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);
  });

  it("tracks metrics for chain continuations", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectMetrics,
    expectHistograms,
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
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  continueWith: {
                    typeName: "linear_next",
                    input: { valueNext: job.input.value + 1 },
                  },
                }),
              ),
          },
          linear_next: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  continueWith: {
                    typeName: "linear_next_next",
                    input: { valueNextNext: job.input.valueNext + 1 },
                  },
                }),
              ),
          },
          linear_next_next: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  output: { result: job.input.valueNextNext },
                }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "linear",
        input: { value: 1 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    await expectMetrics([
      { method: "chainCreated", args: { typeName: "linear" } },
      { method: "jobCreated", args: { typeName: "linear" } },
      { method: "workerStarted" },
      { method: "jobAttemptStarted", args: { typeName: "linear" } },
      { method: "jobCreated", args: { typeName: "linear_next", chainTypeName: "linear" } },
      { method: "jobCompleted", args: { typeName: "linear" } },
      { method: "jobAttemptCompleted", args: { typeName: "linear" } },
      { method: "jobAttemptStarted", args: { typeName: "linear_next" } },
      { method: "jobCreated", args: { typeName: "linear_next_next", chainTypeName: "linear" } },
      { method: "jobCompleted", args: { typeName: "linear_next" } },
      { method: "jobAttemptCompleted", args: { typeName: "linear_next" } },
      { method: "jobAttemptStarted", args: { typeName: "linear_next_next" } },
      { method: "jobCompleted", args: { typeName: "linear_next_next" } },
      { method: "chainCompleted", args: { typeName: "linear" } },
      { method: "jobAttemptCompleted", args: { typeName: "linear_next_next" } },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);

    await expectHistograms([
      { method: "jobDuration", args: { typeName: "linear" } },
      { method: "jobAttemptDuration", args: { typeName: "linear" } },
      { method: "jobDuration", args: { typeName: "linear_next" } },
      { method: "jobAttemptDuration", args: { typeName: "linear_next" } },
      { method: "jobDuration", args: { typeName: "linear_next_next" } },
      { method: "chainDuration", args: { typeName: "linear" } },
      { method: "jobAttemptDuration", args: { typeName: "linear_next_next" } },
    ]);
  });

  it("tracks metrics for blocker chains", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectMetrics,
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
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                job.input.value < 1
                  ? complete({
                      ...txCtx,
                      transactionHooks,
                      continueWith: {
                        typeName: "blocker",
                        input: { value: job.input.value + 1 },
                      },
                    })
                  : complete({ ...txCtx, transactionHooks, output: { done: true } }),
              ),
          },
          main: {
            attemptHandler: async ({
              job: {
                input,
                blockers: [blocker],
              },
              complete,
            }) => {
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  output: {
                    finalResult: (blocker.output.done ? 1 : 0) + (input.start ? 1 : 0),
                  },
                }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) => {
      const dependencyChain = await client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "blocker",
        input: { value: 0 },
      });

      return client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: { start: true },
        blockers: [dependencyChain],
      });
    });

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    await expectMetrics([
      { method: "chainCreated", args: { typeName: "blocker" } },
      { method: "jobCreated", args: { typeName: "blocker" } },
      { method: "chainCreated", args: { typeName: "main" } },
      { method: "jobCreated", args: { typeName: "main" } },
      { method: "jobBlocked", args: { typeName: "main" } },
      { method: "workerStarted" },
      { method: "jobAttemptStarted", args: { typeName: "blocker" } },
      { method: "jobCreated", args: { typeName: "blocker" } },
      { method: "jobCompleted", args: { typeName: "blocker" } },
      { method: "jobAttemptCompleted", args: { typeName: "blocker" } },
      { method: "jobAttemptStarted", args: { typeName: "blocker" } },
      { method: "jobCompleted", args: { typeName: "blocker" } },
      { method: "chainCompleted", args: { typeName: "blocker" } },
      { method: "jobUnblocked", args: { typeName: "main" } },
      { method: "jobAttemptCompleted", args: { typeName: "blocker" } },
      { method: "jobAttemptStarted", args: { typeName: "main" } },
      { method: "jobCompleted", args: { typeName: "main" } },
      { method: "chainCompleted", args: { typeName: "main" } },
      { method: "jobAttemptCompleted", args: { typeName: "main" } },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);
  });

  it("tracks workerless completion metrics", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectMetrics,
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

    await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) => {
          return completeJob(job, async ({ complete }) => complete({ output: { result: 84 } }));
        },
      }),
    );

    await expectMetrics([
      { method: "chainCreated", args: { input: { value: 42 } } },
      { method: "jobCreated", args: { input: { value: 42 } } },
      { method: "jobCompleted", args: { output: { result: 84 }, workerId: null } },
      { method: "chainCompleted", args: { output: { result: 84 } } },
    ]);
  });

  it("tracks attempt extension metric", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    getMetricNames,
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
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
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
    });

    const metricNames = await getMetricNames();
    expect(metricNames).toContain("queuert.job.attempt.extended");
  });

  it("tracks attempt expiration metric", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    getMetricNames,
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
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
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
    });

    const metricNames = await getMetricNames();
    expect(metricNames).toContain("queuert.job.attempt.expired");
  });

  it("tracks attempt reclaim metrics", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    getMetricNames,
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
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
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
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      await jobStarted.promise;
      await sleep(10);

      const successChain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      );

      await Promise.all([
        client.awaitChain(chain, completionOptions),
        client.awaitChain(successChain, completionOptions),
      ]);
      await jobCompleted.promise;
    });

    const metricNames = await getMetricNames();
    expect(metricNames).toContain("queuert.job.attempt.reclaimed");
    expect(
      metricNames.has("queuert.job.attempt.taken_by_another_worker") ||
        metricNames.has("queuert.job.attempt.already_completed"),
    ).toBe(true);
  });

  it("tracks state adapter and worker error metrics", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    getMetricNames,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

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
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
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
    });

    const metricNames = await getMetricNames();
    expect(metricNames).toContain("queuert.state_adapter.error");
    expect(metricNames).toContain("queuert.worker.error");
  });

  it("tracks notify adapter error metric", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    getMetricNames,
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
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, {
        pollIntervalMs: 100,
        timeoutMs: 5000,
      });
    });

    const metricNames = await getMetricNames();
    expect(metricNames).toContain("queuert.notify_adapter.error");
  });

  it("tracks metrics for chain deletion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectMetrics,
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

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withTransaction(async (txCtx, transactionHooks) =>
      client.deleteChains({ ...txCtx, transactionHooks, ids: [chain.id] }),
    );

    await expectMetrics([
      { method: "chainCreated", args: { typeName: "test" } },
      { method: "jobCreated", args: { typeName: "test" } },
      { method: "chainDeleted", args: { typeName: "test" } },
    ]);
  });

  it("tracks metrics for job reschedule", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectMetrics,
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

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
        schedule: { afterMs: 60 * 60 * 1000 },
      }),
    );

    await withTransaction(async (txCtx, transactionHooks) =>
      client.rescheduleJob({ ...txCtx, transactionHooks, id: chain.id }),
    );

    await expectMetrics([
      { method: "chainCreated", args: { typeName: "test" } },
      { method: "jobCreated", args: { typeName: "test" } },
      { method: "jobRescheduled", args: { typeName: "test" } },
    ]);
  });

  it("records no creation metrics when a chain is deduplicated", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectMetrics,
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

    const create = async () =>
      withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
          deduplication: { key: "same-key", scope: "any" },
        }),
      );

    const first = await create();
    const second = await create();

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.id).toBe(first.id);

    await expectMetrics([
      { method: "chainCreated", args: { typeName: "test" } },
      { method: "jobCreated", args: { typeName: "test" } },
    ]);
  });
});

describe("Spans", () => {
  it("tracks spans for simple job lifecycle", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectSpans,
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
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: true } }),
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
        input: { test: true },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    await expectSpans([
      { name: "create chain.test", kind: "PRODUCER" },
      { name: "create job.test", kind: "PRODUCER", parentName: "create chain.test" },
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
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectSpans,
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
          multiplier: 1,
          maxDelayMs: 10,
        },
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt < 2) {
                throw new Error("Unexpected error");
              }
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
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

    await expectSpans([
      { name: "create chain.test", kind: "PRODUCER" },
      { name: "create job.test", kind: "PRODUCER", parentName: "create chain.test" },
      // Attempt 1: handler throws
      {
        name: "start job-attempt.test",
        kind: "CONSUMER",
        parentName: "create job.test",
        status: "ERROR",
      },
      // Attempt 2: completes
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

  it("tracks spans for job rescheduling", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectSpans,
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
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt < 2) {
                return withTransaction(async (txCtx, transactionHooks) =>
                  complete({ ...txCtx, transactionHooks, reschedule: { afterMs: 100 } }),
                );
              }
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
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

    await expectSpans([
      { name: "create chain.test", kind: "PRODUCER" },
      { name: "create job.test", kind: "PRODUCER", parentName: "create chain.test" },
      // Attempt 1: reschedule — span ends OK
      {
        name: "start job-attempt.test",
        kind: "CONSUMER",
        parentName: "create job.test",
        status: "OK",
      },
      // Attempt 2: completes normally
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
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectSpans,
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
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  continueWith: {
                    typeName: "linear_next",
                    input: { valueNext: job.input.value + 1 },
                  },
                }),
              ),
          },
          linear_next: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  continueWith: {
                    typeName: "linear_next_next",
                    input: { valueNextNext: job.input.valueNext + 1 },
                  },
                }),
              ),
          },
          linear_next_next: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  output: { result: job.input.valueNextNext },
                }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "linear",
        input: { value: 1 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    await expectSpans([
      { name: "create chain.linear", kind: "PRODUCER" },
      { name: "create job.linear", kind: "PRODUCER", parentName: "create chain.linear" },
      // Attempt 1: all spans flushed after commit — PRODUCER before CONSUMER (buffered last)
      {
        name: "create job.linear_next",
        kind: "PRODUCER",
        parentName: "create chain.linear",
        links: 1,
      },
      { name: "start job-attempt.linear", kind: "CONSUMER", parentName: "create job.linear" },
      // Attempt 2: same pattern
      {
        name: "create job.linear_next_next",
        kind: "PRODUCER",
        parentName: "create chain.linear",
        links: 1,
      },
      {
        name: "start job-attempt.linear_next",
        kind: "CONSUMER",
        parentName: "create job.linear_next",
      },
      // Attempt 3: no continuation, chain completes
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

  it("tracks a continuation committed outside its hooks flush as a continuation", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectSpans,
  }) => {
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
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          first: {
            // The transaction commits, but the hooks scope around it is discarded, so the worker
            // never sees the receipt commit and falls back to the `complete` write it made.
            attemptHandler: async ({ complete }) =>
              withTransactionHooks(async (transactionHooks) => {
                await stateAdapter.withTransaction(async (txCtx) =>
                  complete({
                    ...txCtx,
                    transactionHooks,
                    continueWith: { typeName: "second", input: null },
                  }),
                );
                throw new Error("after the transaction committed");
              }),
          },
          second: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "first", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    await expectSpans([
      { name: "create chain.first", kind: "PRODUCER" },
      { name: "create job.first", kind: "PRODUCER", parentName: "create chain.first" },
      { name: "create job.second", kind: "PRODUCER", parentName: "create chain.first" },
      {
        name: "start job-attempt.first",
        kind: "CONSUMER",
        parentName: "create job.first",
        status: "OK",
        attributes: { "queuert.continued_with.job_type": "second" },
      },
      {
        name: "complete chain.first",
        kind: "CONSUMER",
        parentName: "start job-attempt.second",
        links: 1,
      },
      { name: "start job-attempt.second", kind: "CONSUMER", parentName: "create job.second" },
    ]);
  });

  it("tracks spans for blocker chains with blocker links", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectSpans,
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
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                job.input.value < 1
                  ? complete({
                      ...txCtx,
                      transactionHooks,
                      continueWith: {
                        typeName: "blocker",
                        input: { value: job.input.value + 1 },
                      },
                    })
                  : complete({ ...txCtx, transactionHooks, output: { done: true } }),
              ),
          },
          main: {
            attemptHandler: async ({
              job: {
                input,
                blockers: [blocker],
              },
              complete,
            }) => {
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  output: {
                    finalResult: (blocker.output.done ? 1 : 0) + (input.start ? 1 : 0),
                  },
                }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) => {
      const dependencyChain = await client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "blocker",
        input: { value: 0 },
      });

      return client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: { start: true },
        blockers: [dependencyChain],
      });
    });

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    await expectSpans([
      // Blocker chain created independently (no links yet)
      { name: "create chain.blocker", kind: "PRODUCER" },
      { name: "create job.blocker", kind: "PRODUCER", parentName: "create chain.blocker" },
      // Main chain creation: blocker and chain PRODUCER spans deferred to flush together
      { name: "await chain.blocker", kind: "PRODUCER", parentName: "create job.main", links: 1 },
      { name: "create chain.main", kind: "PRODUCER" },
      { name: "create job.main", kind: "PRODUCER", parentName: "create chain.main" },
      // Processing blocker job 1: all spans flushed after commit — PRODUCER before CONSUMER
      {
        name: "create job.blocker",
        kind: "PRODUCER",
        parentName: "create chain.blocker",
        links: 1,
      },
      { name: "start job-attempt.blocker", kind: "CONSUMER", parentName: "create job.blocker" },
      // Processing blocker job 2: chain completes, all flushed after commit
      { name: "complete chain.blocker", kind: "CONSUMER", parentName: "await chain.blocker" },
      {
        name: "complete chain.blocker",
        kind: "CONSUMER",
        parentName: "start job-attempt.blocker",
        links: 1,
      },
      { name: "start job-attempt.blocker", kind: "CONSUMER", parentName: "create job.blocker" },
      // Processing main job: unblocked, completes
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
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectSpans,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { done: true } }),
              ),
          },
          main: {
            attemptHandler: async ({
              job: {
                input,
                blockers: [blocker],
              },
              complete,
            }) => {
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  output: {
                    finalResult: (blocker.output.done ? 1 : 0) + (input.start ? 1 : 0),
                  },
                }),
              );
            },
          },
        },
      }),
    });

    // Create and complete the blocker chain first
    const dependencyChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "blocker",
        input: { value: 1 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(dependencyChain, completionOptions);
    });

    // Now create main chain with already-completed blocker
    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: { start: true },
        blockers: [dependencyChain],
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    await expectSpans([
      // Phase 1: blocker chain created and processed
      { name: "create chain.blocker", kind: "PRODUCER" },
      { name: "create job.blocker", kind: "PRODUCER", parentName: "create chain.blocker" },
      {
        name: "complete chain.blocker",
        kind: "CONSUMER",
        parentName: "start job-attempt.blocker",
        links: 1,
      },
      { name: "start job-attempt.blocker", kind: "CONSUMER", parentName: "create job.blocker" },
      // Phase 2: main chain with already-completed blocker — both PRODUCER and CONSUMER end immediately
      { name: "await chain.blocker", kind: "PRODUCER", parentName: "create job.main", links: 1 },
      { name: "complete chain.blocker", kind: "CONSUMER", parentName: "await chain.blocker" },
      { name: "create chain.main", kind: "PRODUCER" },
      { name: "create job.main", kind: "PRODUCER", parentName: "create chain.main" },
      // Phase 3: main job processes immediately (no blocking wait)
      {
        name: "complete chain.main",
        kind: "CONSUMER",
        parentName: "start job-attempt.main",
        links: 1,
      },
      { name: "start job-attempt.main", kind: "CONSUMER", parentName: "create job.main" },
    ]);
  });

  it("ends every blocker span of a batch before any job span", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectSpans,
  }) => {
    const jobTypes = defineJobTypes<{
      completed: { entry: true; input: null; output: null };
      running: { entry: true; input: null; output: null };
      alpha: {
        entry: true;
        input: null;
        output: null;
        blockers: [{ typeName: "completed" }, { typeName: "running" }];
      };
      beta: {
        entry: true;
        input: null;
        output: null;
        blockers: [{ typeName: "running" }];
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const [completedChain, runningChain] = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "completed", input: null },
          { typeName: "running", input: null },
        ],
      }),
    );
    await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...completedChain,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ complete }) => complete({ output: null })),
      }),
    );

    await withTransaction(async (txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "alpha", input: null, blockers: [completedChain, runningChain] },
          { typeName: "beta", input: null, blockers: [runningChain] },
        ],
      }),
    );

    await expectSpans([
      { name: "create chain.completed", kind: "PRODUCER" },
      { name: "create job.completed", kind: "PRODUCER", parentName: "create chain.completed" },
      { name: "create chain.running", kind: "PRODUCER" },
      { name: "create job.running", kind: "PRODUCER", parentName: "create chain.running" },
      { name: "complete chain.completed", parentName: "complete job.completed" },
      { name: "complete job.completed", kind: "CONSUMER", parentName: "create job.completed" },
      {
        name: "await chain.completed",
        kind: "PRODUCER",
        parentName: "create job.alpha",
        attributes: { "queuert.blocker.index": 0 },
      },
      { name: "complete chain.completed", kind: "CONSUMER", parentName: "await chain.completed" },
      {
        name: "await chain.running",
        kind: "PRODUCER",
        parentName: "create job.alpha",
        attributes: { "queuert.blocker.index": 1 },
      },
      {
        name: "await chain.running",
        kind: "PRODUCER",
        parentName: "create job.beta",
        attributes: { "queuert.blocker.index": 0 },
      },
      { name: "create chain.alpha", kind: "PRODUCER" },
      { name: "create job.alpha", kind: "PRODUCER", parentName: "create chain.alpha" },
      { name: "create chain.beta", kind: "PRODUCER" },
      { name: "create job.beta", kind: "PRODUCER", parentName: "create chain.beta" },
    ]);
  });

  it("ends a deduplicated chain's spans before the spans of a new chain in the same batch", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectSpans,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: { value: number }; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 1 },
        deduplication: { key: "existing", scope: "running" },
      }),
    );

    const [newChain, deduplicatedChain] = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "test", input: { value: 2 } },
          {
            typeName: "test",
            input: { value: 3 },
            deduplication: { key: "existing", scope: "running" },
          },
        ],
      }),
    );
    expect(newChain.deduplicated).toBe(false);
    expect(deduplicatedChain.deduplicated).toBe(true);

    await expectSpans([
      { name: "create chain.test", kind: "PRODUCER" },
      { name: "create job.test", kind: "PRODUCER", parentName: "create chain.test" },
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
      { name: "create chain.test", kind: "PRODUCER" },
      { name: "create job.test", kind: "PRODUCER", parentName: "create chain.test" },
    ]);
  });

  it("tracks deduplication attributes on spans", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectSpans,
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

    await withTransaction(async (txCtx, transactionHooks) => [
      await client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 1 },
        deduplication: { key: "same-key", scope: "running" },
      }),
      await client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 2 },
        deduplication: { key: "same-key", scope: "running" },
      }),
      await client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 3 },
        deduplication: { key: "different-key", scope: "running" },
      }),
    ]);

    await expectSpans([
      // Chain 2: deduplicated (same key) — span ends are immediate (not buffered)
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
      // Chain 1: created normally — span ends deferred to flush
      { name: "create chain.test", kind: "PRODUCER" },
      { name: "create job.test", kind: "PRODUCER", parentName: "create chain.test" },
      // Chain 3: created normally (different key) — span ends deferred to flush
      { name: "create chain.test", kind: "PRODUCER" },
      { name: "create job.test", kind: "PRODUCER", parentName: "create chain.test" },
    ]);
  });

  it("tracks workerless completion spans", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectSpans,
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

    await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) => {
          return completeJob(job, async ({ complete }) => complete({ output: { result: 84 } }));
        },
      }),
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
    withTransaction,
    observabilityAdapter,
    log,
    expectSpans,
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
            return completeJob(job, async ({ complete }) => complete({ output: { done: true } }));
          }
          return completeJob(job, async ({ complete }) => complete({ output: { done: true } }));
        },
      }),
    );

    expectTypeOf(completedChain.status).toEqualTypeOf<"completed">();
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
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectGauges,
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
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.test } }),
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
        input: { test: true },
      }),
    );

    await expectGauges({
      jobTypeIdleChange: [],
      jobTypeProcessingChange: [],
    });
    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);

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
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectGauges,
  }) => {
    const processedTypes: string[] = [];

    const jobTypes = defineJobTypes<{
      email: { entry: true; input: { to: string }; output: { sent: boolean } };
      sms: { entry: true; input: { phone: string }; output: { sent: boolean } };
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
          email: {
            attemptHandler: async ({ complete }) => {
              processedTypes.push("email");
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { sent: true } }),
              );
            },
          },
          sms: {
            attemptHandler: async ({ complete }) => {
              processedTypes.push("sms");
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { sent: true } }),
              );
            },
          },
        },
      }),
    });

    const emailChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "email",
        input: { to: "test@example.com" },
      }),
    );
    const smsChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "sms",
        input: { phone: "+1234567890" },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await Promise.all([
        client.awaitChain(emailChain, completionOptions),
        client.awaitChain(smsChain, completionOptions),
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

describe("Rollback", () => {
  it("discards creation metrics and spans on rollback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    getMetricNames,
    expectSpans,
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

    await withTransaction(async (txCtx, transactionHooks) => {
      await client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null });
      throw new Error("simulated rollback");
    }).catch(() => {});

    const metricNames = await getMetricNames();
    expect(metricNames.size).toBe(0);
    await expectSpans([
      { name: "create chain.test", kind: "PRODUCER", status: "ERROR" },
      {
        name: "create job.test",
        kind: "PRODUCER",
        parentName: "create chain.test",
        status: "ERROR",
      },
    ]);
  });

  it("discards creation metrics and spans with blockers on rollback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    getMetricNames,
    expectSpans,
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

    await withTransaction(async (txCtx, transactionHooks) => {
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
    }).catch(() => {});

    const metricNames = await getMetricNames();
    expect(metricNames.size).toBe(0);
    await expectSpans([
      { name: "create chain.blocker", kind: "PRODUCER", status: "ERROR" },
      {
        name: "create job.blocker",
        kind: "PRODUCER",
        parentName: "create chain.blocker",
        status: "ERROR",
      },
      { name: "create chain.main", kind: "PRODUCER", status: "ERROR" },
      {
        name: "create job.main",
        kind: "PRODUCER",
        parentName: "create chain.main",
        status: "ERROR",
      },
    ]);
  });

  it("discards workerless completion metrics and spans on rollback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectMetrics,
    expectSpans,
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

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withTransaction(async (txCtx, transactionHooks) => {
      await client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ complete }) => complete({ output: { result: 42 } })),
      });
      throw new Error("simulated rollback");
    }).catch(() => {});

    await expectMetrics([{ method: "chainCreated" }, { method: "jobCreated" }]);

    await expectSpans([
      { name: "create chain.test", kind: "PRODUCER" },
      { name: "create job.test", kind: "PRODUCER", parentName: "create chain.test" },
    ]);
  });

  it("discards completion metrics on worker complete rollback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectMetrics,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    let completeJobErrorThrown = false;
    const erroringStateAdapter: typeof stateAdapter = {
      ...stateAdapter,
      completeJobs: async (args) => {
        if (!completeJobErrorThrown) {
          completeJobErrorThrown = true;
          throw new Error("simulated completeJob failure");
        }
        return stateAdapter.completeJobs(args);
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
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
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

    await expectMetrics([
      { method: "chainCreated" },
      { method: "jobCreated" },
      { method: "workerStarted" },
      { method: "jobAttemptStarted" },
      { method: "stateAdapterError" },
      { method: "jobAttemptFailed" },
      { method: "jobRescheduled" },
      { method: "jobAttemptStarted" },
      { method: "jobCompleted" },
      { method: "chainCompleted" },
      { method: "jobAttemptCompleted" },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);
  });

  it("discards error-handling metrics on reschedule rollback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectMetrics,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    let rescheduleErrorThrown = false;
    let handlerFailed = false;
    const erroringStateAdapter: typeof stateAdapter = {
      ...stateAdapter,
      rescheduleJobs: async (args) => {
        if (args.jobs.some((job) => job.error !== undefined) && !rescheduleErrorThrown) {
          rescheduleErrorThrown = true;
          throw new Error("simulated reschedule failure");
        }
        return stateAdapter.rescheduleJobs(args);
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
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
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
    });

    await expectMetrics([
      { method: "chainCreated" },
      { method: "jobCreated" },
      { method: "workerStarted" },
      { method: "jobAttemptStarted" },
      { method: "stateAdapterError" },
      // the autocommit error reschedule failed, so the attempt surfaces it as a worker error
      { method: "workerError" },
      { method: "jobAttemptReclaimed" },
      { method: "jobAttemptStarted" },
      { method: "jobCompleted" },
      { method: "chainCompleted" },
      { method: "jobAttemptCompleted" },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);
  });

  it("discards continuation metrics when user callback throws after continueWith", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectMetrics,
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
              withTransaction(async (txCtx, transactionHooks) => {
                const result = await complete({
                  ...txCtx,
                  transactionHooks,
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
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "linear", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    await expectMetrics([
      { method: "chainCreated" },
      { method: "jobCreated" },
      { method: "workerStarted" },
      { method: "jobAttemptStarted" },
      { method: "jobAttemptFailed" },
      { method: "jobRescheduled" },
      { method: "jobAttemptStarted" },
      { method: "jobCreated" },
      { method: "jobCompleted" },
      { method: "jobAttemptCompleted" },
      { method: "jobAttemptStarted" },
      { method: "jobCompleted" },
      { method: "chainCompleted" },
      { method: "jobAttemptCompleted" },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);
  });

  it("discards completion metrics on unblockJobs rollback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectMetrics,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
      dependent: {
        entry: true;
        input: null;
        output: null;
        blockers: [{ typeName: "test" }];
      };
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
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) => {
      const created = await client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      });
      await client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "dependent",
        input: null,
        blockers: [created],
      });
      return created;
    });

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    await expectMetrics([
      { method: "chainCreated" },
      { method: "jobCreated" },
      { method: "chainCreated" },
      { method: "jobCreated" },
      { method: "jobBlocked" },
      { method: "workerStarted" },
      { method: "jobAttemptStarted" },
      { method: "stateAdapterError" },
      { method: "jobRescheduled" },
      { method: "jobAttemptFailed" },
      { method: "jobAttemptStarted" },
      { method: "jobCompleted" },
      { method: "chainCompleted" },
      { method: "jobUnblocked" },
      { method: "jobAttemptCompleted" },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);
  });

  it("discards workerless completion metrics on finishJob internal failure", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectMetrics,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { result: number } };
      dependent: {
        entry: true;
        input: null;
        output: null;
        blockers: [{ typeName: "test" }];
      };
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

    const chain = await withTransaction(async (txCtx, transactionHooks) => {
      const created = await client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      });
      await client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "dependent",
        input: null,
        blockers: [created],
      });
      return created;
    });

    // First attempt: unblockJobs fails inside finishJob → entire transaction rolls back
    await withTransaction(async (txCtx, transactionHooks) =>
      erroringClient.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ complete }) => complete({ output: { result: 42 } })),
      }),
    ).catch(() => {});

    // Second attempt: succeeds
    await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ complete }) => complete({ output: { result: 42 } })),
      }),
    );

    await expectMetrics([
      { method: "chainCreated" },
      { method: "jobCreated" },
      { method: "chainCreated" },
      { method: "jobCreated" },
      { method: "jobBlocked" },
      { method: "stateAdapterError" },
      { method: "jobCompleted" },
      { method: "chainCompleted" },
      { method: "jobUnblocked" },
    ]);
  });

  it("discards continuation metrics on createJob rollback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectMetrics,
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
      continueJobs: async (args) => {
        if (!createJobErrorThrown) {
          createJobErrorThrown = true;
          throw new Error("simulated createJob failure");
        }
        return stateAdapter.continueJobs(args);
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
              withTransaction(async (txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  continueWith: { typeName: "linear_next", input: null },
                }),
              ),
          },
          linear_next: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "linear", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    await expectMetrics([
      { method: "chainCreated" },
      { method: "jobCreated" },
      { method: "workerStarted" },
      { method: "jobAttemptStarted" },
      { method: "stateAdapterError" },
      { method: "jobAttemptFailed" },
      { method: "jobRescheduled" },
      { method: "jobAttemptStarted" },
      { method: "jobCreated" },
      { method: "jobCompleted" },
      { method: "jobAttemptCompleted" },
      { method: "jobAttemptStarted" },
      { method: "jobCompleted" },
      { method: "chainCompleted" },
      { method: "jobAttemptCompleted" },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);
  });

  it("ends job spans when transaction rolls back", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectSpans,
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

    await withTransaction(async (txCtx, transactionHooks) => {
      await client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null });
      throw new Error("simulated rollback");
    }).catch(() => {});

    // startJobSpan creates spans eagerly, but their end() is buffered via
    // transactionHooks. On rollback the buffer is discarded and the spans
    // are orphaned — started but never finished. They should be ended with
    // ERROR status instead.
    await expectSpans([
      { name: "create chain.test", kind: "PRODUCER", status: "ERROR" },
      {
        name: "create job.test",
        kind: "PRODUCER",
        parentName: "create chain.test",
        status: "ERROR",
      },
    ]);
  });

  it("ends rolled-back continuation span when user callback throws after continueWith", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectSpans,
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
              withTransaction(async (txCtx, transactionHooks) => {
                const result = await complete({
                  ...txCtx,
                  transactionHooks,
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
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "linear", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    // The first attempt's continueWith creates a "create job.linear_next" span
    // eagerly via startJobSpan. When the user callback throws, the transaction
    // rolls back and the buffered end() is discarded — orphaning the span.
    // It should be ended with ERROR status on rollback.
    await expectSpans([
      { name: "create chain.linear", kind: "PRODUCER" },
      { name: "create job.linear", kind: "PRODUCER", parentName: "create chain.linear" },
      // First attempt: rolled-back continuation span must be properly ended
      {
        name: "create job.linear_next",
        kind: "PRODUCER",
        parentName: "create chain.linear",
        status: "ERROR",
        links: 1,
      },
      {
        name: "start job-attempt.linear",
        kind: "CONSUMER",
        parentName: "create job.linear",
        status: "ERROR",
      },
      // Second attempt: succeeds
      {
        name: "create job.linear_next",
        kind: "PRODUCER",
        parentName: "create chain.linear",
        links: 1,
      },
      {
        name: "start job-attempt.linear",
        kind: "CONSUMER",
        parentName: "create job.linear",
        status: "OK",
      },
      // linear_next processing
      {
        name: "complete chain.linear",
        kind: "CONSUMER",
        parentName: "start job-attempt.linear_next",
        links: 1,
      },
      {
        name: "start job-attempt.linear_next",
        kind: "CONSUMER",
        parentName: "create job.linear_next",
      },
    ]);
  });

  it("ends rolled-back createChain spans when the handler's transaction rolls back after complete", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectSpans,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
      other: { entry: true; input: null; output: null };
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
          test: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                await client.createChain({
                  ...txCtx,
                  transactionHooks,
                  typeName: "other",
                  input: null,
                });
                const result = await complete({ ...txCtx, transactionHooks, output: null });
                if (throwOnce) {
                  throwOnce = false;
                  throw new Error("user error after complete");
                }
                return result;
              }),
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

    // createChain inside the handler's transaction creates chain + job spans eagerly.
    // When the transaction rolls back after complete, the hooks are discarded —
    // the buffered span end() calls must still end both spans.
    await expectSpans([
      { name: "create chain.test", kind: "PRODUCER" },
      { name: "create job.test", kind: "PRODUCER", parentName: "create chain.test" },
      // First attempt: rolled-back createChain spans are ended with ERROR
      { name: "create chain.other", kind: "PRODUCER", status: "ERROR" },
      {
        name: "create job.other",
        kind: "PRODUCER",
        parentName: "create chain.other",
        status: "ERROR",
      },
      {
        name: "start job-attempt.test",
        kind: "CONSUMER",
        parentName: "create job.test",
        status: "ERROR",
      },
      // Second attempt: succeeds
      { name: "create chain.other", kind: "PRODUCER" },
      { name: "create job.other", kind: "PRODUCER", parentName: "create chain.other" },
      // test chain completion
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
});
