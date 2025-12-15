import { PoolClient } from "pg";
import { test as baseTest, describe, expectTypeOf, MockedFunction, vi } from "vitest";
import { extendWithDb, PgStateAdapter } from "./db.spec-helper.js";
import { sleep } from "./helpers/sleep.js";
import {
  CompletedJobSequence,
  createQueuert,
  DefineContinuationInput,
  DefineContinuationOutput,
  defineUnionJobTypes,
  JobSequence,
  LeaseConfig,
  Log,
  NotifyAdapter,
  Queuert,
  rescheduleJob,
} from "./index.js";
import { createInProcessNotifyAdapter } from "./notify-adapter/notify-adapter.in-process.js";
import { LeaseExpiredError } from "./queuert-helper.js";

const test = extendWithDb(baseTest, import.meta.url).extend<{
  notifyAdapter: NotifyAdapter;
  runInTransactionWithNotify: <T>(
    queuert: Queuert<PgStateAdapter, any>,
    cb: (context: { client: PoolClient }) => Promise<T>,
  ) => Promise<T>;
  withWorkers: <T>(workers: (() => Promise<void>)[], cb: () => Promise<T>) => Promise<T>;
  waitForJobSequencesCompleted: <TChains extends JobSequence<any, any, any>[]>(
    queuert: Queuert<PgStateAdapter, any>,
    chains: TChains,
  ) => Promise<{ [K in keyof TChains]: CompletedJobSequence<TChains[K]> }>;
  log: MockedFunction<Log>;
  expectLogs: (
    expected: {
      type: string;
      args?: [Record<string, unknown>] | [Record<string, unknown>, unknown];
    }[],
  ) => void;
}>({
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
  waitForJobSequencesCompleted: [
    async ({ stateProvider, expect }, use) => {
      await use((queuert, chains) =>
        vi.waitFor(
          async () => {
            const latestChains = await stateProvider.provideContext(({ client }) =>
              Promise.all(
                chains.map(async (chain) =>
                  queuert.getJobSequence({
                    client,
                    id: chain.id,
                    firstJobTypeName: chain.firstJobTypeName,
                  }),
                ),
              ),
            );

            if (latestChains.some((chain) => !chain)) {
              expect(latestChains).toBeDefined();
            }
            if (latestChains.some((chain) => chain!.status !== "completed")) {
              expect(latestChains.map((chain) => chain)).toEqual(
                latestChains.map(() => expect.objectContaining({ status: "completed" })),
              );
            }
            return latestChains as {
              [K in keyof typeof chains]: CompletedJobSequence<(typeof chains)[K]>;
            };
          },
          { timeout: 4000, interval: 10 },
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
          // console[level](`[${level}] ${message}`, ...args);
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
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expectLogs,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { test: boolean };
          output: { result: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ job, prepare }) => {
        expectTypeOf(job.id).toEqualTypeOf<string>();
        expectTypeOf(job.input).toEqualTypeOf<{ test: boolean }>();
        expect(job.id).toBeDefined();
        expect(job.sequenceId).toEqual(job.id);
        expect(job.originId).toBeNull();
        expect(job.rootId).toEqual(job.id);
        expect(job.input.test).toBeDefined();

        const [{ finalize }, result] = await prepare({ mode: "staged" }, ({ client }) => {
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

    const jobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
      queuert.startJobSequence({
        client,
        firstJobTypeName: "test",
        input: { test: true },
      }),
    );
    expectTypeOf<CompletedJobSequence<typeof jobSequence>["output"]>().toEqualTypeOf<{
      result: boolean;
    }>();

    await withWorkers([await worker.start({ workerId: "worker" })], async () => {
      const [succeededJobSequence] = await waitForJobSequencesCompleted(queuert, [jobSequence]);

      expect(succeededJobSequence.output).toEqual({ result: true });
    });

    const workerArgs = { workerId: "worker" };
    const jobSequenceArgs = {
      firstJobTypeName: "test",
      sequenceId: jobSequence.id,
      rootId: jobSequence.id,
      originId: null,
    };
    const jobArgs = {
      typeName: "test",
      id: jobSequence.id,
      rootId: jobSequence.id,
      originId: null,
      sequenceId: jobSequence.id,
    };
    expectLogs([
      { type: "job_sequence_created", args: [{ ...jobSequenceArgs, input: { test: true } }] },
      { type: "job_created", args: [{ ...jobArgs, input: { test: true } }] },
      { type: "worker_started", args: [{ ...workerArgs, jobTypeNames: ["test"] }] },
      {
        type: "job_acquired",
        args: [{ ...jobArgs, status: "created", attempt: 0, ...workerArgs }],
      },
      {
        type: "job_completed",
        args: [{ ...jobArgs, output: { result: true }, ...workerArgs }],
      },
      { type: "job_sequence_completed", args: [{ ...jobSequenceArgs, output: { result: true } }] },
      { type: "worker_stopping", args: [{ ...workerArgs }] },
      { type: "worker_stopped", args: [{ ...workerArgs }] },
    ]);
  });

  test("throws error when prepare, finalize, or continueWith called multiple times", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        "test-prepare": {
          input: null;
          output: null;
        };
        "test-finalize": {
          input: null;
          output: null;
        };
        "test-continueWith": {
          input: null;
          output: DefineContinuationOutput<"test-next">;
        };
        "test-next": {
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .implementJobType({
        name: "test-prepare",
        handler: async ({ prepare }) => {
          const [{ finalize }] = await prepare({ mode: "atomic" });
          await expect(prepare({ mode: "atomic" })).rejects.toThrow(
            "Prepare can only be called once",
          );
          return finalize(() => null);
        },
      })
      .implementJobType({
        name: "test-finalize",
        handler: async ({ prepare }) => {
          const [{ finalize }] = await prepare({ mode: "atomic" });
          const result = finalize(() => null);
          await expect(finalize(() => null)).rejects.toThrow("Finalize can only be called once");
          return result;
        },
      })
      .implementJobType({
        name: "test-continueWith",
        handler: async ({ prepare }) => {
          const [{ finalize }] = await prepare({ mode: "atomic" });
          return finalize(async ({ client, continueWith }) => {
            const continuation1 = await continueWith({
              client,
              typeName: "test-next",
              input: { value: 1 },
            });
            await expect(
              continueWith({
                client,
                typeName: "test-next",
                input: { value: 2 },
              }),
            ).rejects.toThrow("continueWith can only be called once");
            return continuation1;
          });
        },
      })
      .implementJobType({
        name: "test-next",
        handler: async ({ job, prepare }) => {
          const [{ finalize }] = await prepare({ mode: "atomic" });
          return finalize(() => ({ result: job.input.value }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const [prepareJobSequence, finalizeJobSequence, continueWithJobSequence] =
        await runInTransactionWithNotify(queuert, async ({ client }) => [
          await queuert.startJobSequence({
            client,
            firstJobTypeName: "test-prepare",
            input: null,
          }),
          await queuert.startJobSequence({
            client,
            firstJobTypeName: "test-finalize",
            input: null,
          }),
          await queuert.startJobSequence({
            client,
            firstJobTypeName: "test-continueWith",
            input: null,
          }),
        ]);

      await waitForJobSequencesCompleted(queuert, [
        prepareJobSequence,
        finalizeJobSequence,
        continueWithJobSequence,
      ]);
    });
  });

  test("allows to extend job lease after lease expiration if wasn't grabbed by another worker", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: null;
          output: null;
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ prepare }) => {
        const [{ finalize }] = await prepare({ mode: "staged" });

        await sleep(100);

        return finalize(() => null);
      },
    });

    await withWorkers(
      [await worker.start({ defaultLeaseConfig: { leaseMs: 1, renewIntervalMs: 100 } })],
      async () => {
        const jobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
          queuert.startJobSequence({
            client,
            firstJobTypeName: "test",
            input: null,
          }),
        );

        const [succeededJobSequence] = await waitForJobSequencesCompleted(queuert, [jobSequence]);

        expect(succeededJobSequence.output).toBeNull();
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
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const handler = vi.fn(async ({ prepare }) => {
      const [{ finalize }] = await prepare({ mode: "staged" });

      return finalize(() => ({ success: true }));
    });

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { test: boolean };
          output: { success: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      handler: handler,
    });

    await withWorkers([await worker.start(), await worker.start()], async () => {
      const job = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client: client,
          firstJobTypeName: "test",
          input: { test: true },
        }),
      );

      await waitForJobSequencesCompleted(queuert, [job]);

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  test("provides attempt information to job handler", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: null;
          output: null;
        };
      }>(),
    });

    const attempts: number[] = [];

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ job, prepare }) => {
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

        const [{ finalize }] = await prepare({ mode: "atomic" });

        return finalize(() => null);
      },
    });

    await withWorkers([await worker.start()], async () => {
      const job = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client: client,
          firstJobTypeName: "test",
          input: null,
        }),
      );

      await waitForJobSequencesCompleted(queuert, [job]);

      expect(attempts).toEqual([1, 2, 3]);
    });
  });

  test("uses exponential backoff for unexpected errors in all phases", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    type ErrorPhase = "prepare" | "process" | "finalize";

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { phase: ErrorPhase };
          output: null;
        };
      }>(),
    });

    const errors: { phase: ErrorPhase; error: string }[] = [];

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ job, prepare }) => {
        if (job.lastAttemptError) {
          errors.push({
            phase: job.input.phase,
            error: job.lastAttemptError,
          });
        }

        if (job.input.phase === "prepare" && job.attempt === 1) {
          throw new Error("Error in prepare");
        }

        const [{ finalize }] = await prepare({ mode: "staged" });

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
          defaultRetryConfig: {
            initialDelayMs: 10,
            multiplier: 2.0,
            maxDelayMs: 100,
          },
        }),
      ],
      async () => {
        const jobs = await Promise.all(
          (["prepare", "process", "finalize"] as ErrorPhase[]).map((phase) =>
            runInTransactionWithNotify(queuert, ({ client }) =>
              queuert.startJobSequence({
                client,
                firstJobTypeName: "test",
                input: { phase },
              }),
            ),
          ),
        );

        await waitForJobSequencesCompleted(queuert, jobs);

        expect(errors).toHaveLength(3);
        expect(errors.find((e) => e.phase === "prepare")?.error).toBe("Error: Error in prepare");
        expect(errors.find((e) => e.phase === "process")?.error).toBe("Error: Error in process");
        expect(errors.find((e) => e.phase === "finalize")?.error).toBe("Error: Error in finalize");
      },
    );
  });

  test("uses exponential backoff progression for repeated failures", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expectLogs,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: null;
          output: null;
        };
      }>(),
    });

    const errors: string[] = [];

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ job, prepare }) => {
        if (job.lastAttemptError) {
          errors.push(job.lastAttemptError);
        }

        if (job.attempt < 4) {
          throw new Error("Unexpected error");
        }

        const [{ finalize }] = await prepare({ mode: "atomic" });

        return finalize(() => null);
      },
    });

    await withWorkers(
      [
        await worker.start({
          defaultRetryConfig: {
            initialDelayMs: 10,
            multiplier: 2.0,
            maxDelayMs: 100,
          },
        }),
      ],
      async () => {
        const job = await runInTransactionWithNotify(queuert, ({ client }) =>
          queuert.startJobSequence({
            client,
            firstJobTypeName: "test",
            input: null,
          }),
        );

        await waitForJobSequencesCompleted(queuert, [job]);

        // Verify exponential backoff: 10ms, 20ms, 40ms
        expect(errors).toHaveLength(3);
        expect(errors[0]).toBe("Error: Unexpected error");
        expect(errors[1]).toBe("Error: Unexpected error");
        expect(errors[2]).toBe("Error: Unexpected error");
      },
    );

    expectLogs([
      { type: "worker_started" },
      { type: "job_sequence_created" },
      { type: "job_created" },
      { type: "job_acquired" },
      { type: "job_attempt_failed", args: [{ rescheduledAfterMs: 10 }, expect.anything()] },
      { type: "job_acquired" },
      { type: "job_attempt_failed", args: [{ rescheduledAfterMs: 20 }, expect.anything()] },
      { type: "job_acquired" },
      { type: "job_attempt_failed", args: [{ rescheduledAfterMs: 40 }, expect.anything()] },
      { type: "job_acquired" },
      { type: "job_completed" },
      { type: "job_sequence_completed" },
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);
  });

  test("handles rescheduled errors in all phases", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    type ErrorPhase = "prepare" | "process" | "finalize";

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { phase: ErrorPhase };
          output: null;
        };
      }>(),
    });

    const errors: { phase: ErrorPhase; error: string }[] = [];

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ job, prepare }) => {
        if (job.lastAttemptError) {
          errors.push({
            phase: job.input.phase,
            error: job.lastAttemptError,
          });
        }

        if (job.input.phase === "prepare" && job.attempt === 1) {
          throw rescheduleJob(1, "Rescheduled in prepare");
        }

        const [{ finalize }] = await prepare({ mode: "staged" });

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
        (["prepare", "process", "finalize"] as ErrorPhase[]).map((phase) =>
          runInTransactionWithNotify(queuert, ({ client }) =>
            queuert.startJobSequence({
              client,
              firstJobTypeName: "test",
              input: { phase },
            }),
          ),
        ),
      );

      await waitForJobSequencesCompleted(queuert, jobs);

      expect(errors).toHaveLength(3);
      expect(errors.find((e) => e.phase === "prepare")?.error).toBe("Rescheduled in prepare");
      expect(errors.find((e) => e.phase === "process")?.error).toBe("Rescheduled in process");
      expect(errors.find((e) => e.phase === "finalize")?.error).toBe("Rescheduled in finalize");
    });
  });
});

