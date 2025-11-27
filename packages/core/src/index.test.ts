import { PoolClient } from "pg";
import { test as baseTest, describe, expectTypeOf, vi } from "vitest";
import { extendWithDb } from "./db.spec-helper.js";
import { sleep } from "./helpers/timers.js";
import {
  createQueuert,
  DefineQueueRef,
  defineUnionQueues,
  FinishedJobChain,
  JobChain,
  Log,
  NotifyAdapter,
  Queuert,
  rescheduleJob,
} from "./index.js";
import { createInProcessNotifyAdapter } from "./notify-adapter/notify-adapter.in-process.js";
import { StateAdapter } from "./state-adapter/state-adapter.js";
import { createPgStateAdapter } from "./state-adapter/state-adapter.pg.js";
import { PgPoolProvider } from "./state-provider/state-provider.pg-pool.js";

const test = extendWithDb(baseTest, import.meta.url).extend<{
  stateAdapter: StateAdapter;
  notifyAdapter: NotifyAdapter;
  runInTransactionWithNotify: <T>(
    queuert: Queuert<PgPoolProvider, any>,
    cb: (context: { client: PoolClient }) => Promise<T>
  ) => Promise<T>;
  withWorkers: <T>(
    workers: (() => Promise<void>)[],
    cb: () => Promise<T>
  ) => Promise<T>;
  waitForJobChainsFinished: <TChains extends JobChain<any, any, any>[]>(
    queuert: Queuert<PgPoolProvider, any>,
    chains: TChains
  ) => Promise<{ [K in keyof TChains]: FinishedJobChain<TChains[K]> }>;
}>({
  stateAdapter: [
    // oxlint-disable-next-line no-empty-pattern
    async ({ stateProvider }, use) => {
      await use(
        createPgStateAdapter({
          stateProvider,
        })
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
          queuert.withNotify(() => stateProvider.runInTransaction(context, cb))
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
  waitForJobChainsFinished: [
    async ({ stateProvider, expect }, use) => {
      await use((queuert, chains) =>
        vi.waitFor(
          async () => {
            const latestChains = await stateProvider.provideContext(
              ({ client }) =>
                Promise.all(
                  chains.map(async (chain) =>
                    queuert.getJobChain({
                      client,
                      id: chain.id,
                      name: chain.chainName,
                    })
                  )
                )
            );

            if (latestChains.some((chain) => !chain)) {
              expect(latestChains).toBeDefined();
            }
            if (latestChains.some((chain) => chain!.status !== "finished")) {
              expect(latestChains.map((chain) => chain!.status)).toEqual(
                latestChains.map(() =>
                  expect.objectContaining({ status: "finished" })
                )
              );
            }
            return latestChains as {
              [K in keyof typeof chains]: FinishedJobChain<(typeof chains)[K]>;
            };
          },
          { timeout: 2000, interval: 10 }
        )
      );
    },
    { scope: "test" },
  ],
});

const log = vi.fn<Log>(async ({ level, message, args }) => {
  if (level === "debug") return; // suppress debug logs
  console[level](`[queuert] ${message}`, ...args);
});

describe("Handler", () => {
  test("executes long-running jobs", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
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
      handler: async ({ claim, heartbeat, finalize }) => {
        const result = await claim(async ({ job, client }) => {
          expectTypeOf(client).toEqualTypeOf<PoolClient>();
          expectTypeOf(job.id).toEqualTypeOf<string>();
          expectTypeOf(job.input).toEqualTypeOf<{ test: boolean }>();

          expect(client).toBeDefined();
          expect(job.id).toBeDefined();
          expect(job.input.test).toBeDefined();

          return "prepare";
        });
        expect(result).toEqual("prepare");

        await heartbeat({ leaseMs: 1000 });

        return finalize(async ({ client }) => {
          expectTypeOf(client).toEqualTypeOf<PoolClient>();

          expect(client).toBeDefined();

          return { result: true };
        });
      },
    });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "test",
          input: { test: true },
        })
      );

      expectTypeOf<
        FinishedJobChain<typeof jobChain>["output"]
      >().toEqualTypeOf<{
        result: boolean;
      }>();

      const [succeededJobChain] = await waitForJobChainsFinished(queuert, [
        jobChain,
      ]);

      expect(succeededJobChain.output).toEqual({ result: true });
    });
  });

  test("executes long-running jobs with automatic heartbeat", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
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
      handler: async ({ withHeartbeat, finalize }) => {
        const bool = await withHeartbeat(() => sleep(400).then(() => true), {
          intervalMs: 100,
          leaseMs: 1000,
        });

        return finalize(async () => {
          return { result: bool };
        });
      },
    });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "test",
          input: { test: true },
        })
      );

      const [succeededJobChain] = await waitForJobChainsFinished(queuert, [
        jobChain,
      ]);

      expect(succeededJobChain.output).toEqual({ result: true });
    });
  });

  test("executes long-running jobs with manual heartbeat", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
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
      handler: async ({ heartbeat, finalize }) => {
        await heartbeat({ leaseMs: 1000 });
        const bool = await sleep(400).then(() => true);

        return finalize(async () => ({ result: bool }));
      },
    });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "test",
          input: { test: true },
        })
      );

      const [succeededJobChain] = await waitForJobChainsFinished(queuert, [
        jobChain,
      ]);

      expect(succeededJobChain.output).toEqual({ result: true });
    });
  });

  test("allows to extend job lease after lease expiration if wasn't grabbed by another worker", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
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
      handler: async ({ heartbeat, finalize }) => {
        await heartbeat({ leaseMs: 1 });
        const bool = await sleep(100).then(() => true);
        await heartbeat({ leaseMs: 1000 });

        return finalize(async () => ({ result: bool }));
      },
    });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "test",
          input: { test: true },
        })
      );

      const [succeededJobChain] = await waitForJobChainsFinished(queuert, [
        jobChain,
      ]);

      expect(succeededJobChain.output).toEqual({ result: true });
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "warn",
          message: expect.stringContaining("expired"),
        })
      );
    });
  });

  test("allows to complete job after lease expiration if wasn't grabbed by another worker", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
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
      handler: async ({ heartbeat, finalize }) => {
        await heartbeat({ leaseMs: 1 });
        const bool = await sleep(100).then(() => true);

        return finalize(async () => ({ result: bool }));
      },
    });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "test",
          input: { test: true },
        })
      );

      const [succeededJobChain] = await waitForJobChainsFinished(queuert, [
        jobChain,
      ]);

      expect(succeededJobChain.output).toEqual({ result: true });
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "warn",
          message: expect.stringContaining("expired"),
        })
      );
    });
  });

  test("executes a job only once", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
    expect,
  }) => {
    const handler = vi.fn(async ({ heartbeat, finalize }) => {
      await heartbeat({ leaseMs: 1000 });
      await sleep(0);

      return finalize(async () => ({ success: true }));
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

    await withWorkers(
      [await worker.start(), await worker.start()],
      async () => {
        const job = await runInTransactionWithNotify(queuert, ({ client }) =>
          queuert.enqueueJobChain({
            client: client,
            chainName: "test",
            input: { test: true },
          })
        );

        await waitForJobChainsFinished(queuert, [job]);

        expect(handler).toHaveBeenCalledTimes(1);
      }
    );
  });

  test("handles job handler errors during claim", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
    expect,
  }) => {
    let simulateFailure = true;

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
      handler: async ({ claim, heartbeat, finalize }) => {
        await claim(async ({ job }) => {
          if (job.input.jobNumber === 2 && simulateFailure) {
            simulateFailure = false;
            rescheduleJob(100, "Simulated failure");
          }
          return job;
        });

        await heartbeat({ leaseMs: 1000 });

        return finalize(async () => {
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
            })
          )
        );
      }

      const succeededJobs = await waitForJobChainsFinished(queuert, jobs);

      expect(
        succeededJobs
          .toSorted((a, b) => a.finishedAt.getTime() - b.finishedAt.getTime())
          .map((job) => job.id)
      ).not.toEqual(jobs.map((job) => job.id));
    });
  });

  test("handles job handler errors during processing with opened claim transaction", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
    expect,
  }) => {
    let simulateFailure = true;

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
      handler: async ({ finalize }) => {
        if (simulateFailure) {
          simulateFailure = false;
          rescheduleJob(100, "Simulated failure");
        }

        return finalize(async () => {
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
            })
          )
        );
      }

      const succeededJobs = await waitForJobChainsFinished(queuert, jobs);

      expect(
        succeededJobs
          .toSorted((a, b) => a.finishedAt.getTime() - b.finishedAt.getTime())
          .map((job) => job.id)
      ).not.toEqual(jobs.map((job) => job.id));
    });
  });

  test("handles job handler errors during processing with closed claim transaction", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
    expect,
  }) => {
    let simulateFailure = true;

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
      handler: async ({ heartbeat, finalize }) => {
        await heartbeat({ leaseMs: 1000 });

        if (simulateFailure) {
          simulateFailure = false;
          rescheduleJob(100, "Simulated failure");
        }

        return finalize(async () => {
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
            })
          )
        );
      }

      const succeededJobs = await waitForJobChainsFinished(queuert, jobs);

      expect(
        succeededJobs
          .toSorted((a, b) => a.finishedAt.getTime() - b.finishedAt.getTime())
          .map((job) => job.id)
      ).not.toEqual(jobs.map((job) => job.id));
    });
  });

  test("handles job handler errors during finalization with opened claim transaction", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
    expect,
  }) => {
    let simulateFailure = true;

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
      handler: async ({ finalize }) => {
        return finalize(async () => {
          if (simulateFailure) {
            simulateFailure = false;
            rescheduleJob(100, "Simulated failure");
          }
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
            })
          )
        );
      }

      const succeededJobs = await waitForJobChainsFinished(queuert, jobs);

      expect(
        succeededJobs
          .toSorted((a, b) => a.finishedAt.getTime() - b.finishedAt.getTime())
          .map((job) => job.id)
      ).not.toEqual(jobs.map((job) => job.id));
    });
  });

  test("handles job handler errors during finalization with closed claim transaction", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
    expect,
  }) => {
    let simulateFailure = true;

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
      handler: async ({ heartbeat, finalize }) => {
        await heartbeat({ leaseMs: 1000 });

        return finalize(async () => {
          if (simulateFailure) {
            simulateFailure = false;
            rescheduleJob(100, "Simulated failure");
          }

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
            })
          )
        );
      }

      const succeededJobs = await waitForJobChainsFinished(queuert, jobs);

      expect(
        succeededJobs
          .toSorted((a, b) => a.finishedAt.getTime() - b.finishedAt.getTime())
          .map((job) => job.id)
      ).not.toEqual(jobs.map((job) => job.id));
    });
  });
});

