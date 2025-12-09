import { PoolClient } from "pg";
import { test as baseTest, describe, expectTypeOf, MockedFunction, vi } from "vitest";
import { extendWithDb } from "./db.spec-helper.js";
import { sleep } from "./helpers/timers.js";
import {
  CompletedJobChain,
  createQueuert,
  DefineQueueRef,
  defineUnionQueues,
  JobChain,
  LeaseConfig,
  Log,
  NotifyAdapter,
  Queuert,
  rescheduleJob,
} from "./index.js";
import { createInProcessNotifyAdapter } from "./notify-adapter/notify-adapter.in-process.js";
import { LeaseExpiredError } from "./queuert-helper.js";
import { StateAdapter } from "./state-adapter/state-adapter.js";
import { createPgStateAdapter } from "./state-adapter/state-adapter.pg.js";
import { PgPoolProvider } from "./state-provider/state-provider.pg-pool.js";

const test = extendWithDb(baseTest, import.meta.url).extend<{
  stateAdapter: StateAdapter;
  notifyAdapter: NotifyAdapter;
  runInTransactionWithNotify: <T>(
    queuert: Queuert<PgPoolProvider, any>,
    cb: (context: { client: PoolClient }) => Promise<T>,
  ) => Promise<T>;
  withWorkers: <T>(workers: (() => Promise<void>)[], cb: () => Promise<T>) => Promise<T>;
  waitForJobChainsCompleted: <TChains extends JobChain<any, any, any>[]>(
    queuert: Queuert<PgPoolProvider, any>,
    chains: TChains,
  ) => Promise<{ [K in keyof TChains]: CompletedJobChain<TChains[K]> }>;
  log: MockedFunction<Log>;
  expectLogs: (
    expected: {
      type: string;
      args?: [Record<string, unknown>] | [Record<string, unknown>, unknown];
    }[],
  ) => void;
}>({
  stateAdapter: [
    // oxlint-disable-next-line no-empty-pattern
    async ({ stateProvider }, use) => {
      await use(
        createPgStateAdapter({
          stateProvider,
        }),
      );
    },
    { scope: "test" },
  ],
  notifyAdapter: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(createInProcessNotifyAdapter());
    },
    { scope: "test" },
  ],
  runInTransactionWithNotify: [
    // oxlint-disable-next-line no-empty-pattern
    async ({ stateProvider }, use) => {
      await use(async (queuert, cb) => {
        return stateProvider.provideContext((context) =>
          queuert.withNotify(() => stateProvider.runInTransaction(context, cb)),
        );
      });
    },
    { scope: "test" },
  ],
  withWorkers: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(async (workers, cb) => {
        try {
          return await cb();
        } catch (error) {
          console.error("Error during withWorkers execution:", error);
          throw error;
        } finally {
          await Promise.all(workers.map((w) => w()));
        }
      });
    },
    { scope: "test" },
  ],
  waitForJobChainsCompleted: [
    async ({ stateProvider, expect }, use) => {
      await use((queuert, chains) =>
        vi.waitFor(
          async () => {
            const latestChains = await stateProvider.provideContext(({ client }) =>
              Promise.all(
                chains.map(async (chain) =>
                  queuert.getJobChain({
                    client,
                    id: chain.id,
                    chainName: chain.chainName,
                  }),
                ),
              ),
            );

            if (latestChains.some((chain) => !chain)) {
              expect(latestChains).toBeDefined();
            }
            if (latestChains.some((chain) => chain!.status !== "completed")) {
              expect(latestChains.map((chain) => chain!.status)).toEqual(
                latestChains.map(() => expect.objectContaining({ status: "completed" })),
              );
            }
            return latestChains as {
              [K in keyof typeof chains]: CompletedJobChain<(typeof chains)[K]>;
            };
          },
          { timeout: 2000, interval: 10 },
        ),
      );
    },
    { scope: "test" },
  ],
  log: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(
        vi.fn<Log>(async ({ level, message, args }) => {
          console[level](`[${level}] ${message}`, ...args);
        }),
      );
    },
    { scope: "test" },
  ],
  expectLogs: [
    async ({ log, expect }, use) => {
      await use((expected) => {
        expect(log.mock.calls.map((call) => call[0])).toEqual(
          expected.map((entry) =>
            entry.args
              ? expect.objectContaining({
                  type: entry.type,
                  args: [
                    expect.objectContaining(entry.args[0]),
                    ...(entry.args[1] ? [entry.args[1]] : []),
                  ],
                })
              : expect.objectContaining({ type: entry.type }),
          ),
        );
      });
    },
    { scope: "test" },
  ],
});