describe("Reaper", () => {
  test("reaps abandoned jobs on heartbeat", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
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

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ signal, prepare }) => {
        const [{ finalize }] = await prepare({ mode: "staged" });

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
      [
        await worker.start({ defaultLeaseConfig: leaseConfig }),
        await worker.start({ defaultLeaseConfig: leaseConfig }),
      ],
      async () => {
        const failJobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
          queuert.startJobSequence({
            client,
            firstJobTypeName: "test",
            input: null,
          }),
        );

        await startPromise;

        const successJobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
          queuert.startJobSequence({
            client,
            firstJobTypeName: "test",
            input: null,
          }),
        );

        const [succeededSuccessJobSequence, succeededFailJobSequence] =
          await waitForJobSequencesCompleted(queuert, [successJobSequence, failJobSequence]);

        expect(succeededSuccessJobSequence.output).toEqual(null);
        expect(succeededFailJobSequence.output).toEqual(null);

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
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
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

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ prepare }) => {
        const [{ finalize }] = await prepare({ mode: "staged" });

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
      [
        await worker.start({ defaultLeaseConfig: leaseConfig }),
        await worker.start({ defaultLeaseConfig: leaseConfig }),
      ],
      async () => {
        const failJobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
          queuert.startJobSequence({
            client,
            firstJobTypeName: "test",
            input: null,
          }),
        );

        await startPromise;

        const successJobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
          queuert.startJobSequence({
            client,
            firstJobTypeName: "test",
            input: null,
          }),
        );

        const [succeededSuccessJobSequence, succeededFailJobSequence] =
          await waitForJobSequencesCompleted(queuert, [successJobSequence, failJobSequence]);

        expect(succeededSuccessJobSequence.output).toEqual(null);
        expect(succeededFailJobSequence.output).toEqual(null);

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
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const processedJobs: number[] = [];

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { jobNumber: number };
          output: { success: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ job, prepare }) => {
        processedJobs.push(job.input.jobNumber);

        const [{ finalize }] = await prepare({ mode: "atomic" });

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
            queuert.startJobSequence({
              client: client,
              firstJobTypeName: "test",
              input: { jobNumber: i },
            }),
          ),
        );
      }

      await waitForJobSequencesCompleted(queuert, jobs);

      expect(processedJobs).toEqual([0, 1, 2, 3, 4]);
    });
  });

  test("processes jobs in order distributed across workers", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const processedJobs: number[] = [];

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { jobNumber: number };
          output: { success: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ job, prepare }) => {
        processedJobs.push(job.input.jobNumber);

        const [{ finalize }] = await prepare({ mode: "atomic" });

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
            queuert.startJobSequence({
              client: client,
              firstJobTypeName: "test",
              input: { jobNumber: i },
            }),
          ),
        );
      }

      await waitForJobSequencesCompleted(queuert, jobs);

      expect(processedJobs).toEqual([0, 1, 2, 3, 4]);
    });
  });
});