describe("Worker", () => {
  test("processes jobs in order", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
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
      handler: async ({ claim, finalize }) => {
        const { job } = await claim(async ({ job }) => ({ job }));

        processedJobs.push(job.input.jobNumber);

        return finalize(async () => ({ success: true }));
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
            })
          )
        );
      }

      await waitForJobChainsFinished(queuert, jobs);

      expect(processedJobs).toEqual([0, 1, 2, 3, 4]);
    });
  });

  test("processes jobs in order distributed across workers", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
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
      handler: async ({ claim, finalize }) => {
        const { job } = await claim(async ({ job }) => ({ job }));

        processedJobs.push(job.input.jobNumber);

        return finalize(async () => ({ success: true }));
      },
    });

    await withWorkers(
      [await worker.start(), await worker.start()],
      async () => {
        const jobs = [];
        for (let i = 0; i < 5; i++) {
          jobs.push(
            await runInTransactionWithNotify(queuert, ({ client }) =>
              queuert.enqueueJobChain({
                client: client,
                chainName: "test",
                input: { jobNumber: i },
              })
            )
          );
        }

        await waitForJobChainsFinished(queuert, jobs);

        expect(processedJobs).toEqual([0, 1, 2, 3, 4]);
      }
    );
  });
});

describe("Chains", () => {
  test("handles chained jobs", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
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

    const worker = queuert
      .createWorker()
      .setupQueueHandler({
        name: "linear",
        handler: async ({ claim, finalize }) => {
          const { job } = await claim(async ({ job }) => ({ job }));

          return finalize(async ({ client, enqueueJob }) => {
            expectTypeOf<
              Parameters<typeof enqueueJob>[0]["queueName"]
            >().toEqualTypeOf<"linear_next">();

            return enqueueJob({
              client,
              queueName: "linear_next",
              input: { valueNext: job.input.value + 1 },
            });
          });
        },
      })
      .setupQueueHandler({
        name: "linear_next",
        handler: async ({ claim, finalize }) => {
          const { job } = await claim(async ({ job }) => ({ job }));

          return finalize(async ({ client, enqueueJob }) => {
            expectTypeOf<
              Parameters<typeof enqueueJob>[0]["queueName"]
            >().toEqualTypeOf<"linear_next_next">();

            return enqueueJob({
              client,
              queueName: "linear_next_next",
              input: { valueNextNext: job.input.valueNext + 1 },
            });
          });
        },
      })
      .setupQueueHandler({
        name: "linear_next_next",
        handler: async ({ claim, finalize }) => {
          const { job } = await claim(async ({ job }) => ({ job }));

          return finalize(async () => ({
            result: job.input.valueNextNext,
          }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "linear",
          input: { value: 1 },
        })
      );

      expectTypeOf<
        FinishedJobChain<typeof jobChain>["output"]
      >().toEqualTypeOf<{ result: number }>();

      const [finishedJobChain] = await waitForJobChainsFinished(queuert, [
        jobChain,
      ]);

      expect(finishedJobChain.output).toEqual({ result: 3 });
    });
  });

  test("handles branched chains", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
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
        handler: async ({ claim, finalize }) => {
          const { job } = await claim(async ({ job }) => ({ job }));

          return finalize(async ({ client, enqueueJob }) => {
            expectTypeOf<
              Parameters<typeof enqueueJob>[0]["queueName"]
            >().toEqualTypeOf<"branch1" | "branch2">();

            return enqueueJob({
              client,
              queueName: job.input.value % 2 === 0 ? "branch1" : "branch2",
              input: { valueBranched: job.input.value },
            });
          });
        },
      })
      .setupQueueHandler({
        name: "branch1",
        handler: async ({ claim, finalize }) => {
          const { job } = await claim(async ({ job }) => ({ job }));
          return finalize(async () => ({ result1: job.input.valueBranched }));
        },
      })
      .setupQueueHandler({
        name: "branch2",
        handler: async ({ claim, finalize }) => {
          const { job } = await claim(async ({ job }) => ({ job }));
          return finalize(async () => ({ result2: job.input.valueBranched }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const evenJobChain = await runInTransactionWithNotify(
        queuert,
        ({ client }) =>
          queuert.enqueueJobChain({
            client,
            chainName: "main",
            input: { value: 2 },
          })
      );
      const oddJobChain = await runInTransactionWithNotify(
        queuert,
        ({ client }) =>
          queuert.enqueueJobChain({
            client,
            chainName: "main",
            input: { value: 3 },
          })
      );

      expectTypeOf<
        FinishedJobChain<typeof evenJobChain>["output"]
      >().toEqualTypeOf<{ result1: number } | { result2: number }>();

      const [succeededJobEven, succeededJobOdd] =
        await waitForJobChainsFinished(queuert, [evenJobChain, oddJobChain]);

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
    waitForJobChainsFinished,
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
      handler: async ({ claim, finalize }) => {
        const { job } = await claim(async ({ job }) => ({ job }));

        return finalize(async ({ client, enqueueJob }) => {
          expectTypeOf<
            Parameters<typeof enqueueJob>[0]["queueName"]
          >().toEqualTypeOf<"loop">();

          return job.input.counter < 3
            ? enqueueJob({
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
        })
      );

      expectTypeOf<
        FinishedJobChain<typeof jobChain>["output"]
      >().toEqualTypeOf<{ done: true }>();

      const [succeededJobChain] = await waitForJobChainsFinished(queuert, [
        jobChain,
      ]);

      expect(succeededJobChain.output).toEqual({ done: true });
    });
  });

  test("handles go-to", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
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
        handler: async ({ claim, finalize }) => {
          const { job } = await claim(async ({ job }) => ({ job }));

          return finalize(async ({ client, enqueueJob }) => {
            expectTypeOf<
              Parameters<typeof enqueueJob>[0]["queueName"]
            >().toEqualTypeOf<"end">();

            return enqueueJob({
              client,
              queueName: "end",
              input: { result: job.input.value + 1 },
            });
          });
        },
      })
      .setupQueueHandler({
        name: "end",
        handler: async ({ claim, finalize }) => {
          const { job } = await claim(async ({ job }) => ({ job }));

          return finalize(async ({ client, enqueueJob }) => {
            expectTypeOf<
              Parameters<typeof enqueueJob>[0]["queueName"]
            >().toEqualTypeOf<"start">();

            if (job.input.result < 3) {
              return enqueueJob({
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
        })
      );

      expectTypeOf<
        FinishedJobChain<typeof jobChain>["output"]
      >().toEqualTypeOf<{ finalResult: number }>();

      const [succeededJobChain] = await waitForJobChainsFinished(queuert, [
        jobChain,
      ]);

      expect(succeededJobChain.output).toEqual({ finalResult: 3 });
    });
  });
});

describe("Dependency Chains", () => {
  test("handles long dependency chains", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        dependency: {
          input: { value: number };
          output: DefineQueueRef<"dependency"> | { done: true };
        };
        main: {
          input: { start: boolean };
          output: { finalResult: number };
        };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .setupQueueHandler({
        name: "dependency",
        handler: async ({ claim, finalize }) => {
          const { job } = await claim(async ({ job }) => ({ job }));

          return finalize(async ({ client, enqueueJob }) =>
            job.input.value < 1
              ? enqueueJob({
                  client,
                  queueName: "dependency",
                  input: { value: job.input.value + 1 },
                })
              : { done: true }
          );
        },
      })
      .setupQueueHandler({
        name: "main",
        enqueueDependencyJobChains: async ({ client }) => {
          return [
            await queuert.enqueueJobChain({
              client,
              chainName: "dependency",
              input: { value: 0 },
            }),
          ];
        },
        handler: async ({ claim, finalize }) => {
          const { dep, job } = await claim(
            async ({ job, dependencies: [dep] }) => {
              expectTypeOf<(typeof dep)["output"]>().toEqualTypeOf<{
                done: true;
              }>();

              return { dep, job };
            }
          );

          return finalize(async () => ({
            finalResult: (dep.output.done ? 1 : 0) + (job.input.start ? 1 : 0),
          }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "main",
          input: { start: true },
        })
      );

      const [succeededJobChain] = await waitForJobChainsFinished(queuert, [
        jobChain,
      ]);

      expect(succeededJobChain.output).toEqual({ finalResult: 2 });
    });
  });

  test("handles finalized dependency chains", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        dependency: {
          input: { value: number };
          output: { result: number };
        };
        main: {
          input: { dependencyJobId: string };
          output: { finalResult: number };
        };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .setupQueueHandler({
        name: "dependency",
        handler: async ({ claim, finalize }) => {
          const { job } = await claim(async ({ job }) => ({ job }));

          return finalize(async () => ({ result: job.input.value }));
        },
      })
      .setupQueueHandler({
        name: "main",
        enqueueDependencyJobChains: async ({ job, client }) => {
          const dependencyJob = await queuert.getJobChain({
            client,
            id: job.input.dependencyJobId,
            name: "dependency",
          });
          if (!dependencyJob) {
            throw new Error("Dependency job not found");
          }
          return [dependencyJob];
        },
        handler: async ({ claim, finalize }) => {
          const { dep } = await claim(async ({ dependencies: [dep] }) => ({
            dep,
          }));

          return finalize(async () => ({
            finalResult: dep.output.result,
          }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const dependencyJobChain = await runInTransactionWithNotify(
        queuert,
        ({ client }) =>
          queuert.enqueueJobChain({
            client,
            chainName: "dependency",
            input: { value: 1 },
          })
      );

      const [succeededDependencyJobChain] = await waitForJobChainsFinished(
        queuert,
        [dependencyJobChain]
      );

      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "main",
          input: { dependencyJobId: dependencyJobChain.id },
        })
      );

      const [succeededJobChain] = await waitForJobChainsFinished(queuert, [
        jobChain,
      ]);

      expect(succeededJobChain.output).toEqual({
        finalResult: succeededDependencyJobChain.output.result,
      });
    });
  });

  test("handles chains that are distributed across workers", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
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
      handler: async ({ claim, finalize }) => {
        const { job } = await claim(async ({ job }) => ({ job }));

        return finalize(async ({ enqueueJob, client }) =>
          enqueueJob({
            client,
            queueName: "finish",
            input: { valueNext: job.input.value + 1 },
          })
        );
      },
    });

    const worker2 = queuert.createWorker().setupQueueHandler({
      name: "finish",
      handler: async ({ claim, finalize }) => {
        const { job } = await claim(async ({ job }) => ({ job }));

        return finalize(async () => ({ result: job.input.valueNext + 1 }));
      },
    });

    await withWorkers(
      [await worker1.start(), await worker2.start()],
      async () => {
        const jobChain = await runInTransactionWithNotify(
          queuert,
          ({ client }) =>
            queuert.enqueueJobChain({
              client,
              chainName: "test",
              input: { value: 1 },
            })
        );

        const [finishedJobChain] = await waitForJobChainsFinished(queuert, [
          jobChain,
        ]);

        expect(finishedJobChain.output).toEqual({ result: 3 });
      }
    );
  });

  test("handles multiple dependency chains", async ({
    stateProvider,
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobChainsFinished,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateProvider,
      stateAdapter,
      notifyAdapter,
      log,
      queueDefinitions: defineUnionQueues<{
        dependency: {
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
        name: "dependency",
        handler: async ({ claim, finalize }) => {
          const { job } = await claim(async ({ job }) => ({ job }));
          return finalize(async () => ({ result: job.input.value }));
        },
      })
      .setupQueueHandler({
        name: "main",
        enqueueDependencyJobChains: async ({ client, job }) => {
          const dependencyChains = await Promise.all(
            Array.from({ length: job.input.count }, (_, i) =>
              queuert.enqueueJobChain({
                client,
                chainName: "dependency",
                input: { value: i + 1 },
              })
            )
          );
          return dependencyChains;
        },
        handler: async ({ claim, finalize }) => {
          const { dependencies } = await claim(async ({ dependencies }) => ({
            dependencies,
          }));
          const depResults = dependencies.map((dep) => dep.output.result);
          return finalize(async () => ({ finalResult: depResults }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.enqueueJobChain({
          client,
          chainName: "main",
          input: { count: 5 },
        })
      );

      const [succeededJobChain] = await waitForJobChainsFinished(queuert, [
        jobChain,
      ]);

      expect(succeededJobChain.output).toEqual({
        finalResult: Array.from({ length: 5 }, (_, i) => i + 1),
      });
    });
  });
});