describe("Handler", () => {
  test("executes long-running jobs", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expectLogs,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        test: {
          input: { test: boolean };
          output: { result: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().setupQueueHandler({
      name: "test",
      handler: async ({ job, claim, finalize }) => {
        expectTypeOf(job.id).toEqualTypeOf<string>();
        expectTypeOf(job.input).toEqualTypeOf<{ test: boolean }>();
        expect(job.id).toBeDefined();
        expect(job.chainId).toEqual(job.id);
        expect(job.originId).toBeNull();
        expect(job.rootId).toEqual(job.id);
        expect(job.input.test).toBeDefined();

        const result = await claim(({ client }) => {
          expectTypeOf(client).toEqualTypeOf<PoolClient>();

          expect(client).toBeDefined();

          return "prepare";
        });
        expect(result).toEqual("prepare");

        return finalize(({ client }) => {
          expectTypeOf(client).toEqualTypeOf<PoolClient>();

          expect(client).toBeDefined();

          return { result: true };
        });
      },
    });

    const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
      queuert.enqueueJobChain({
        client,
        chainName: "test",
        input: { test: true },
      }),
    );
    expectTypeOf<CompletedJobChain<typeof jobChain>["output"]>().toEqualTypeOf<{
      result: boolean;
    }>();

    await withWorkers([await worker.start({ workerId: "worker" })], async () => {
      const [succeededJobChain] = await waitForJobChainsCompleted(queuert, [jobChain]);

      expect(succeededJobChain.output).toEqual({ result: true });
    });

    const workerArgs = { workerId: "worker" };
    const jobChainArgs = {
      chainName: "test",
      chainId: jobChain.id,
      rootId: jobChain.id,
      originId: null,
    };
    const jobArgs = {
      queueName: "test",
      jobId: jobChain.id,
      rootId: jobChain.id,
      originId: null,
      chainId: jobChain.id,
    };
    expectLogs([
      { type: "job_chain_created", args: [{ ...jobChainArgs, input: { test: true } }] },
      { type: "job_created", args: [{ ...jobArgs, input: { test: true } }] },
      { type: "worker_started", args: [{ ...workerArgs, queueNames: ["test"] }] },
      {
        type: "job_acquired",
        args: [{ ...jobArgs, status: "created", attempt: 0, ...workerArgs }],
      },
      {
        type: "job_completed",
        args: [{ ...jobArgs, output: { result: true }, ...workerArgs }],
      },
      { type: "job_chain_completed", args: [{ ...jobChainArgs, output: { result: true } }] },
      { type: "worker_stopping", args: [{ ...workerArgs }] },
      { type: "worker_stopped", args: [{ ...workerArgs }] },
    ]);
  });

  test("allows to extend job lease after lease expiration if wasn't grabbed by another worker", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        test: {
          input: null;
          output: null;
        };
      }>(),
    });

    const worker = queuert.createWorker().setupQueueHandler({
      name: "test",
      handler: async ({ claim, finalize }) => {
        await claim(() => {});

        await sleep(100);

        return finalize(() => null);
      },
    });

    await withWorkers(
      [await worker.start({ leaseConfig: { leaseMs: 1, renewIntervalMs: 100 } })],
      async () => {
        const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
          queuert.enqueueJobChain({
            client,
            chainName: "test",
            input: null,
          }),
        );

        const [succeededJobChain] = await waitForJobChainsCompleted(queuert, [jobChain]);

        expect(succeededJobChain.output).toBeNull();
        expect(log).toHaveBeenCalledWith(
          expect.objectContaining({
            level: "warn",
            message: expect.stringContaining("expired"),
          }),
        );
      },
    );
  });

  test("executes a job only once", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    const handler = vi.fn(async ({ claim, finalize }) => {
      await claim(() => {});

      return finalize(() => ({ success: true }));
    });

    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        test: {
          input: { test: boolean };
          output: { success: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().setupQueueHandler({
      name: "test",
      handler: handler,
    });

    await withWorkers([await worker.start(), await worker.start()], async () => {
      const job = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client: client,
          chainName: "test",
          input: { test: true },
        }),
      );

      await waitForJobChainsCompleted(queuert, [job]);

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  test("provides attempt information to job handler", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        test: {
          input: null;
          output: null;
        };
      }>(),
    });

    const attempts: number[] = [];

    const worker = queuert.createWorker().setupQueueHandler({
      name: "test",
      handler: async ({ job, finalize }) => {
        attempts.push(job.attempt);

        expectTypeOf(job.attempt).toEqualTypeOf<number>();
        expectTypeOf(job.lastAttemptAt).toEqualTypeOf<Date | null>();
        expectTypeOf(job.lastAttemptError).toEqualTypeOf<string | null>();

        expect(job.attempt).toBeGreaterThan(0);
        if (job.attempt > 1) {
          expect(job.lastAttemptAt).toBeInstanceOf(Date);
          expect(job.lastAttemptError).toBe("Simulated failure");
        } else {
          expect(job.lastAttemptAt).toBeNull();
          expect(job.lastAttemptError).toBeNull();
        }

        if (job.attempt < 3) {
          throw rescheduleJob(1, "Simulated failure");
        }

        return finalize(() => null);
      },
    });

    await withWorkers([await worker.start()], async () => {
      const job = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client: client,
          chainName: "test",
          input: null,
        }),
      );

      await waitForJobChainsCompleted(queuert, [job]);

      expect(attempts).toEqual([1, 2, 3]);
    });
  });

  test("uses exponential backoff for unexpected errors in all phases", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    type ErrorPhase = "claim" | "process" | "finalize";

    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        test: {
          input: { phase: ErrorPhase };
          output: null;
        };
      }>(),
    });

    const errors: { phase: ErrorPhase; error: string }[] = [];

    const worker = queuert.createWorker().setupQueueHandler({
      name: "test",
      handler: async ({ job, claim, finalize }) => {
        if (job.lastAttemptError) {
          errors.push({
            phase: job.input.phase,
            error: job.lastAttemptError,
          });
        }

        await claim(() => {
          if (job.input.phase === "claim" && job.attempt === 1) {
            throw new Error("Error in claim");
          }
        });

        if (job.input.phase === "process" && job.attempt === 1) {
          throw new Error("Error in process");
        }

        return finalize(() => {
          if (job.input.phase === "finalize" && job.attempt === 1) {
            throw new Error("Error in finalize");
          }
          return null;
        });
      },
    });

    await withWorkers(
      [
        await worker.start({
          retryConfig: {
            initialIntervalMs: 10,
            backoffCoefficient: 2.0,
            maxIntervalMs: 100,
          },
        }),
      ],
      async () => {
        const jobs = await Promise.all(
          (["claim", "process", "finalize"] as ErrorPhase[]).map((phase) =>
            runInTransactionWithNotify(queuert, ({ client }) =>
              queuert.enqueueJobChain({
                client,
                chainName: "test",
                input: { phase },
              }),
            ),
          ),
        );

        await waitForJobChainsCompleted(queuert, jobs);

        expect(errors).toHaveLength(3);
        expect(errors.find((e) => e.phase === "claim")?.error).toBe("Error: Error in claim");
        expect(errors.find((e) => e.phase === "process")?.error).toBe("Error: Error in process");
        expect(errors.find((e) => e.phase === "finalize")?.error).toBe("Error: Error in finalize");
      },
    );
  });

  test("uses exponential backoff progression for repeated failures", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expectLogs,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        test: {
          input: null;
          output: null;
        };
      }>(),
    });

    const errors: string[] = [];

    const worker = queuert.createWorker().setupQueueHandler({
      name: "test",
      handler: async ({ job, finalize }) => {
        if (job.lastAttemptError) {
          errors.push(job.lastAttemptError);
        }

        if (job.attempt < 4) {
          throw new Error("Unexpected error");
        }

        return finalize(() => null);
      },
    });

    const retryConfig = {
      initialIntervalMs: 10,
      backoffCoefficient: 2.0,
      maxIntervalMs: 100,
    };

    await withWorkers([await worker.start({ retryConfig })], async () => {
      const job = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "test",
          input: null,
        }),
      );

      await waitForJobChainsCompleted(queuert, [job]);

      // Verify exponential backoff: 10ms, 20ms, 40ms
      expect(errors).toHaveLength(3);
      expect(errors[0]).toBe("Error: Unexpected error");
      expect(errors[1]).toBe("Error: Unexpected error");
      expect(errors[2]).toBe("Error: Unexpected error");
    });

    expectLogs([
      { type: "worker_started" },
      { type: "job_chain_created" },
      { type: "job_created" },
      { type: "job_acquired" },
      { type: "job_attempt_failed", args: [{ rescheduledAfterMs: 10 }, expect.anything()] },
      { type: "job_acquired" },
      { type: "job_attempt_failed", args: [{ rescheduledAfterMs: 20 }, expect.anything()] },
      { type: "job_acquired" },
      { type: "job_attempt_failed", args: [{ rescheduledAfterMs: 40 }, expect.anything()] },
      { type: "job_acquired" },
      { type: "job_completed" },
      { type: "job_chain_completed" },
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);
  });

  test("handles rescheduled errors in all phases", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    type ErrorPhase = "claim" | "process" | "finalize";

    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        test: {
          input: { phase: ErrorPhase };
          output: null;
        };
      }>(),
    });

    const errors: { phase: ErrorPhase; error: string }[] = [];

    const worker = queuert.createWorker().setupQueueHandler({
      name: "test",
      handler: async ({ job, claim, finalize }) => {
        if (job.lastAttemptError) {
          errors.push({
            phase: job.input.phase,
            error: job.lastAttemptError,
          });
        }

        await claim(() => {
          if (job.input.phase === "claim" && job.attempt === 1) {
            throw rescheduleJob(1, "Rescheduled in claim");
          }
        });

        if (job.input.phase === "process" && job.attempt === 1) {
          throw rescheduleJob(1, "Rescheduled in process");
        }

        return finalize(() => {
          if (job.input.phase === "finalize" && job.attempt === 1) {
            throw rescheduleJob(1, "Rescheduled in finalize");
          }
          return null;
        });
      },
    });

    await withWorkers([await worker.start()], async () => {
      const jobs = await Promise.all(
        (["claim", "process", "finalize"] as ErrorPhase[]).map((phase) =>
          runInTransactionWithNotify(queuert, ({ client }) =>
            queuert.enqueueJobChain({
              client,
              chainName: "test",
              input: { phase },
            }),
          ),
        ),
      );

      await waitForJobChainsCompleted(queuert, jobs);

      expect(errors).toHaveLength(3);
      expect(errors.find((e) => e.phase === "claim")?.error).toBe("Rescheduled in claim");
      expect(errors.find((e) => e.phase === "process")?.error).toBe("Rescheduled in process");
      expect(errors.find((e) => e.phase === "finalize")?.error).toBe("Rescheduled in finalize");
    });
  });
});