describe("Chains", () => {
  test("handles sequenced jobs", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expectLogs,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        linear: {
          input: { value: number };
          output: DefineContinuationOutput<"linear_next">;
        };
        linear_next: {
          input: DefineContinuationInput<{ valueNext: number }>;
          output: DefineContinuationOutput<"linear_next_next">;
        };
        linear_next_next: {
          input: DefineContinuationInput<{ valueNextNext: number }>;
          output: { result: number };
        };
      }>(),
    });

    let sequenceId: string;
    const originIds: string[] = [];

    const worker = queuert
      .createWorker()
      .implementJobType({
        name: "linear",
        handler: async ({ job, prepare }) => {
          expect(job.id).toEqual(sequenceId);
          expect(job.sequenceId).toEqual(sequenceId);
          expect(job.originId).toBeNull();
          expect(job.rootId).toEqual(sequenceId);
          originIds.push(job.id);

          const [{ finalize }] = await prepare({ mode: "atomic" });

          return finalize(({ client, continueWith }) => {
            expectTypeOf<
              Parameters<typeof continueWith>[0]["typeName"]
            >().toEqualTypeOf<"linear_next">();

            return continueWith({
              client,
              typeName: "linear_next",
              input: { valueNext: job.input.value + 1 },
            });
          });
        },
      })
      .implementJobType({
        name: "linear_next",
        handler: async ({ job, prepare }) => {
          expect(job.id).not.toEqual(sequenceId);
          expect(job.sequenceId).toEqual(sequenceId);
          expect(job.originId).toEqual(originIds[0]);
          expect(job.rootId).toEqual(sequenceId);
          originIds.push(job.id);

          const [{ finalize }] = await prepare({ mode: "atomic" });

          return finalize(({ client, continueWith }) => {
            expectTypeOf<
              Parameters<typeof continueWith>[0]["typeName"]
            >().toEqualTypeOf<"linear_next_next">();

            return continueWith({
              client,
              typeName: "linear_next_next",
              input: { valueNextNext: job.input.valueNext + 1 },
            });
          });
        },
      })
      .implementJobType({
        name: "linear_next_next",
        handler: async ({ job, prepare }) => {
          expect(job.id).not.toEqual(sequenceId);
          expect(job.sequenceId).toEqual(sequenceId);
          expect(job.originId).toEqual(originIds[1]);
          expect(job.rootId).toEqual(sequenceId);

          const [{ finalize }] = await prepare({ mode: "atomic" });

          return finalize(() => ({
            result: job.input.valueNextNext,
          }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const jobSequence = await runInTransactionWithNotify(queuert, async ({ client }) => {
        const jobSequence = await queuert.startJobSequence({
          client,
          firstJobTypeName: "linear",
          input: { value: 1 },
        });

        sequenceId = jobSequence.id;

        return jobSequence;
      });
      expectTypeOf<CompletedJobSequence<typeof jobSequence>["output"]>().toEqualTypeOf<{
        result: number;
      }>();
      expectTypeOf<
        Parameters<(typeof queuert)["startJobSequence"]>[0]["firstJobTypeName"]
      >().toEqualTypeOf<"linear">();
      expectTypeOf<
        Parameters<(typeof queuert)["getJobSequence"]>[0]["firstJobTypeName"]
      >().toEqualTypeOf<"linear">();

      const [finishedJobSequence] = await waitForJobSequencesCompleted(queuert, [jobSequence]);

      expect(finishedJobSequence.output).toEqual({ result: 3 });
    });

    expectLogs([
      { type: "worker_started" },
      { type: "job_sequence_created", args: [{ firstJobTypeName: "linear" }] },
      { type: "job_created", args: [{ typeName: "linear" }] },
      { type: "job_acquired", args: [{ typeName: "linear" }] },
      {
        type: "job_created",
        args: [
          {
            typeName: "linear_next",
            sequenceId: sequenceId!,
            rootId: sequenceId!,
            originId: originIds[0],
          },
        ],
      },
      { type: "job_completed", args: [{ typeName: "linear" }] },
      { type: "job_acquired", args: [{ typeName: "linear_next" }] },
      {
        type: "job_created",
        args: [
          {
            typeName: "linear_next_next",
            sequenceId: sequenceId!,
            rootId: sequenceId!,
            originId: originIds[1],
          },
        ],
      },
      { type: "job_completed", args: [{ typeName: "linear_next" }] },
      { type: "job_acquired", args: [{ typeName: "linear_next_next" }] },
      { type: "job_completed", args: [{ typeName: "linear_next_next" }] },
      { type: "job_sequence_completed", args: [{ firstJobTypeName: "linear" }] },
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);
  });

  test("handles branched sequences", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        main: {
          input: { value: number };
          output: DefineContinuationOutput<"branch1"> | DefineContinuationOutput<"branch2">;
        };
        branch1: {
          input: DefineContinuationInput<{ valueBranched: number }>;
          output: { result1: number };
        };
        branch2: {
          input: DefineContinuationInput<{ valueBranched: number }>;
          output: { result2: number };
        };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .implementJobType({
        name: "main",
        handler: async ({ job, prepare }) => {
          const [{ finalize }] = await prepare({ mode: "atomic" });
          return finalize(({ client, continueWith }) => {
            expectTypeOf<Parameters<typeof continueWith>[0]["typeName"]>().toEqualTypeOf<
              "branch1" | "branch2"
            >();

            return continueWith({
              client,
              typeName: job.input.value % 2 === 0 ? "branch1" : "branch2",
              input: { valueBranched: job.input.value },
            });
          });
        },
      })
      .implementJobType({
        name: "branch1",
        handler: async ({ job, prepare }) => {
          const [{ finalize }] = await prepare({ mode: "atomic" });
          return finalize(() => ({
            result1: job.input.valueBranched,
          }));
        },
      })
      .implementJobType({
        name: "branch2",
        handler: async ({ job, prepare }) => {
          const [{ finalize }] = await prepare({ mode: "atomic" });
          return finalize(() => ({
            result2: job.input.valueBranched,
          }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const evenJobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "main",
          input: { value: 2 },
        }),
      );
      const oddJobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "main",
          input: { value: 3 },
        }),
      );

      expectTypeOf<CompletedJobSequence<typeof evenJobSequence>["output"]>().toEqualTypeOf<
        { result1: number } | { result2: number }
      >();

      const [succeededJobEven, succeededJobOdd] = await waitForJobSequencesCompleted(queuert, [
        evenJobSequence,
        oddJobSequence,
      ]);

      expect(succeededJobEven.output).toEqual({ result1: 2 });
      expect(succeededJobOdd.output).toEqual({ result2: 3 });
    });
  });

  test("handles loops", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        loop: {
          input: { counter: number };
          output: DefineContinuationOutput<"loop"> | { done: true };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "loop",
      handler: async ({ job, prepare }) => {
        const [{ finalize }] = await prepare({ mode: "atomic" });
        return finalize(({ client, continueWith }) => {
          expectTypeOf<Parameters<typeof continueWith>[0]["typeName"]>().toEqualTypeOf<"loop">();

          return job.input.counter < 3
            ? continueWith({
                client,
                typeName: "loop",
                input: { counter: job.input.counter + 1 },
              })
            : { done: true };
        });
      },
    });

    await withWorkers([await worker.start()], async () => {
      const jobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "loop",
          input: { counter: 0 },
        }),
      );

      expectTypeOf<CompletedJobSequence<typeof jobSequence>["output"]>().toEqualTypeOf<{
        done: true;
      }>();

      const [succeededJobSequence] = await waitForJobSequencesCompleted(queuert, [jobSequence]);

      expect(succeededJobSequence.output).toEqual({ done: true });
    });
  });

  test("handles go-to", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        start: {
          input: { value: number };
          output: DefineContinuationOutput<"end">;
        };
        end: {
          input: DefineContinuationInput<{ result: number }>;
          output: DefineContinuationOutput<"start"> | { finalResult: number };
        };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .implementJobType({
        name: "start",
        handler: async ({ job, prepare }) => {
          const [{ finalize }] = await prepare({ mode: "atomic" });
          return finalize(({ client, continueWith }) => {
            expectTypeOf<Parameters<typeof continueWith>[0]["typeName"]>().toEqualTypeOf<"end">();

            return continueWith({
              client,
              typeName: "end",
              input: { result: job.input.value + 1 },
            });
          });
        },
      })
      .implementJobType({
        name: "end",
        handler: async ({ job, prepare }) => {
          const [{ finalize }] = await prepare({ mode: "atomic" });
          return finalize(({ client, continueWith }) => {
            expectTypeOf<Parameters<typeof continueWith>[0]["typeName"]>().toEqualTypeOf<"start">();

            if (job.input.result < 3) {
              return continueWith({
                client,
                typeName: "start",
                input: { value: job.input.result },
              });
            } else {
              return { finalResult: job.input.result };
            }
          });
        },
      });

    await withWorkers([await worker.start()], async () => {
      const jobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "start",
          input: { value: 0 },
        }),
      );

      expectTypeOf<CompletedJobSequence<typeof jobSequence>["output"]>().toEqualTypeOf<{
        finalResult: number;
      }>();

      const [succeededJobSequence] = await waitForJobSequencesCompleted(queuert, [jobSequence]);

      expect(succeededJobSequence.output).toEqual({ finalResult: 3 });
    });
  });
});

