import inspector from "node:inspector";

import { it as baseIt, describe, expect, onTestFinished, vi } from "vitest";

import {
  JobAlreadyCompletedError,
  type NotifyAdapter,
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
} from "../index.ts";
import { createInProcessNotifyAdapter } from "../notify-adapter.in-process/notify-adapter.in-process.ts";
import { createConsoleLog } from "../observability-adapter/log.console.ts";
import type { Log } from "../observability-adapter/log.ts";
import { createNoopObservabilityAdapter } from "../observability-adapter/observability-adapter.noop.ts";
import { createInProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";
import type { TxHooks } from "../tx-hooks/tx-hooks.ts";

const it = baseIt
  .extend(
    "stateAdapter",
    async () =>
      createInProcessStateAdapter() as unknown as StateAdapter<
        { $test: true; txHooks: TxHooks },
        string,
        string
      >,
  )
  .extend("notifyAdapter", async () => createInProcessNotifyAdapter())
  .extend(
    "withTransaction",
    async ({ stateAdapter }) =>
      async <T>(cb: (txCtx: { $test: true; txHooks: TxHooks }) => Promise<T>): Promise<T> =>
        stateAdapter.withTransaction(cb),
  )
  .extend("log", async () => {
    const consoleLog = createConsoleLog();
    return vi.fn<Log>((...args) => {
      if (process.env.DEBUG || inspector.url()) {
        consoleLog(...args);
      }
    });
  })
  .extend("observabilityAdapter", async () => createNoopObservabilityAdapter())
  .extend(
    "expectLogs",
    async ({ log }) =>
      (expected: { type: string; data?: Record<string, unknown>; error?: unknown }[]) => {
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
      },
  );

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};