describe("Reaper", () => {
  test("reaps abandoned jobs on heartbeat", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        test: {
          input: null;
          output: null;
        };
      }>(),
    });

    let failed = false;
    const { promise: startPromise, resolve: startResolve } = Promise.withResolvers<void>();
    const { promise: endPromise, resolve: endResolve } = Promise.withResolvers<void>();
    const leaseConfig = { leaseMs: 1, renewIntervalMs: 100 } satisfies LeaseConfig;

    const worker = queuert.createWorker().setupQueueHandler({
      name: "test",
      handler: async ({ signal, claim, finalize }) => {
        await claim(async () => {});

        if (!failed) {
          failed = true;

          startResolve();
          try {
            await sleep(leaseConfig.renewIntervalMs * 2, { signal });
          } finally {
            expect(signal.aborted).toBe(true);
            expect(signal.reason).toEqual("lease_expired");
            endResolve();
          }
        }

        return finalize(async () => null);
      },
    });

    await withWorkers(
      [await worker.start({ leaseConfig }), await worker.start({ leaseConfig })],
      async () => {
        const failJobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
          queuert.enqueueJobChain({
            client,
            chainName: "test",
            input: null,
          }),
        );

        await startPromise;

        const successJobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
          queuert.enqueueJobChain({
            client,
            chainName: "test",
            input: null,
          }),
        );

        const [succeededSuccessJobChain, succeededFailJobChain] = await waitForJobChainsCompleted(
          queuert,
          [successJobChain, failJobChain],
        );

        expect(succeededSuccessJobChain.output).toEqual(null);
        expect(succeededFailJobChain.output).toEqual(null);

        await endPromise;
      },
    );
    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worker_error",
      }),
    );
  });

  test("reaps abandoned jobs on finalize", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        test: {
          input: null;
          output: null;
        };
      }>(),
    });

    let failed = false;
    const { promise: startPromise, resolve: startResolve } = Promise.withResolvers<void>();
    const { promise: endPromise, resolve: endResolve } = Promise.withResolvers<void>();
    const leaseConfig = { leaseMs: 1, renewIntervalMs: 100 } satisfies LeaseConfig;

    const worker = queuert.createWorker().setupQueueHandler({
      name: "test",
      handler: async ({ claim, finalize }) => {
        await claim(async () => {});

        if (!failed) {
          failed = true;

          startResolve();
          await sleep(leaseConfig.renewIntervalMs * 2);
          await expect(() => finalize(async () => null)).rejects.toThrow(LeaseExpiredError);
          endResolve();
        }

        return finalize(async () => null);
      },
    });

    await withWorkers(
      [await worker.start({ leaseConfig }), await worker.start({ leaseConfig })],
      async () => {
        const failJobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
          queuert.enqueueJobChain({
            client,
            chainName: "test",
            input: null,
          }),
        );

        await startPromise;

        const successJobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
          queuert.enqueueJobChain({
            client,
            chainName: "test",
            input: null,
          }),
        );

        const [succeededSuccessJobChain, succeededFailJobChain] = await waitForJobChainsCompleted(
          queuert,
          [successJobChain, failJobChain],
        );

        expect(succeededSuccessJobChain.output).toEqual(null);
        expect(succeededFailJobChain.output).toEqual(null);

        await endPromise;
      },
    );

    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worker_error",
      }),
    );
  });
});