describe("Blocker Chains", () => {
  test("handles long blocker sequences", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
    expectLogs,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        blocker: {
          input: { value: number };
          output: DefineContinuationOutput<"blocker"> | { done: true };
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
      .implementJobType({
        name: "blocker",
        handler: async ({ job, prepare }) => {
          expect(job.sequenceId).toEqual(dependencyChainId);
          expect(job.rootId).toEqual(mainChainId);
          expect(job.originId).toEqual(originId);
          originId = job.id;

          const [{ finalize }] = await prepare({ mode: "atomic" });

          return finalize(({ client, continueWith }) =>
            job.input.value < 1
              ? continueWith({
                  client,
                  typeName: "blocker",
                  input: { value: job.input.value + 1 },
                })
              : { done: true },
          );
        },
      })
      .implementJobType({
        name: "main",
        enqueueBlockerJobSequences: async ({ job, client }) => {
          const dependencyJobSequence = await queuert.startJobSequence({
            client,
            firstJobTypeName: "blocker",
            input: { value: 0 },
          });

          originId = job.id;
          dependencyChainId = dependencyJobSequence.id;

          return [dependencyJobSequence];
        },
        handler: async ({ job, blockers: [blocker], prepare }) => {
          expectTypeOf<(typeof blocker)["output"]>().toEqualTypeOf<{
            done: true;
          }>();

          expectTypeOf<(typeof blocker)["originId"]>().toEqualTypeOf<string | null>();
          expect(blocker.originId).toEqual(job.id);

          const [{ finalize }] = await prepare({ mode: "atomic" });

          return finalize(() => ({
            finalResult: (blocker.output.done ? 1 : 0) + (job.input.start ? 1 : 0),
          }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const jobSequence = await runInTransactionWithNotify(queuert, async ({ client }) => {
        const jobSequence = await queuert.startJobSequence({
          client,
          firstJobTypeName: "main",
          input: { start: true },
        });

        mainChainId = jobSequence.id;

        return jobSequence;
      });

      const [succeededJobSequence] = await waitForJobSequencesCompleted(queuert, [jobSequence]);

      expect(succeededJobSequence.output).toEqual({ finalResult: 2 });
    });

    expectLogs([
      { type: "worker_started" },
      // main chain created
      { type: "job_sequence_created", args: [{ firstJobTypeName: "main" }] },
      { type: "job_created", args: [{ typeName: "main" }] },
      { type: "job_acquired", args: [{ typeName: "main" }] },
      // blocker chain created as dependency
      {
        type: "job_sequence_created",
        args: [{ firstJobTypeName: "blocker", rootId: mainChainId!, originId: mainChainId! }],
      },
      { type: "job_created", args: [{ typeName: "blocker" }] },
      { type: "job_blockers_added", args: [{ typeName: "main" }] },
      { type: "job_blocked", args: [{ typeName: "main" }] },
      // first blocker job processed
      { type: "job_acquired", args: [{ typeName: "blocker" }] },
      { type: "job_created", args: [{ typeName: "blocker" }] },
      { type: "job_completed", args: [{ typeName: "blocker" }] },
      // second blocker job processed, chain completes
      { type: "job_acquired", args: [{ typeName: "blocker" }] },
      { type: "job_completed", args: [{ typeName: "blocker" }] },
      { type: "job_sequence_completed", args: [{ firstJobTypeName: "blocker" }] },
      // main job unblocked and completed
      { type: "job_sequence_unblocked_jobs", args: [{ firstJobTypeName: "blocker" }] },
      { type: "job_acquired", args: [{ typeName: "main" }] },
      { type: "job_completed", args: [{ typeName: "main" }] },
      { type: "job_sequence_completed", args: [{ firstJobTypeName: "main" }] },
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);
  });

  test("handles finalized blocker sequences", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
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
      .implementJobType({
        name: "blocker",
        handler: async ({ job, prepare }) => {
          expect(job.originId).toBeNull();

          const [{ finalize }] = await prepare({ mode: "atomic" });

          return finalize(() => ({ result: job.input.value }));
        },
      })
      .implementJobType({
        name: "main",
        enqueueBlockerJobSequences: async ({ job, client }) => {
          const blockerJob = await queuert.getJobSequence({
            client,
            id: job.input.blockerJobId,
            firstJobTypeName: "blocker",
          });
          if (!blockerJob) {
            throw new Error("Blocker job not found");
          }
          return [blockerJob];
        },
        handler: async ({ blockers: [blocker], prepare }) => {
          expect(blocker.originId).toBeNull();

          const [{ finalize }] = await prepare({ mode: "atomic" });

          return finalize(() => ({
            finalResult: blocker.output.result,
          }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const blockerJobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "blocker",
          input: { value: 1 },
        }),
      );

      const [succeededBlockerJobSequence] = await waitForJobSequencesCompleted(queuert, [
        blockerJobSequence,
      ]);

      const jobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "main",
          input: { blockerJobId: blockerJobSequence.id },
        }),
      );

      const [succeededJobSequence] = await waitForJobSequencesCompleted(queuert, [jobSequence]);

      expect(succeededJobSequence.output).toEqual({
        finalResult: succeededBlockerJobSequence.output.result,
      });
    });
  });

  test("handles blocker sequences spawned during processing", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
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

    let childJobSequences: JobSequence<"inner", null, null>[] = [];
    let originId: string;

    const worker = queuert
      .createWorker()
      .implementJobType({
        name: "inner",
        handler: async ({ job, prepare }) => {
          const [{ finalize }] = await prepare({ mode: "atomic" });
          return finalize(() => {
            expect(job.originId).toEqual(originId);
            return null;
          });
        },
      })
      .implementJobType({
        name: "outer",
        handler: async ({ job, prepare }) => {
          expect(job.originId).toBeNull();
          originId = job.id;

          const [{ finalize }] = await prepare({ mode: "staged" }, async ({ client }) => {
            childJobSequences.push(
              await queuert.withNotify(() =>
                queuert.startJobSequence({
                  client,
                  firstJobTypeName: "inner",
                  input: null,
                }),
              ),
            );
          });

          childJobSequences.push(
            await runInTransactionWithNotify(queuert, ({ client }) =>
              queuert.startJobSequence({
                client,
                firstJobTypeName: "inner",
                input: null,
              }),
            ),
          );

          return finalize(async ({ client }) => {
            childJobSequences.push(
              await queuert.withNotify(() =>
                queuert.startJobSequence({
                  client,
                  firstJobTypeName: "inner",
                  input: null,
                }),
              ),
            );

            return null;
          });
        },
      });

    await withWorkers([await worker.start()], async () => {
      const jobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "outer",
          input: null,
        }),
      );

      await waitForJobSequencesCompleted(queuert, [jobSequence]);

      const succeededChildJobSequences = await waitForJobSequencesCompleted(
        queuert,
        childJobSequences,
      );

      expect(succeededChildJobSequences).toHaveLength(3);
    });
  });

  test("handles chains that are distributed across workers", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
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

    const worker1 = queuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ job, prepare }) => {
        const [{ finalize }] = await prepare({ mode: "atomic" });
        return finalize(({ continueWith, client }) =>
          continueWith({
            client,
            typeName: "finish",
            input: { valueNext: job.input.value + 1 },
          }),
        );
      },
    });

    const worker2 = queuert.createWorker().implementJobType({
      name: "finish",
      handler: async ({ job, prepare }) => {
        const [{ finalize }] = await prepare({ mode: "atomic" });
        return finalize(() => ({
          result: job.input.valueNext + 1,
        }));
      },
    });

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      const jobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "test",
          input: { value: 1 },
        }),
      );

      const [finishedJobSequence] = await waitForJobSequencesCompleted(queuert, [jobSequence]);

      expect(finishedJobSequence.output).toEqual({ result: 3 });
    });
  });

  test("handles multiple blocker sequences", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
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
      .implementJobType({
        name: "blocker",
        handler: async ({ job, prepare }) => {
          const [{ finalize }] = await prepare({ mode: "atomic" });
          return finalize(() => ({ result: job.input.value }));
        },
      })
      .implementJobType({
        name: "main",
        enqueueBlockerJobSequences: async ({ client, job }) => {
          const blockerSequences = await Promise.all(
            Array.from({ length: job.input.count }, (_, i) =>
              queuert.startJobSequence({
                client,
                firstJobTypeName: "blocker",
                input: { value: i + 1 },
              }),
            ),
          );
          return blockerSequences;
        },
        handler: async ({ blockers, prepare }) => {
          const [{ finalize }] = await prepare({ mode: "atomic" });
          return finalize(() => ({
            finalResult: blockers.map((blocker) => blocker.output.result),
          }));
        },
      });

    await withWorkers([await worker.start()], async () => {
      const jobSequence = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "main",
          input: { count: 5 },
        }),
      );

      const [succeededJobSequence] = await waitForJobSequencesCompleted(queuert, [jobSequence]);

      expect(succeededJobSequence.output).toEqual({
        finalResult: Array.from({ length: 5 }, (_, i) => i + 1),
      });
    });
  });
});