describe("Logging", () => {
  it("logs simple job lifecycle", async ({
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
        input: { test: boolean };
        output: { result: boolean };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    await using workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              return withTransaction(async (txCtx) =>
                complete({ ...txCtx, output: { result: true } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({
        ...txCtx,
        typeName: "test",
        input: { test: true },
      }),
    );

    await workerRunner.start();
    await client.awaitChain(chain, completionOptions);
    await workerRunner.close();

    const workerArgs = {
      workerId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown as string,
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
        data: { ...jobArgs, status: "completed", attempt: 1, output: { result: true } },
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
      { type: "worker_stopped", data: { ...workerArgs } },
    ]);
  });

  it("logs retry failures with backoff", async ({
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
        input: null;
        output: null;
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    await using workerRunner = createWorkerRunner({
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
              return withTransaction(async (txCtx) => complete({ ...txCtx, output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({
        ...txCtx,
        typeName: "test",
        input: null,
      }),
    );

    await workerRunner.start();
    await client.awaitChain(chain, completionOptions);
    await workerRunner.close();

    expectLogs([
      { type: "chain_created", data: { typeName: "test" } },
      { type: "job_created", data: { typeName: "test" } },
      { type: "worker_started" },
      { type: "job_attempt_started", data: { typeName: "test", attempt: 1 } },
      { type: "job_rescheduled", data: { typeName: "test" } },
      { type: "job_attempt_failed", error: expect.anything() },
      { type: "job_attempt_started", data: { typeName: "test", attempt: 2 } },
      { type: "job_completed", data: { typeName: "test" } },
      { type: "chain_completed", data: { typeName: "test" } },
      { type: "job_attempt_completed", data: { typeName: "test" } },
      { type: "worker_stopped" },
    ]);
  });

  it("logs job rescheduling", async ({
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
        input: null;
        output: null;
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    await using workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt < 2) {
                return withTransaction(async (txCtx) =>
                  complete({ ...txCtx, reschedule: { afterMs: 100 } }),
                );
              }
              return withTransaction(async (txCtx) => complete({ ...txCtx, output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({
        ...txCtx,
        typeName: "test",
        input: null,
      }),
    );

    await workerRunner.start();
    await client.awaitChain(chain, completionOptions);
    await workerRunner.close();

    expectLogs([
      { type: "chain_created", data: { typeName: "test" } },
      { type: "job_created", data: { typeName: "test" } },
      { type: "worker_started" },
      { type: "job_attempt_started", data: { typeName: "test", attempt: 1 } },
      { type: "job_rescheduled", data: { typeName: "test" } },
      { type: "job_attempt_completed", data: { typeName: "test" } },
      { type: "job_attempt_started", data: { typeName: "test", attempt: 2 } },
      { type: "job_completed", data: { typeName: "test" } },
      { type: "chain_completed", data: { typeName: "test" } },
      { type: "job_attempt_completed", data: { typeName: "test" } },
      { type: "worker_stopped" },
    ]);
  });

  it("logs chain continuations", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    await using workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          linear: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction(async (txCtx) =>
                complete({
                  ...txCtx,
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
              return withTransaction(async (txCtx) =>
                complete({
                  ...txCtx,
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
              withTransaction(async (txCtx) =>
                complete({
                  ...txCtx,
                  output: { result: job.input.valueNextNext },
                }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({
        ...txCtx,
        typeName: "linear",
        input: { value: 1 },
      }),
    );

    await workerRunner.start();
    await client.awaitChain(chain, completionOptions);
    await workerRunner.close();

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
      { type: "worker_stopped" },
    ]);
  });

  it("logs blocker chains", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    let blockerChainId: string;

    await using workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction(async (txCtx) =>
                job.input.value < 1
                  ? complete({
                      ...txCtx,
                      continueWith: {
                        typeName: "blocker",
                        input: { value: job.input.value + 1 },
                      },
                    })
                  : complete({ ...txCtx, output: { done: true } }),
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
              return withTransaction(async (txCtx) =>
                complete({
                  ...txCtx,
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

    const chain = await withTransaction(async (txCtx) => {
      const dependencyChain = await client.createChain({
        ...txCtx,
        typeName: "blocker",
        input: { value: 0 },
      });
      blockerChainId = dependencyChain.id;

      const chain = await client.createChain({
        ...txCtx,
        typeName: "main",
        input: { start: true },
        blockers: [dependencyChain],
      });

      return chain;
    });

    await workerRunner.start();
    await client.awaitChain(chain, completionOptions);
    await workerRunner.close();

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
          chainId: chain.id,
          chainTypeName: "main",
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
      { type: "worker_stopped" },
    ]);
  });

  it("logs and notifies an unblock once, after the last of two blockers completes", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: { entry: true; input: null; output: null };
      main: {
        entry: true;
        input: null;
        output: null;
        blockers: [{ typeName: "blocker" }, { typeName: "blocker" }];
      };
      sentinel: { entry: true; input: null; output: null };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const [blockerA, blockerB] = await withTransaction(async (txCtx) => {
      const blockerA = await client.createChain({
        ...txCtx,
        typeName: "blocker",
        input: null,
      });
      const blockerB = await client.createChain({
        ...txCtx,
        typeName: "blocker",
        input: null,
      });
      await client.createChain({
        ...txCtx,
        typeName: "main",
        input: null,
        blockers: [blockerA, blockerB],
      });
      return [blockerA, blockerB];
    });

    const completeBlocker = async (blocker: typeof blockerA) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          ...blocker,
          handler: async ({ job, completeJob }) =>
            completeJob(job, async ({ complete }) => complete({ output: null })),
        }),
      );
    const unblockedLogs = () =>
      log.mock.calls.filter(([entry]) => entry.type === "job_unblocked").map(([entry]) => entry);
    const notified: string[] = [];
    const dispose = await notifyAdapter.listenJobScheduled(["main", "sentinel"], (typeName) =>
      notified.push(typeName),
    );
    onTestFinished(dispose);

    log.mockClear();
    await completeBlocker(blockerA);

    expect(unblockedLogs()).toEqual([]);

    await completeBlocker(blockerB);

    expect(unblockedLogs()).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          typeName: "main",
          unblockedByChain: expect.objectContaining({ id: blockerB.id }),
        }),
      }),
    ]);

    // Notifications arrive in commit order, so once the sentinel's lands, every one for `main` has too.
    await withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "sentinel", input: null }),
    );
    await vi.waitFor(
      () => {
        expect(notified).toContain("sentinel");
      },
      { timeout: 5000 },
    );
    expect(notified.filter((typeName) => typeName === "main")).toEqual(["main"]);
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({
        ...txCtx,
        typeName: "test",
        input: { value: 42 },
      }),
    );

    await withTransaction(async (txCtx) =>
      client.completeChain({
        ...txCtx,
        ...chain,
        handler: async ({ job, completeJob }) => {
          return completeJob(job, async ({ complete }) => complete({ output: { result: 84 } }));
        },
      }),
    );

    expectLogs([
      { type: "chain_created", data: { input: { value: 42 } } },
      { type: "job_created", data: { input: { value: 42 } } },
      { type: "job_completed", data: { output: { result: 84 } } },
      { type: "chain_completed", data: { output: { result: 84 } } },
    ]);
  });

  it("logs attempt reclaim events", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const leaseLosingClient = createClient({
      stateAdapter: { ...stateAdapter, extendWorkerLease: async () => undefined },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const jobStarted = Promise.withResolvers<void>();
    const handlerReleased = Promise.withResolvers<void>();

    await using leaseLosingWorkerRunner = createWorkerRunner({
      client: leaseLosingClient,
      leaseConfig: { durationMs: 150, heartbeatMs: 40 },
      processors: createProcessors({
        client: leaseLosingClient,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              jobStarted.resolve();
              await handlerReleased.promise;
              return withTransaction(async (txCtx) => complete({ ...txCtx, output: null }));
            },
          },
        },
      }),
    });
    await using reclaimingWorkerRunner = createWorkerRunner({
      client,
      pollIntervalMs: 20,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx) => complete({ ...txCtx, output: null })),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "test", input: null }),
    );

    let attemptStartedAt = new Date();
    await leaseLosingWorkerRunner.start();
    await jobStarted.promise;
    attemptStartedAt = new Date();
    await reclaimingWorkerRunner.start();
    await client.awaitChain(chain, completionOptions);
    await reclaimingWorkerRunner.close();
    handlerReleased.resolve();
    await leaseLosingWorkerRunner.close();

    const logTypes = new Set(log.mock.calls.map((call) => call[0].type));
    expect(logTypes).toContain("job_attempt_reclaimed");
    expect(logTypes).toContain("job_attempt_lost");
    const rescheduled = log.mock.calls.find((call) => call[0].type === "job_rescheduled");
    expect(
      (rescheduled![0].data as { scheduledAt: Date }).scheduledAt.getTime(),
    ).toBeGreaterThanOrEqual(attemptStartedAt.getTime());
  });

  it("logs a lost worker lease", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const client = createClient({
      stateAdapter: { ...stateAdapter, extendWorkerLease: async () => undefined },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    await using workerRunner = createWorkerRunner({
      client,
      leaseConfig: { durationMs: 1000, heartbeatMs: 20 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async () => {
              throw new Error("not expected to run");
            },
          },
        },
      }),
    });

    await workerRunner.start();
    await expect
      .poll(() => log)
      .toHaveBeenCalledWith({
        type: "worker_lease_lost",
        level: "warn",
        message: "Worker lost its lease",
        data: { workerId: expect.any(String) },
      });
  });

  it("logs a lost attempt once after a workerless takeover", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectLogs,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { by: string } };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const started = Promise.withResolvers<void>();
    const takenOver = Promise.withResolvers<void>();
    await using workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              started.resolve();
              await takenOver.promise;
              const completeAsWorker = async () =>
                withTransaction(async (txCtx) => complete({ ...txCtx, output: { by: "worker" } }));
              await expect(completeAsWorker()).rejects.toThrow(JobAlreadyCompletedError);
              return completeAsWorker();
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "test", input: null }),
    );

    await workerRunner.start();
    await started.promise;
    await withTransaction(async (txCtx) =>
      client.completeChain({
        ...txCtx,
        ...chain,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ complete }) => complete({ output: { by: "workerless" } })),
      }),
    );
    takenOver.resolve();
    await vi.waitFor(
      () => {
        expect(log).toHaveBeenCalledWith(expect.objectContaining({ type: "job_attempt_lost" }));
      },
      { timeout: 5000 },
    );
    await workerRunner.close();

    expectLogs([
      { type: "chain_created", data: { typeName: "test" } },
      { type: "job_created", data: { typeName: "test" } },
      { type: "worker_started" },
      { type: "job_attempt_started", data: { typeName: "test", attempt: 1 } },
      { type: "job_completed", data: { typeName: "test", output: { by: "workerless" } } },
      { type: "chain_completed", data: { typeName: "test" } },
      { type: "job_attempt_lost", data: { typeName: "test", attempt: 1 } },
      { type: "worker_stopped" },
    ]);
  });

  it("logs a lost attempt when the job is deleted during the attempt", async ({
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const started = Promise.withResolvers<void>();
    const deleted = Promise.withResolvers<void>();
    await using workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              started.resolve();
              await deleted.promise;
              return withTransaction(async (txCtx) => complete({ ...txCtx, output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "test", input: null }),
    );

    await workerRunner.start();
    await started.promise;
    await withTransaction(async (txCtx) => client.deleteChains({ ...txCtx, ids: [chain.id] }));
    deleted.resolve();
    await vi.waitFor(
      () => {
        expect(log).toHaveBeenCalledWith(expect.objectContaining({ type: "job_attempt_lost" }));
      },
      { timeout: 5000 },
    );
    await workerRunner.close();

    expectLogs([
      { type: "chain_created", data: { typeName: "test" } },
      { type: "job_created", data: { typeName: "test" } },
      { type: "worker_started" },
      { type: "job_attempt_started", data: { typeName: "test", attempt: 1 } },
      { type: "chain_deleted", data: { id: chain.id } },
      { type: "job_attempt_lost", data: { typeName: "test", attempt: 1 } },
      { type: "worker_stopped" },
    ]);
  });

  it("logs state adapter and worker errors", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    // Wrap startJobAttempts to throw once — triggers both
    // state_adapter_error (from logging middleware) and worker_error (from worker loop catch)
    let errorThrown = false;
    const erroringStateAdapter: typeof stateAdapter = {
      ...stateAdapter,
      startJobAttempts: async (args) => {
        if (!errorThrown) {
          errorThrown = true;
          throw new Error("connection error");
        }
        return stateAdapter.startJobAttempts(args);
      },
    };

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const workerClient = createClient({
      stateAdapter: erroringStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    await using workerRunner = createWorkerRunner({
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
              return withTransaction(async (txCtx) => complete({ ...txCtx, output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "test", input: null }),
    );

    await workerRunner.start();
    await client.awaitChain(chain, completionOptions);
    await workerRunner.close();

    const logTypes = new Set(log.mock.calls.map((call) => call[0].type));
    expect(logTypes).toContain("state_adapter_error");
    expect(logTypes).toContain("worker_error");
  });

  it("logs notify adapter errors", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const failingNotifyAdapter: NotifyAdapter = {
      ...notifyAdapter,
      notifyJobsScheduled: async () => {
        throw new Error("notify error");
      },
    };

    const client = createClient({
      stateAdapter,
      notifyAdapter: failingNotifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    await using workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      pollIntervalMs: 100,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              return withTransaction(async (txCtx) => complete({ ...txCtx, output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "test", input: null }),
    );

    await workerRunner.start();
    await client.awaitChain(chain, {
      pollIntervalMs: 100,
      timeoutMs: 5000,
    });
    await workerRunner.close();

    const notifyErrorLogs = log.mock.calls
      .map((call) => call[0])
      .filter((entry) => entry.type === "notify_adapter_error");

    expect(notifyErrorLogs.length).toBeGreaterThanOrEqual(1);
    expect(notifyErrorLogs[0]).toEqual(
      expect.objectContaining({
        type: "notify_adapter_error",
        level: "warn",
        data: expect.objectContaining({ operation: "notifyJobsScheduled" }),
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
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    await withTransaction(async (txCtx) => {
      await client.createChain({ ...txCtx, typeName: "test", input: null });
      throw new Error("simulated rollback");
    }).catch(() => {});

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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    await withTransaction(async (txCtx) => {
      const blocker = await client.createChain({
        ...txCtx,
        typeName: "blocker",
        input: null,
      });
      await client.createChain({
        ...txCtx,
        typeName: "main",
        input: null,
        blockers: [blocker],
      });
      throw new Error("simulated rollback");
    }).catch(() => {});

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
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { result: number } };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "test", input: null }),
    );

    log.mockClear();

    await withTransaction(async (txCtx) => {
      await client.completeChain({
        ...txCtx,
        ...chain,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ complete }) => complete({ output: { result: 42 } })),
      });
      throw new Error("simulated rollback");
    }).catch(() => {});

    const logTypes = log.mock.calls.map((call) => call[0].type);
    expect(logTypes).not.toContain("job_completed");
    expect(logTypes).not.toContain("chain_completed");
  });

  it("discards completion events on worker complete rollback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const workerClient = createClient({
      stateAdapter: erroringStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    await using workerRunner = createWorkerRunner({
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
              withTransaction(async (txCtx) => complete({ ...txCtx, output: null })),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "test", input: null }),
    );

    await workerRunner.start();
    await client.awaitChain(chain, completionOptions);
    await workerRunner.close();

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
    observabilityAdapter,
    log,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const workerClient = createClient({
      stateAdapter: erroringStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    await using workerRunner = createWorkerRunner({
      client: workerClient,
      concurrency: 1,
      pollIntervalMs: 50,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              if (!handlerFailed) {
                handlerFailed = true;
                throw new Error("simulated handler failure");
              }
              return withTransaction(async (txCtx) => complete({ ...txCtx, output: null }));
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "test", input: null }),
    );

    await workerRunner.start();
    await client.awaitChain(chain, completionOptions);
    await workerRunner.close();

    const logEntries = log.mock.calls.map((call) => call[0]);
    const attemptFailedCount = logEntries.filter((e) => e.type === "job_attempt_failed").length;
    expect(attemptFailedCount).toBe(0);
  });

  it("discards continuation events when user callback throws after continueWith", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    let throwOnce = true;
    await using workerRunner = createWorkerRunner({
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
              withTransaction(async (txCtx) => {
                const result = await complete({
                  ...txCtx,
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
              withTransaction(async (txCtx) => complete({ ...txCtx, output: null })),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "linear", input: null }),
    );

    await workerRunner.start();
    await client.awaitChain(chain, completionOptions);
    await workerRunner.close();

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
    observabilityAdapter,
    log,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const workerClient = createClient({
      stateAdapter: erroringStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    await using workerRunner = createWorkerRunner({
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
              withTransaction(async (txCtx) => complete({ ...txCtx, output: null })),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx) => {
      const created = await client.createChain({
        ...txCtx,
        typeName: "test",
        input: null,
      });
      await client.createChain({
        ...txCtx,
        typeName: "dependent",
        input: null,
        blockers: [created],
      });
      return created;
    });

    await workerRunner.start();
    await client.awaitChain(chain, completionOptions);
    await workerRunner.close();

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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const erroringClient = createClient({
      stateAdapter: erroringStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransaction(async (txCtx) => {
      const created = await client.createChain({
        ...txCtx,
        typeName: "test",
        input: null,
      });
      await client.createChain({
        ...txCtx,
        typeName: "dependent",
        input: null,
        blockers: [created],
      });
      return created;
    });

    log.mockClear();

    // First attempt: unblockJobs fails inside finishJob → entire transaction rolls back
    await withTransaction(async (txCtx) =>
      erroringClient.completeChain({
        ...txCtx,
        ...chain,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ complete }) => complete({ output: { result: 42 } })),
      }),
    ).catch(() => {});

    const logTypesAfterFailure = log.mock.calls.map((call) => call[0].type);
    expect(logTypesAfterFailure).not.toContain("job_completed");
    expect(logTypesAfterFailure).not.toContain("chain_completed");

    // Second attempt: succeeds
    await withTransaction(async (txCtx) =>
      client.completeChain({
        ...txCtx,
        ...chain,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ complete }) => complete({ output: { result: 42 } })),
      }),
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
    observabilityAdapter,
    log,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const workerClient = createClient({
      stateAdapter: erroringStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    await using workerRunner = createWorkerRunner({
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
              withTransaction(async (txCtx) =>
                complete({
                  ...txCtx,
                  continueWith: { typeName: "linear_next", input: null },
                }),
              ),
          },
          linear_next: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx) => complete({ ...txCtx, output: null })),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "linear", input: null }),
    );

    await workerRunner.start();
    await client.awaitChain(chain, completionOptions);
    await workerRunner.close();

    const logEntries = log.mock.calls.map((call) => call[0]);
    const continuationCreated = logEntries.filter(
      (e) => e.type === "job_created" && e.data.typeName === "linear_next",
    );
    const attemptFailedCount = logEntries.filter((e) => e.type === "job_attempt_failed").length;

    expect(continuationCreated).toHaveLength(1);
    expect(attemptFailedCount).toBe(1);
  });

  it("logs creation events only for the first of two deduplicated chains", async ({
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const create = async () =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
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

    expectLogs([
      { type: "chain_created", data: { typeName: "test" } },
      { type: "job_created", data: { typeName: "test" } },
    ]);
  });

  it("logs creation events only for the new chain of a batch with a deduplicated chain", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectLogs,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: { value: number }; output: null };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    await withTransaction(async (txCtx) =>
      client.createChain({
        ...txCtx,
        typeName: "test",
        input: { value: 1 },
        deduplication: { key: "existing", scope: "running" },
      }),
    );

    const [deduplicatedChain, newChain] = await withTransaction(async (txCtx) =>
      client.createChains({
        ...txCtx,
        items: [
          {
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "existing", scope: "running" },
          },
          { typeName: "test", input: { value: 3 } },
        ],
      }),
    );
    expect(deduplicatedChain.deduplicated).toBe(true);
    expect(newChain.deduplicated).toBe(false);

    expectLogs([
      { type: "chain_created", data: { input: { value: 1 } } },
      { type: "job_created", data: { input: { value: 1 } } },
      { type: "chain_created", data: { id: newChain.id, input: { value: 3 } } },
      { type: "job_created", data: { chainId: newChain.id, input: { value: 3 } } },
    ]);
  });

  it("logs creation events of a batch with blockers job by job", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expectLogs,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: { entry: true; input: null; output: null };
      alpha: { entry: true; input: null; output: null; blockers: [{ typeName: "blocker" }] };
      beta: { entry: true; input: null; output: null; blockers: [{ typeName: "blocker" }] };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const blockerChain = await withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "blocker", input: null }),
    );
    log.mockClear();

    await withTransaction(async (txCtx) =>
      client.createChains({
        ...txCtx,
        items: [
          { typeName: "alpha", input: null, blockers: [blockerChain] },
          { typeName: "beta", input: null, blockers: [blockerChain] },
        ],
      }),
    );

    expectLogs([
      { type: "chain_created", data: { typeName: "alpha" } },
      { type: "job_created", data: { typeName: "alpha" } },
      { type: "job_blocked", data: { typeName: "alpha" } },
      { type: "chain_created", data: { typeName: "beta" } },
      { type: "job_created", data: { typeName: "beta" } },
      { type: "job_blocked", data: { typeName: "beta" } },
    ]);
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "test", input: null }),
    );

    await withTransaction(async (txCtx) => client.deleteChains({ ...txCtx, ids: [chain.id] }));

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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransaction(async (txCtx) =>
      client.createChain({
        ...txCtx,
        typeName: "test",
        input: null,
        schedule: { afterMs: 60 * 60 * 1000 },
      }),
    );

    await withTransaction(async (txCtx) => client.rescheduleJob({ ...txCtx, id: chain.id }));

    expectLogs([
      { type: "chain_created", data: { typeName: "test" } },
      { type: "job_created", data: { typeName: "test" } },
      {
        type: "job_rescheduled",
        data: {
          id: chain.id,
          typeName: "test",
          chainId: chain.id,
          chainTypeName: "test",
        },
      },
    ]);
  });
});