describe("Worker", () => {
  test("processes jobs in order", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    const processedJobs: number[] = [];

    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        test: {
          input: { jobNumber: number };
          output: { success: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().setupQueueHandler({
      name: "test",
      handler: async ({ job, finalize }) => {
        processedJobs.push(job.input.jobNumber);

        return finalize(() => {
          return { success: true };
        });
      },
    });

    await withWorkers([await worker.start()], async () => {
      const jobs = [];
      for (let i = 0; i < 5; i++) {
        jobs.push(
          await runInTransactionWithNotify(queuert, ({ client }) =>
            queuert.enqueueJobChain({
              client: client,
              chainName: "test",
              input: { jobNumber: i },
            }),
          ),
        );
      }

      await waitForJobChainsCompleted(queuert, jobs);

      expect(processedJobs).toEqual([0, 1, 2, 3, 4]);
    });
  });

  test("processes jobs in order distributed across workers", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    const processedJobs: number[] = [];

    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        test: {
          input: { jobNumber: number };
          output: { success: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().setupQueueHandler({
      name: "test",
      handler: async ({ job, finalize }) => {
        processedJobs.push(job.input.jobNumber);

        return finalize(() => {
          return { success: true };
        });
      },
    });

    await withWorkers([await worker.start(), await worker.start()], async () => {
      const jobs = [];
      for (let i = 0; i < 5; i++) {
        jobs.push(
          await runInTransactionWithNotify(queuert, ({ client }) =>
            queuert.enqueueJobChain({
              client: client,
              chainName: "test",
              input: { jobNumber: i },
            }),
          ),
        );
      }

      await waitForJobChainsCompleted(queuert, jobs);

      expect(processedJobs).toEqual([0, 1, 2, 3, 4]);
    });
  });
});

describe("Chains", () => {
  test("handles chained jobs", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expectLogs,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        linear: {
          input: { value: number };
          output: DefineQueueRef<"linear_next">;
        };
        linear_next: {
          input: { valueNext: number };
          output: DefineQueueRef<"linear_next_next">;
        };
        linear_next_next: {
          input: { valueNextNext: number };
          output: { result: number };
        };
      }>(),
    });

    let chainId: string;
    const originIds: string[] = [];

    const worker = queuert
      .createWorker()
      .setupQueueHandler({
        name: "linear",
        handler: async ({ job, finalize }) => {
          expect(job.id).toEqual(chainId);
          expect(job.chainId).toEqual(chainId);
          expect(job.originId).toBeNull();
          expect(job.rootId).toEqual(chainId);
          originIds.push(job.id);

          return finalize(({ client, continueWith }) => {
            expectTypeOf<
              Parameters<typeof continueWith>[0]["queueName"]
            >().toEqualTypeOf<"linear_next">();

            return continueWith({
              client,
              queueName: "linear_next",
              input: { valueNext: job.input.value + 1 },
            });
          });
        },
      })
      .setupQueueHandler({
        name: "linear_next",
        handler: async ({ job, finalize }) => {
          expect(job.id).not.toEqual(chainId);
          expect(job.chainId).toEqual(chainId);
          expect(job.originId).toEqual(originIds[0]);
          expect(job.rootId).toEqual(chainId);
          originIds.push(job.id);

          return finalize(({ client, continueWith }) => {
            expectTypeOf<
              Parameters<typeof continueWith>[0]["queueName"]
            >().toEqualTypeOf<"linear_next_next">();

            return continueWith({
              client,
              queueName: "linear_next_next",
              input: { valueNextNext: job.input.valueNext + 1 },
            });
          });
        },
      })
      .setupQueueHandler({
        name: "linear_next_next",
        handler: async ({ job, finalize }) => {
          expect(job.id).not.toEqual(chainId);
          expect(job.chainId).toEqual(chainId);
          expect(job.originId).toEqual(originIds[1]);
          expect(job.rootId).toEqual(chainId);

          return finalize(() => ({
            result: job.input.valueNextNext,
          }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, async ({ client }) => {
        const jobChain = await queuert.enqueueJobChain({
          client,
          chainName: "linear",
          input: { value: 1 },
        });

        chainId = jobChain.id;

        return jobChain;
      });
      expectTypeOf<CompletedJobChain<typeof jobChain>["output"]>().toEqualTypeOf<{
        result: number;
      }>();

      const [finishedJobChain] = await waitForJobChainsCompleted(queuert, [jobChain]);

      expect(finishedJobChain.output).toEqual({ result: 3 });
    });

    expectLogs([
      { type: "worker_started" },
      { type: "job_chain_created", args: [{ chainName: "linear" }] },
      { type: "job_created", args: [{ queueName: "linear" }] },
      { type: "job_acquired", args: [{ queueName: "linear" }] },
      {
        type: "job_created",
        args: [
          { queueName: "linear_next", chainId: chainId!, rootId: chainId!, originId: originIds[0] },
        ],
      },
      { type: "job_completed", args: [{ queueName: "linear" }] },
      { type: "job_acquired", args: [{ queueName: "linear_next" }] },
      {
        type: "job_created",
        args: [
          {
            queueName: "linear_next_next",
            chainId: chainId!,
            rootId: chainId!,
            originId: originIds[1],
          },
        ],
      },
      { type: "job_completed", args: [{ queueName: "linear_next" }] },
      { type: "job_acquired", args: [{ queueName: "linear_next_next" }] },
      { type: "job_completed", args: [{ queueName: "linear_next_next" }] },
      { type: "job_chain_completed", args: [{ chainName: "linear" }] },
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);
  });

  test("handles branched chains", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        main: {
          input: { value: number };
          output: DefineQueueRef<"branch1"> | DefineQueueRef<"branch2">;
        };
        branch1: {
          input: { valueBranched: number };
          output: { result1: number };
        };
        branch2: {
          input: { valueBranched: number };
          output: { result2: number };
        };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .setupQueueHandler({
        name: "main",
        handler: async ({ job, finalize }) => {
          return finalize(({ client, continueWith }) => {
            expectTypeOf<Parameters<typeof continueWith>[0]["queueName"]>().toEqualTypeOf<
              "branch1" | "branch2"
            >();

            return continueWith({
              client,
              queueName: job.input.value % 2 === 0 ? "branch1" : "branch2",
              input: { valueBranched: job.input.value },
            });
          });
        },
      })
      .setupQueueHandler({
        name: "branch1",
        handler: async ({ job, finalize }) => {
          return finalize(() => ({
            result1: job.input.valueBranched,
          }));
        },
      })
      .setupQueueHandler({
        name: "branch2",
        handler: async ({ job, finalize }) => {
          return finalize(() => ({
            result2: job.input.valueBranched,
          }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const evenJobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "main",
          input: { value: 2 },
        }),
      );
      const oddJobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "main",
          input: { value: 3 },
        }),
      );

      expectTypeOf<CompletedJobChain<typeof evenJobChain>["output"]>().toEqualTypeOf<
        { result1: number } | { result2: number }
      >();

      const [succeededJobEven, succeededJobOdd] = await waitForJobChainsCompleted(queuert, [
        evenJobChain,
        oddJobChain,
      ]);

      expect(succeededJobEven.output).toEqual({ result1: 2 });
      expect(succeededJobOdd.output).toEqual({ result2: 3 });
    });
  });

  test("handles loops", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        loop: {
          input: { counter: number };
          output: DefineQueueRef<"loop"> | { done: true };
        };
      }>(),
    });

    const worker = queuert.createWorker().setupQueueHandler({
      name: "loop",
      handler: async ({ job, finalize }) => {
        return finalize(({ client, continueWith }) => {
          expectTypeOf<Parameters<typeof continueWith>[0]["queueName"]>().toEqualTypeOf<"loop">();

          return job.input.counter < 3
            ? continueWith({
                client,
                queueName: "loop",
                input: { counter: job.input.counter + 1 },
              })
            : { done: true };
        });
      },
    });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "loop",
          input: { counter: 0 },
        }),
      );

      expectTypeOf<CompletedJobChain<typeof jobChain>["output"]>().toEqualTypeOf<{ done: true }>();

      const [succeededJobChain] = await waitForJobChainsCompleted(queuert, [jobChain]);

      expect(succeededJobChain.output).toEqual({ done: true });
    });
  });

  test("handles go-to", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        start: {
          input: { value: number };
          output: DefineQueueRef<"end">;
        };
        end: {
          input: { result: number };
          output: DefineQueueRef<"start"> | { finalResult: number };
        };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .setupQueueHandler({
        name: "start",
        handler: async ({ job, finalize }) => {
          return finalize(({ client, continueWith }) => {
            expectTypeOf<Parameters<typeof continueWith>[0]["queueName"]>().toEqualTypeOf<"end">();

            return continueWith({
              client,
              queueName: "end",
              input: { result: job.input.value + 1 },
            });
          });
        },
      })
      .setupQueueHandler({
        name: "end",
        handler: async ({ job, finalize }) => {
          return finalize(({ client, continueWith }) => {
            expectTypeOf<
              Parameters<typeof continueWith>[0]["queueName"]
            >().toEqualTypeOf<"start">();

            if (job.input.result < 3) {
              return continueWith({
                client,
                queueName: "start",
                input: { value: job.input.result },
              });
            } else {
              return { finalResult: job.input.result };
            }
          });
        },
      });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "start",
          input: { value: 0 },
        }),
      );

      expectTypeOf<CompletedJobChain<typeof jobChain>["output"]>().toEqualTypeOf<{
        finalResult: number;
      }>();

      const [succeededJobChain] = await waitForJobChainsCompleted(queuert, [jobChain]);

      expect(succeededJobChain.output).toEqual({ finalResult: 3 });
    });
  });
});