describe("Deduplication", () => {
  test("deduplicates job chains with same deduplication key", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ job, prepare }) => {
        const [{ finalize }] = await prepare({ mode: "atomic" });
        return finalize(() => ({ result: job.input.value }));
      },
    });

    await withWorkers([await worker.start()], async () => {
      const [chain1, chain2, chain3] = await runInTransactionWithNotify(
        queuert,
        async ({ client }) => [
          await queuert.startJobSequence({
            client,
            firstJobTypeName: "test",
            input: { value: 1 },
            deduplication: { key: "same-key" },
          }),
          await queuert.startJobSequence({
            client,
            firstJobTypeName: "test",
            input: { value: 2 },
            deduplication: { key: "same-key" },
          }),
          await queuert.startJobSequence({
            client,
            firstJobTypeName: "test",
            input: { value: 3 },
            deduplication: { key: "different-key" },
          }),
        ],
      );

      expect(chain1.deduplicated).toBe(false);
      expect(chain2.deduplicated).toBe(true);
      expect(chain2.id).toBe(chain1.id);
      expect(chain3.deduplicated).toBe(false);
      expect(chain3.id).not.toBe(chain1.id);

      const [completed1, completed2, completed3] = await waitForJobSequencesCompleted(queuert, [
        chain1,
        chain2,
        chain3,
      ]);

      expect(completed1.output).toEqual({ result: 1 });
      expect(completed2.output).toEqual({ result: 1 });
      expect(completed3.output).toEqual({ result: 3 });
    });
  });

  test("deduplication strategies: 'all' vs 'finalized'", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ job, prepare }) => {
        const [{ finalize }] = await prepare({ mode: "atomic" });
        return finalize(() => ({ result: job.input.value }));
      },
    });

    await withWorkers([await worker.start()], async () => {
      const allChain1 = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "test",
          input: { value: 1 },
          deduplication: { key: "all-key", strategy: "all" },
        }),
      );

      await waitForJobSequencesCompleted(queuert, [allChain1]);

      const allChain2 = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "test",
          input: { value: 2 },
          deduplication: { key: "all-key", strategy: "all" },
        }),
      );

      expect(allChain2.deduplicated).toBe(true);
      expect(allChain2.id).toBe(allChain1.id);

      const finalizedChain1 = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "test",
          input: { value: 3 },
          deduplication: { key: "finalized-key", strategy: "finalized" },
        }),
      );

      await waitForJobSequencesCompleted(queuert, [finalizedChain1]);

      const finalizedChain2 = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "test",
          input: { value: 4 },
          deduplication: { key: "finalized-key", strategy: "finalized" },
        }),
      );

      expect(finalizedChain2.deduplicated).toBe(false);
      expect(finalizedChain2.id).not.toBe(finalizedChain1.id);

      const [completed] = await waitForJobSequencesCompleted(queuert, [finalizedChain2]);
      expect(completed.output).toEqual({ result: 4 });
    });
  });

  test("deduplication with windowMs respects time window", async ({
    stateAdapter,
    notifyAdapter,
    runInTransactionWithNotify,
    withWorkers,
    waitForJobSequencesCompleted,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ job, prepare }) => {
        const [{ finalize }] = await prepare({ mode: "atomic" });
        return finalize(() => ({ result: job.input.value }));
      },
    });

    await withWorkers([await worker.start()], async () => {
      const allChain1 = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "test",
          input: { value: 1 },
          deduplication: { key: "all-key", strategy: "all", windowMs: 50 },
        }),
      );

      expect(allChain1.deduplicated).toBe(false);

      await sleep(100);

      const allChain2 = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "test",
          input: { value: 2 },
          deduplication: { key: "all-key", strategy: "all", windowMs: 50 },
        }),
      );

      expect(allChain2.deduplicated).toBe(false);
      expect(allChain2.id).not.toBe(allChain1.id);

      const finalizedChain1 = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "test",
          input: { value: 3 },
          deduplication: { key: "finalized-key", strategy: "finalized", windowMs: 50 },
        }),
      );

      await waitForJobSequencesCompleted(queuert, [finalizedChain1]);

      await sleep(100);

      const finalizedChain2 = await runInTransactionWithNotify(queuert, ({ client }) =>
        queuert.startJobSequence({
          client,
          firstJobTypeName: "test",
          input: { value: 4 },
          deduplication: { key: "finalized-key", strategy: "finalized", windowMs: 50 },
        }),
      );

      expect(finalizedChain2.deduplicated).toBe(false);
      expect(finalizedChain2.id).not.toBe(finalizedChain1.id);
    });
  });
});

describe("Resilience", () => {
  test("handles transient database errors gracefully", async ({
    flakyStateAdapter,
    stateAdapter,
    notifyAdapter,
    withWorkers,
    waitForJobSequencesCompleted,
    runInTransactionWithNotify,
    log,
  }) => {
    const jobTypeDefinitions = defineUnionJobTypes<{
      test: {
        input: { value: number; atomic: boolean };
        output: { result: number };
      };
    }>();

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions,
    });
    const flakyQueuert = await createQueuert({
      stateAdapter: flakyStateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions,
    });

    const flakyWorker = flakyQueuert.createWorker().implementJobType({
      name: "test",
      handler: async ({ job, prepare }) => {
        const [{ finalize }] = await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
        return finalize(() => ({ result: job.input.value * 2 }));
      },
    });

    await withWorkers(
      [
        await flakyWorker.start({
          pollIntervalMs: 100_000, // should be processed in a single loop invocations
          nextJobDelayMs: 0,
          defaultLeaseConfig: {
            leaseMs: 10,
            renewIntervalMs: 5,
          },
          defaultRetryConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
          workerLoopRetryConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
        }),
      ],
      async () => {
        const chains = await runInTransactionWithNotify(queuert, ({ client }) =>
          Promise.all(
            Array.from({ length: 20 }, async (_, i) =>
              queuert.startJobSequence({
                client,
                firstJobTypeName: "test",
                input: { value: i, atomic: i % 2 === 0 },
              }),
            ),
          ),
        );

        await waitForJobSequencesCompleted(queuert, chains);
      },
    );
  });
});