describe("Blocker Chains", () => {
  test("handles long blocker chains", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
    expectLogs,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        blocker: {
          input: { value: number };
          output: DefineQueueRef<"blocker"> | { done: true };
        };
        main: {
          input: { start: boolean };
          output: { finalResult: number };
        };
      }>(),
    });

    let mainChainId: string;
    let dependencyChainId: string;
    let originId: string;

    const worker = queuert
      .createWorker()
      .setupQueueHandler({
        name: "blocker",
        handler: async ({ job, finalize }) => {
          expect(job.chainId).toEqual(dependencyChainId);
          expect(job.rootId).toEqual(mainChainId);
          expect(job.originId).toEqual(originId);
          originId = job.id;

          return finalize(({ client, continueWith }) =>
            job.input.value < 1
              ? continueWith({
                  client,
                  queueName: "blocker",
                  input: { value: job.input.value + 1 },
                })
              : { done: true },
          );
        },
      })
      .setupQueueHandler({
        name: "main",
        enqueueBlockerJobChains: async ({ job, client }) => {
          const dependencyJobChain = await queuert.enqueueJobChain({
            client,
            chainName: "blocker",
            input: { value: 0 },
          });

          originId = job.id;
          dependencyChainId = dependencyJobChain.id;

          return [dependencyJobChain];
        },
        handler: async ({ job, blockers: [blocker], finalize }) => {
          expectTypeOf<(typeof blocker)["output"]>().toEqualTypeOf<{
            done: true;
          }>();

          expectTypeOf<(typeof blocker)["originId"]>().toEqualTypeOf<string | null>();
          expect(blocker.originId).toEqual(job.id);

          return finalize(() => ({
            finalResult: (blocker.output.done ? 1 : 0) + (job.input.start ? 1 : 0),
          }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, async ({ client }) => {
        const jobChain = await queuert.enqueueJobChain({
          client,
          chainName: "main",
          input: { start: true },
        });

        mainChainId = jobChain.id;

        return jobChain;
      });

      const [succeededJobChain] = await waitForJobChainsCompleted(queuert, [jobChain]);

      expect(succeededJobChain.output).toEqual({ finalResult: 2 });
    });

    expectLogs([
      { type: "worker_started" },
      // main chain created
      { type: "job_chain_created", args: [{ chainName: "main" }] },
      { type: "job_created", args: [{ queueName: "main" }] },
      { type: "job_acquired", args: [{ queueName: "main" }] },
      // blocker chain created as dependency
      {
        type: "job_chain_created",
        args: [{ chainName: "blocker", rootId: mainChainId!, originId: mainChainId! }],
      },
      { type: "job_created", args: [{ queueName: "blocker" }] },
      { type: "job_blockers_added", args: [{ queueName: "main" }] },
      { type: "job_blocked", args: [{ queueName: "main" }] },
      // first blocker job processed
      { type: "job_acquired", args: [{ queueName: "blocker" }] },
      { type: "job_created", args: [{ queueName: "blocker" }] },
      { type: "job_completed", args: [{ queueName: "blocker" }] },
      // second blocker job processed, chain completes
      { type: "job_acquired", args: [{ queueName: "blocker" }] },
      { type: "job_completed", args: [{ queueName: "blocker" }] },
      { type: "job_chain_completed", args: [{ chainName: "blocker" }] },
      // main job unblocked and completed
      { type: "job_chain_unblocked_jobs", args: [{ chainName: "blocker" }] },
      { type: "job_acquired", args: [{ queueName: "main" }] },
      { type: "job_completed", args: [{ queueName: "main" }] },
      { type: "job_chain_completed", args: [{ chainName: "main" }] },
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);
  });

  test("handles finalized blocker chains", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        blocker: {
          input: { value: number };
          output: { result: number };
        };
        main: {
          input: { blockerJobId: string };
          output: { finalResult: number };
        };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .setupQueueHandler({
        name: "blocker",
        handler: async ({ job, finalize }) => {
          expect(job.originId).toBeNull();

          return finalize(() => ({ result: job.input.value }));
        },
      })
      .setupQueueHandler({
        name: "main",
        enqueueBlockerJobChains: async ({ job, client }) => {
          const blockerJob = await queuert.getJobChain({
            client,
            id: job.input.blockerJobId,
            chainName: "blocker",
          });
          if (!blockerJob) {
            throw new Error("Blocker job not found");
          }
          return [blockerJob];
        },
        handler: async ({ blockers: [blocker], finalize }) => {
          expect(blocker.originId).toBeNull();

          return finalize(() => ({
            finalResult: blocker.output.result,
          }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const blockerJobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "blocker",
          input: { value: 1 },
        }),
      );

      const [succeededBlockerJobChain] = await waitForJobChainsCompleted(queuert, [
        blockerJobChain,
      ]);

      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "main",
          input: { blockerJobId: blockerJobChain.id },
        }),
      );

      const [succeededJobChain] = await waitForJobChainsCompleted(queuert, [jobChain]);

      expect(succeededJobChain.output).toEqual({
        finalResult: succeededBlockerJobChain.output.result,
      });
    });
  });

  test("handles blocker chains spawned during processing", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        inner: {
          input: null;
          output: null;
        };
        outer: {
          input: null;
          output: null;
        };
      }>(),
    });

    let childJobChains: JobChain<"inner", null, null>[] = [];
    let originId: string;

    const worker = queuert
      .createWorker()
      .setupQueueHandler({
        name: "inner",
        handler: async ({ job, finalize }) => {
          return finalize(() => {
            expect(job.originId).toEqual(originId);
            return null;
          });
        },
      })
      .setupQueueHandler({
        name: "outer",
        handler: async ({ job, claim, finalize }) => {
          await claim(async ({ client }) => {
            expect(job.originId).toBeNull();
            originId = job.id;

            childJobChains.push(
              await queuert.withNotify(() =>
                queuert.enqueueJobChain({
                  client,
                  chainName: "inner",
                  input: null,
                }),
              ),
            );

            return;
          });

          childJobChains.push(
            await runInTransactionWithNotify(queuert, ({ client }) =>
              queuert.enqueueJobChain({
                client,
                chainName: "inner",
                input: null,
              }),
            ),
          );

          return finalize(async ({ client }) => {
            childJobChains.push(
              await queuert.withNotify(() =>
                queuert.enqueueJobChain({
                  client,
                  chainName: "inner",
                  input: null,
                }),
              ),
            );

            return null;
          });
        },
      });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "outer",
          input: null,
        }),
      );

      await waitForJobChainsCompleted(queuert, [jobChain]);

      const succeededChildJobChains = await waitForJobChainsCompleted(queuert, childJobChains);

      expect(succeededChildJobChains).toHaveLength(3);
    });
  });

  test("handles chains that are distributed across workers", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        test: {
          input: { value: number };
          output: { valueNext: number };
        };
        finish: {
          input: { valueNext: number };
          output: { result: number };
        };
      }>(),
    });

    const worker1 = queuert.createWorker().setupQueueHandler({
      name: "test",
      handler: async ({ job, finalize }) => {
        return finalize(({ continueWith, client }) =>
          continueWith({
            client,
            queueName: "finish",
            input: { valueNext: job.input.value + 1 },
          }),
        );
      },
    });

    const worker2 = queuert.createWorker().setupQueueHandler({
      name: "finish",
      handler: async ({ job, finalize }) => {
        return finalize(() => ({
          result: job.input.valueNext + 1,
        }));
      },
    });

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "test",
          input: { value: 1 },
        }),
      );

      const [finishedJobChain] = await waitForJobChainsCompleted(queuert, [jobChain]);

      expect(finishedJobChain.output).toEqual({ result: 3 });
    });
  });

  test("handles multiple blocker chains", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        blocker: {
          input: { value: number };
          output: { result: number };
        };
        main: {
          input: { count: number };
          output: { finalResult: number[] };
        };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .setupQueueHandler({
        name: "blocker",
        handler: async ({ job, finalize }) => {
          return finalize(() => ({ result: job.input.value }));
        },
      })
      .setupQueueHandler({
        name: "main",
        enqueueBlockerJobChains: async ({ client, job }) => {
          const blockerChains = await Promise.all(
            Array.from({ length: job.input.count }, (_, i) =>
              queuert.enqueueJobChain({
                client,
                chainName: "blocker",
                input: { value: i + 1 },
              }),
            ),
          );
          return blockerChains;
        },
        handler: async ({ blockers, finalize }) => {
          return finalize(() => ({
            finalResult: blockers.map((blocker) => blocker.output.result),
          }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "main",
          input: { count: 5 },
        }),
      );

      const [succeededJobChain] = await waitForJobChainsCompleted(queuert, [jobChain]);

      expect(succeededJobChain.output).toEqual({
        finalResult: Array.from({ length: 5 }, (_, i) => i + 1),
      });
    });
  });
});
