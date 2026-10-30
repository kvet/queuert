import { sleep } from "@queuert/helpers";
import { type TestAPI, expect } from "vitest";

import { createClient } from "../client.js";
import { InvalidWorkerIdError, JobTakenByAnotherWorkerError } from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../job-type-processors/create-job-type-processors.js";
import { defineJobTypes } from "../job-types/define-job-types.js";
import { createNoopNotifyAdapter } from "../notify-adapter/notify-adapter.noop.js";
import { createSpyNotifyAdapter } from "../notify-adapter/notify-adapter.spy.spec-helper.js";
import { createSpyStateAdapter } from "../state-adapter/state-adapter.spy.spec-helper.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

const logEntries = (log: TestSuiteContext["log"]) => log.mock.calls.map(([entry]) => entry);

const startedWorkerIds = (log: TestSuiteContext["log"]): string[] =>
  logEntries(log).flatMap((entry) =>
    entry.type === "worker_started" ? [entry.data.workerId] : [],
  );

const workerEvents = (log: TestSuiteContext["log"]): string[] =>
  logEntries(log).flatMap((entry) =>
    entry.type === "worker_started" ||
    entry.type === "worker_lease_lost" ||
    entry.type === "worker_stopped"
      ? [`${entry.type}:${entry.data.workerId}`]
      : [],
  );

const reclaimedFrom = (log: TestSuiteContext["log"]) =>
  logEntries(log).flatMap((entry) =>
    entry.type === "job_attempt_reclaimed" ? [entry.data.reclaimedFrom] : [],
  );

const blockEventLoop = (ms: number): void => {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    Math.random();
  }
};

export const workerLivenessTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 50,
    timeoutMs: 5000,
  };
  const pollOptions = { interval: 20, timeout: 5000 };

  it("reclaims the jobs of a dead worker with a worker that does not process their type", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
      other: { entry: true; input: null; output: null };
    }>();
    const spyNotifyAdapter = createSpyNotifyAdapter(notifyAdapter ?? createNoopNotifyAdapter());
    const client = await createClient({
      stateAdapter,
      notifyAdapter: spyNotifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chains = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "other", input: null },
          { typeName: "other", input: null },
        ],
      }),
    );
    await stateAdapter.startWorker({
      workerId: "crashed",
      name: "crashed-worker",
      typeNames: [],
      concurrency: 1,
      leaseMs: 1,
    });
    await stateAdapter.startJobAttempts({ typeNames: ["other"], workerId: "crashed", limit: 1 });
    await stateAdapter.startJobAttempts({ typeNames: ["other"], workerId: "crashed", limit: 1 });
    spyNotifyAdapter.calls.length = 0;

    const worker = await createInProcessWorker({
      client,
      pollIntervalMs: 50,
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

    const jobIds = chains.map((chain) => chain.id);
    await withWorkers([await worker.start()], async () => {
      await expect
        .poll(
          async () => (await stateAdapter.getJobs({ jobIds })).map((job) => job?.status),
          pollOptions,
        )
        .toEqual(["pending", "pending"]);
    });

    const jobs = await stateAdapter.getJobs({ jobIds });
    for (const job of jobs) {
      expect(job).toMatchObject({ status: "pending", attempt: 1, attemptBy: null });
      expect(job?.lastAttemptAt).toBeInstanceOf(Date);
      expect(job?.lastAttemptError).toMatch(
        /^JobAttemptReclaimedError: Worker holding the attempt lost its lease/,
      );
      expect(job?.lastAttemptError).toContain('"reclaimedBy"');
    }
    expect(reclaimedFrom(log)).toEqual([
      { workerId: "crashed", workerName: "crashed-worker" },
      { workerId: "crashed", workerName: null },
    ]);
    expect(
      spyNotifyAdapter.calls
        .filter((call) => call.name === "notifyJobAttemptsLost")
        .flatMap((call) => call.args)
        .sort(),
    ).toEqual([...jobIds].sort());
    expect(spyNotifyAdapter.calls.filter((call) => call.name !== "notifyJobAttemptsLost")).toEqual(
      [],
    );
    expect(await stateAdapter.extendWorkerLease({ workerId: "crashed", leaseMs: 1000 })).toBe(
      undefined,
    );
  });

  it("reclaims as many jobs of a dead worker as it has idle slots in a single call", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);
    const spyNotifyAdapter = createSpyNotifyAdapter(notifyAdapter ?? createNoopNotifyAdapter());
    const client = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter: spyNotifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const deadCount = 3;
    const chains = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: Array.from({ length: deadCount }, () => ({
          typeName: "test" as const,
          input: null,
        })),
      }),
    );
    await stateAdapter.startWorker({
      workerId: "crashed",
      name: "crashed-worker",
      typeNames: [],
      concurrency: 1,
      leaseMs: 1,
    });
    await stateAdapter.startJobAttempts({
      typeNames: ["test"],
      workerId: "crashed",
      limit: deadCount,
    });
    await sleep(10);
    spyNotifyAdapter.calls.length = 0;

    const worker = await createInProcessWorker({
      client,
      concurrency: deadCount + 1,
      pollIntervalMs: 50,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              expect(job.attempt).toBe(2);
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    await withWorkers([await worker.start()], async () => {
      await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
    });

    const [firstReclaim] = spyStateAdapter.calls.filter(
      (call) => call.name === "reclaimExpiredJobAttempts",
    );
    expect(firstReclaim.result).toHaveLength(deadCount);
    expect(reclaimedFrom(log)).toEqual(
      Array.from({ length: deadCount }, () => ({
        workerId: "crashed",
        workerName: "crashed-worker",
      })),
    );

    expect(
      spyNotifyAdapter.calls
        .filter((call) => call.name === "notifyJobAttemptsLost")
        .map((call) => ({ name: call.name, args: [...call.args].sort() })),
    ).toEqual([{ name: "notifyJobAttemptsLost", args: chains.map((chain) => chain.id).sort() }]);
    expect(spyNotifyAdapter.calls.filter((call) => call.name === "notifyJobsScheduled")).toEqual(
      [],
    );
  });

  it("keeps an attempt that outlives the lease duration while the lease renews", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { aborted: boolean } };
    }>();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const lease = { durationMs: 200, heartbeatMs: 50 };
    const createWorker = async () =>
      createInProcessWorker({
        client,
        pollIntervalMs: 50,
        lease,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            test: {
              attemptHandler: async ({ signal, complete }) => {
                await sleep(lease.durationMs * 2);
                return withTransaction(async (txCtx, transactionHooks) =>
                  complete({ ...txCtx, transactionHooks, output: { aborted: signal.aborted } }),
                );
              },
            },
          },
        }),
      });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers(
      [await (await createWorker()).start(), await (await createWorker()).start()],
      async () => {
        expect((await client.awaitChain(chain, completionOptions)).output).toEqual({
          aborted: false,
        });
      },
    );

    expect((await stateAdapter.getJobs({ jobIds: [chain.id] }))[0]).toMatchObject({
      status: "completed",
      attempt: 1,
    });
  });

  it("stops a worker whose renewal finds the lease gone and starts the next one after every attempt ended", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: { slow: boolean }; output: null };
    }>();
    const workerIds: string[] = [];
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        startWorker: async (params) => {
          workerIds.push(params.workerId);
          return stateAdapter.startWorker(params);
        },
        extendWorkerLease: async (params) =>
          params.workerId === workerIds[0] ? undefined : stateAdapter.extendWorkerLease(params),
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const worker = await createInProcessWorker({
      client,
      concurrency: 2,
      pollIntervalMs: 50,
      lease: { durationMs: 1000, heartbeatMs: 100 },
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        processors: {
          test: {
            attemptHandler: async ({ job, signal, complete }) => {
              if (job.attempt === 1) {
                await sleep(5000, { signal });
                if (job.input.slow) await sleep(100);
                expect(workerIds).toHaveLength(1);
                throw new Error("attempt aborted");
              }
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chains = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "test", input: { slow: false } },
          { typeName: "test", input: { slow: true } },
        ],
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
    });

    expect(workerIds).toHaveLength(2);
    expect(startedWorkerIds(log)).toEqual(workerIds);
    expect(await stateAdapter.getJobs({ jobIds: chains.map((chain) => chain.id) })).toEqual([
      expect.objectContaining({ status: "completed", attempt: 2, completedBy: workerIds[1] }),
      expect.objectContaining({ status: "completed", attempt: 2, completedBy: workerIds[1] }),
    ]);
    expect(workerEvents(log)).toEqual([
      `worker_started:${workerIds[0]}`,
      `worker_lease_lost:${workerIds[0]}`,
      `worker_stopped:${workerIds[0]}`,
      `worker_started:${workerIds[1]}`,
      `worker_stopped:${workerIds[1]}`,
    ]);
  });

  for (const [description, failRenewal] of [
    [
      "throws",
      async () => {
        throw new Error("database unreachable");
      },
    ],
    ["hangs", async () => new Promise<undefined>(() => {})],
  ] as const) {
    it(`loses the lease at its local deadline while every renewal ${description}`, async ({
      stateAdapter,
      notifyAdapter,
      withWorkers,
      observabilityAdapter,
      log,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: null; output: null };
      }>();
      const workerIds: string[] = [];
      const client = await createClient({
        stateAdapter: {
          ...stateAdapter,
          startWorker: async (params) => {
            workerIds.push(params.workerId);
            return stateAdapter.startWorker(params);
          },
          extendWorkerLease: async (params) =>
            params.workerId === workerIds[0]
              ? failRenewal()
              : stateAdapter.extendWorkerLease(params),
        },
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const worker = await createInProcessWorker({
        client,
        pollIntervalMs: 50,
        lease: { durationMs: 200, heartbeatMs: 50 },
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

      const startedAt = performance.now();
      await withWorkers([await worker.start()], async () => {
        await expect.poll(() => startedWorkerIds(log), pollOptions).toHaveLength(2);
      });

      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(149);
      expect(workerEvents(log)).toEqual([
        `worker_started:${workerIds[0]}`,
        `worker_lease_lost:${workerIds[0]}`,
        `worker_stopped:${workerIds[0]}`,
        `worker_started:${workerIds[1]}`,
        `worker_stopped:${workerIds[1]}`,
      ]);
    });
  }

  it("keeps the lease through two failed renewals in a row", async ({
    stateAdapter,
    notifyAdapter,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const renewals: string[] = [];
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        extendWorkerLease: async (params) => {
          renewals.push(renewals.length < 2 ? "failed" : "renewed");
          if (renewals.length <= 2) throw new Error("database unreachable");
          return stateAdapter.extendWorkerLease(params);
        },
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const worker = await createInProcessWorker({
      client,
      pollIntervalMs: 50,
      lease: { durationMs: 300, heartbeatMs: 50 },
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

    await withWorkers([await worker.start()], async () => {
      await expect.poll(() => renewals.length, pollOptions).toBeGreaterThanOrEqual(4);
    });

    expect(renewals.slice(0, 4)).toEqual(["failed", "failed", "renewed", "renewed"]);
    expect(startedWorkerIds(log)).toHaveLength(1);
    expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ type: "worker_lease_lost" }));
  });

  it("commits a `complete` in the margin after the lease was lost", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { aborted: boolean } };
    }>();
    const workerIds: string[] = [];
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        startWorker: async (params) => {
          workerIds.push(params.workerId);
          return stateAdapter.startWorker(params);
        },
        extendWorkerLease: async (params) =>
          params.workerId === workerIds[0] ? undefined : stateAdapter.extendWorkerLease(params),
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const worker = await createInProcessWorker({
      client,
      pollIntervalMs: 50,
      lease: { durationMs: 1000, heartbeatMs: 50 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ signal, complete }) => {
              await sleep(5000, { signal });
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { aborted: signal.aborted } }),
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
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ aborted: true });
    });

    const [job] = await stateAdapter.getJobs({ jobIds: [chain.id] });
    expect(job).toMatchObject({ status: "completed", attempt: 1, completedBy: workerIds[0] });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worker_lease_lost",
        data: { workerId: workerIds[0], workerName: null },
      }),
    );
  });

  it("rejects a late `complete` of an attempt whose job was reclaimed", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        startWorker: async (params) => stateAdapter.startWorker({ ...params, leaseMs: 1 }),
        extendWorkerLease: async ({ workerId }) => ({
          id: workerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          startedAt: new Date(),
          leaseUntil: new Date(),
        }),
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const started = Promise.withResolvers<void>();
    const reclaimed = Promise.withResolvers<void>();
    const completeRejected = Promise.withResolvers<unknown>();
    const worker = await createInProcessWorker({
      client,
      pollIntervalMs: 50,
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt === 1) {
                started.resolve();
                await reclaimed.promise;
                const error = await withTransaction(async (txCtx, transactionHooks) =>
                  complete({ ...txCtx, transactionHooks, output: null }),
                ).catch((error: unknown) => error);
                completeRejected.resolve(error);
                throw error;
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
      await started.promise;
      await sleep(10);
      const [reclaimedJob] = await stateAdapter.reclaimExpiredJobAttempts({
        lastAttemptError: "reclaimed by the test",
        limit: 1,
      });
      expect(reclaimedJob?.id).toBe(chain.id);
      reclaimed.resolve();

      expect(await completeRejected.promise).toBeInstanceOf(JobTakenByAnotherWorkerError);
      await client.awaitChain(chain, completionOptions);
    });

    expect(log).toHaveBeenCalledWith(expect.objectContaining({ type: "job_attempt_lost" }));
  });

  it("aborts the attempt of a deleted job through the lease loop without a notify adapter", async ({
    stateAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const client = await createClient({ stateAdapter, observabilityAdapter, log, jobTypes });

    const started = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<boolean>();
    const worker = await createInProcessWorker({
      client,
      pollIntervalMs: 50,
      lease: { durationMs: 1000, heartbeatMs: 20 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ signal }) => {
              started.resolve();
              await sleep(5000, { signal });
              aborted.resolve(signal.aborted);
              throw new Error("attempt aborted");
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await started.promise;
      await withTransaction(async (txCtx, transactionHooks) =>
        client.deleteChains({ ...txCtx, transactionHooks, ids: [chain.id] }),
      );
      expect(await aborted.promise).toBe(true);
    });
  });

  it("does not abort an attempt whose own `complete` committed on later lease ticks", async ({
    stateAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const client = await createClient({ stateAdapter, observabilityAdapter, log, jobTypes });

    const aborted = Promise.withResolvers<boolean>();
    const worker = await createInProcessWorker({
      client,
      pollIntervalMs: 50,
      lease: { durationMs: 1000, heartbeatMs: 20 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ signal, complete }) => {
              const completed = await withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
              await sleep(100);
              aborted.resolve(signal.aborted);
              return completed;
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
      expect(await aborted.promise).toBe(false);
    });
  });

  for (const [description, failingMethod] of [
    ["a claim", "startJobAttempts"],
    ["a fallback reschedule", "rescheduleJobs"],
  ] as const) {
    it(`stops the worker gracefully when ${description} throws, reclaims the job it leaked and starts the next worker after the recovery backoff`, async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      withWorkers,
      observabilityAdapter,
      log,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: null; output: null };
      }>();
      const recoveryBackoffMs = 300;
      const workerStarts: { workerId: string; at: number }[] = [];
      const workerStops: { workerId: string; at: number }[] = [];
      const claimedJobIds: string[] = [];
      const failures: string[] = [];
      const client = await createClient({
        stateAdapter: {
          ...stateAdapter,
          startWorker: async (params) => {
            workerStarts.push({ workerId: params.workerId, at: performance.now() });
            return stateAdapter.startWorker(params);
          },
          stopWorker: async (params) => {
            const reclaimedJobs = await stateAdapter.stopWorker(params);
            workerStops.push({ workerId: params.workerId, at: performance.now() });
            return reclaimedJobs;
          },
          startJobAttempts: async (params) => {
            const jobs = await stateAdapter.startJobAttempts({ ...params, limit: 1 });
            claimedJobIds.push(...jobs.map((job) => job.id));
            if (
              jobs.length > 0 &&
              failingMethod === "startJobAttempts" &&
              claimedJobIds.length === 2
            ) {
              failures.push(failingMethod);
              throw new Error("connection lost after commit");
            }
            return jobs;
          },
          rescheduleJobs: async (params) => {
            if (failingMethod === "rescheduleJobs" && failures.length === 0) {
              failures.push(failingMethod);
              throw new Error("connection lost");
            }
            return stateAdapter.rescheduleJobs(params);
          },
        },
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const attempts: {
        jobId: string;
        attempt: number;
        attemptBy: string | null;
        aborted: boolean;
        lastAttemptError: string | null;
      }[] = [];
      const worker = await createInProcessWorker({
        client,
        workerName: "liveness",
        concurrency: 2,
        pollIntervalMs: 50,
        recoveryBackoffConfig: {
          initialDelayMs: recoveryBackoffMs,
          multiplier: 1,
          maxDelayMs: recoveryBackoffMs,
        },
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            test: {
              attemptHandler: async ({ job, signal, complete }) => {
                if (job.id === claimedJobIds[0]) await sleep(200);
                attempts.push({
                  jobId: job.id,
                  attempt: job.attempt,
                  attemptBy: job.attemptBy,
                  aborted: signal.aborted,
                  lastAttemptError: job.lastAttemptError,
                });
                if (job.id === claimedJobIds[1] && job.attempt === 1) {
                  throw new Error("attempt failed");
                }
                return withTransaction(async (txCtx, transactionHooks) =>
                  complete({ ...txCtx, transactionHooks, output: null }),
                );
              },
            },
          },
        }),
      });

      const chains = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "test", input: null },
            { typeName: "test", input: null },
          ],
        }),
      );

      await withWorkers([await worker.start()], async () => {
        await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
      });

      const workerIds = workerStarts.map(({ workerId }) => workerId);
      const [inFlightJobId, leakedJobId] = claimedJobIds;
      expect(failures).toEqual([failingMethod]);
      expect(workerIds).toHaveLength(2);
      expect(attempts).toEqual([
        ...(failingMethod === "rescheduleJobs"
          ? [
              {
                jobId: leakedJobId,
                attempt: 1,
                attemptBy: workerIds[0],
                aborted: false,
                lastAttemptError: null,
              },
            ]
          : []),
        {
          jobId: inFlightJobId,
          attempt: 1,
          attemptBy: workerIds[0],
          aborted: false,
          lastAttemptError: null,
        },
        {
          jobId: leakedJobId,
          attempt: 2,
          attemptBy: workerIds[1],
          aborted: false,
          lastAttemptError: expect.stringMatching(
            /^JobAttemptReclaimedError: Worker holding the attempt stopped/,
          ),
        },
      ]);
      expect((await stateAdapter.getJobs({ jobIds: [inFlightJobId] }))[0]?.completedBy).toBe(
        workerIds[0],
      );
      expect(reclaimedFrom(log)).toEqual([{ workerId: workerIds[0], workerName: "liveness" }]);
      expect(
        logEntries(log).filter(
          (entry) => entry.type === "worker_error" && entry.data.workerId === workerIds[0],
        ),
      ).toHaveLength(1);
      expect(workerEvents(log)).toEqual([
        `worker_started:${workerIds[0]}`,
        `worker_stopped:${workerIds[0]}`,
        `worker_started:${workerIds[1]}`,
        `worker_stopped:${workerIds[1]}`,
      ]);
      expect(workerStops[0]?.workerId).toBe(workerIds[0]);
      expect(workerStarts[1].at - workerStops[0].at).toBeGreaterThanOrEqual(recoveryBackoffMs - 20);
    });
  }

  it("does not run a job whose claim resolves past the local deadline", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const workerIds: string[] = [];
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        startWorker: async (params) => {
          workerIds.push(params.workerId);
          return stateAdapter.startWorker(params);
        },
        startJobAttempts: async (params) => {
          const jobs = await stateAdapter.startJobAttempts(params);
          if (jobs.length > 0 && params.workerId === workerIds[0]) blockEventLoop(250);
          return jobs;
        },
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const attempts: { attempt: number; lastAttemptError: string | null }[] = [];
    const worker = await createInProcessWorker({
      client,
      pollIntervalMs: 50,
      lease: { durationMs: 200, heartbeatMs: 50 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              attempts.push({ attempt: job.attempt, lastAttemptError: job.lastAttemptError });
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

    expect(attempts).toEqual([
      {
        attempt: 2,
        lastAttemptError: expect.stringMatching(
          /^JobAttemptReclaimedError: Worker holding the attempt lost its lease/,
        ),
      },
    ]);
    expect(reclaimedFrom(log)).toEqual([{ workerId: workerIds[0], workerName: null }]);
    expect(workerEvents(log).slice(0, 3)).toEqual([
      `worker_started:${workerIds[0]}`,
      `worker_lease_lost:${workerIds[0]}`,
      `worker_stopped:${workerIds[0]}`,
    ]);
  });

  it("resolves stop() promptly while waiting to retry a failed worker start", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        startWorker: async () => {
          throw new Error("database unreachable");
        },
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const worker = await createInProcessWorker({
      client,
      recoveryBackoffConfig: { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 },
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

    const stop = await worker.start();
    await expect
      .poll(() => logEntries(log).filter((entry) => entry.type === "worker_error"), pollOptions)
      .toHaveLength(1);

    const stoppingAt = performance.now();
    await stop();

    expect(performance.now() - stoppingAt).toBeLessThan(1000);
    expect(startedWorkerIds(log)).toEqual([]);
    expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ type: "worker_stopped" }));
  });

  it("reclaims a job claimed while stopping and deletes the worker row", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const workerIds: string[] = [];
    const claimEntered = Promise.withResolvers<void>();
    const releaseClaim = Promise.withResolvers<void>();
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        startWorker: async (params) => {
          workerIds.push(params.workerId);
          return stateAdapter.startWorker(params);
        },
        startJobAttempts: async (params) => {
          claimEntered.resolve();
          await releaseClaim.promise;
          return stateAdapter.startJobAttempts(params);
        },
      },
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
            attemptHandler: async () => {
              throw new Error("not expected to run");
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    const stop = await worker.start();
    await claimEntered.promise;
    const stopped = stop();
    releaseClaim.resolve();
    await stopped;

    const [job] = await stateAdapter.getJobs({ jobIds: [chain.id] });
    expect(job).toMatchObject({ status: "pending", attempt: 1, attemptBy: null });
    expect(job?.lastAttemptError).toMatch(
      /^JobAttemptReclaimedError: Worker holding the attempt stopped/,
    );
    expect(reclaimedFrom(log)).toEqual([{ workerId: workerIds[0], workerName: null }]);
    expect(await stateAdapter.extendWorkerLease({ workerId: workerIds[0], leaseMs: 1000 })).toBe(
      undefined,
    );
    expect(workerEvents(log)).toEqual([
      `worker_started:${workerIds[0]}`,
      `worker_stopped:${workerIds[0]}`,
    ]);
  });

  it("starts every worker under a fresh id from generateWorkerId", async ({
    stateAdapter,
    notifyAdapter,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const generatedIds = ["invalid", "worker-1", "worker-2"];
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        config: {
          ...stateAdapter.config,
          generateWorkerId: () => generatedIds.shift() ?? "exhausted",
          validateWorkerId: (id) => id !== "invalid",
        },
        extendWorkerLease: async (params) =>
          params.workerId === "worker-1" ? undefined : stateAdapter.extendWorkerLease(params),
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const worker = await createInProcessWorker({
      client,
      pollIntervalMs: 50,
      recoveryBackoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
      lease: { durationMs: 1000, heartbeatMs: 50 },
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

    await withWorkers([await worker.start()], async () => {
      await expect.poll(() => startedWorkerIds(log), pollOptions).toHaveLength(2);
    });

    expect(generatedIds).toEqual([]);
    expect(startedWorkerIds(log)).toEqual(["worker-1", "worker-2"]);
    const workerErrors = logEntries(log).filter((entry) => entry.type === "worker_error");
    expect(workerErrors).toHaveLength(1);
    expect(workerErrors[0]).toMatchObject({
      data: { workerId: "invalid", workerName: null },
      error: expect.any(InvalidWorkerIdError),
    });
    expect(workerErrors[0]).toMatchObject({ error: { id: "invalid" } });
  });

  it("reports a throwing generateWorkerId as a worker error and starts the next worker", async ({
    stateAdapter,
    notifyAdapter,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const generatorError = new Error("entropy unavailable");
    const generatorErrors = [generatorError];
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        config: {
          ...stateAdapter.config,
          generateWorkerId: () => {
            const error = generatorErrors.shift();
            if (error) throw error;
            return "worker-1";
          },
        },
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const worker = await createInProcessWorker({
      client,
      pollIntervalMs: 50,
      recoveryBackoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
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

    await withWorkers([await worker.start()], async () => {
      await expect.poll(() => startedWorkerIds(log), pollOptions).toEqual(["worker-1"]);
    });

    expect(logEntries(log).filter((entry) => entry.type === "worker_error")).toEqual([
      expect.objectContaining({
        data: { workerId: "", workerName: null },
        error: generatorError,
      }),
    ]);
  });

  it("reports an unexpected error that ends the worker loop as a worker error", async ({
    stateAdapter,
    notifyAdapter,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const logError = new Error("log sink unavailable");
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log: (entry) => {
        log(entry);
        if (entry.type === "worker_started") throw logError;
      },
      jobTypes,
    });

    const worker = await createInProcessWorker({
      client,
      pollIntervalMs: 50,
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

    await withWorkers([await worker.start()], async () => {
      await expect
        .poll(() => logEntries(log).filter((entry) => entry.type === "worker_error"), pollOptions)
        .toEqual([
          expect.objectContaining({
            data: { workerId: "", workerName: null },
            error: logError,
          }),
        ]);
    });

    expect(startedWorkerIds(log)).toHaveLength(1);
  });

  it("backs off from the initial delay after an uncertain write of a worker that renewed its lease", async ({
    stateAdapter,
    notifyAdapter,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const recoveryBackoffMs = 200;
    const workerStartedAt: { workerId: string; at: number }[] = [];
    const renewedWorkerIds = new Set<string>();
    const claimFailedAt: number[] = [];
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        startWorker: async (params) => {
          workerStartedAt.push({ workerId: params.workerId, at: performance.now() });
          return stateAdapter.startWorker(params);
        },
        extendWorkerLease: async (params) => {
          const extended = await stateAdapter.extendWorkerLease(params);
          if (extended) renewedWorkerIds.add(params.workerId);
          return extended;
        },
        startJobAttempts: async (params) => {
          const workerIndex = workerStartedAt.findIndex(
            ({ workerId }) => workerId === params.workerId,
          );
          if (
            claimFailedAt.length === workerIndex &&
            (workerIndex === 0 || (workerIndex === 1 && renewedWorkerIds.has(params.workerId)))
          ) {
            claimFailedAt.push(performance.now());
            throw new Error("connection lost");
          }
          return stateAdapter.startJobAttempts(params);
        },
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const worker = await createInProcessWorker({
      client,
      pollIntervalMs: 50,
      recoveryBackoffConfig: {
        initialDelayMs: recoveryBackoffMs,
        multiplier: 5,
        maxDelayMs: recoveryBackoffMs * 5,
      },
      lease: { durationMs: 300, heartbeatMs: 50 },
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

    await withWorkers([await worker.start()], async () => {
      await expect.poll(() => workerStartedAt.length, pollOptions).toBe(3);
    });

    expect(renewedWorkerIds.has(workerStartedAt[1].workerId)).toBe(true);
    expect(claimFailedAt).toHaveLength(2);
    expect(workerStartedAt[1].at - claimFailedAt[0]).toBeGreaterThanOrEqual(recoveryBackoffMs - 20);
    expect(workerStartedAt[1].at - claimFailedAt[0]).toBeLessThan(recoveryBackoffMs * 3);
    expect(workerStartedAt[2].at - claimFailedAt[1]).toBeGreaterThanOrEqual(recoveryBackoffMs - 20);
    expect(workerStartedAt[2].at - claimFailedAt[1]).toBeLessThan(recoveryBackoffMs * 3);
  });

  it("escalates the backoff after an uncertain write of a worker that renewed its lease only while draining", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const recoveryBackoffMs = 200;
    const workerStartedAt: { workerId: string; at: number }[] = [];
    const renewedWorkerIds = new Set<string>();
    const claimCalls: string[] = [];
    const claimFailures: { at: number; renewed: boolean }[] = [];
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        startWorker: async (params) => {
          workerStartedAt.push({ workerId: params.workerId, at: performance.now() });
          return stateAdapter.startWorker(params);
        },
        extendWorkerLease: async (params) => {
          const extended = await stateAdapter.extendWorkerLease(params);
          if (extended) renewedWorkerIds.add(params.workerId);
          return extended;
        },
        startJobAttempts: async (params) => {
          const workerIndex = workerStartedAt.findIndex(
            ({ workerId }) => workerId === params.workerId,
          );
          const callIndex = claimCalls.filter((workerId) => workerId === params.workerId).length;
          claimCalls.push(params.workerId);
          if ((workerIndex === 0 && callIndex === 0) || (workerIndex === 1 && callIndex === 1)) {
            claimFailures.push({
              at: performance.now(),
              renewed: renewedWorkerIds.has(params.workerId),
            });
            throw new Error("connection lost");
          }
          return stateAdapter.startJobAttempts(params);
        },
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const worker = await createInProcessWorker({
      client,
      concurrency: 2,
      pollIntervalMs: 50,
      recoveryBackoffConfig: {
        initialDelayMs: recoveryBackoffMs,
        multiplier: 5,
        maxDelayMs: recoveryBackoffMs * 5,
      },
      lease: { durationMs: 600, heartbeatMs: 150 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              await sleep(250);
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const [chain] = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [{ typeName: "test", input: null }],
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
      await expect.poll(() => workerStartedAt.length, pollOptions).toBe(3);
    });

    expect(claimFailures).toEqual([
      { at: expect.any(Number), renewed: false },
      { at: expect.any(Number), renewed: false },
    ]);
    expect(renewedWorkerIds.has(workerStartedAt[1].workerId)).toBe(true);
    expect(workerStartedAt[1].at - claimFailures[0].at).toBeGreaterThanOrEqual(
      recoveryBackoffMs - 20,
    );
    expect(workerStartedAt[1].at - claimFailures[0].at).toBeLessThan(recoveryBackoffMs * 3);
    expect(workerStartedAt[2].at - claimFailures[1].at).toBeGreaterThanOrEqual(
      recoveryBackoffMs * 5,
    );
  });

  it("resolves stop() while a read of the attempts' jobs hangs", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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
    const readEntered = Promise.withResolvers<void>();
    const workerClient = await createClient({
      stateAdapter: {
        ...stateAdapter,
        getJobs: async () => {
          readEntered.resolve();
          return new Promise(() => {});
        },
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const started = Promise.withResolvers<void>();
    const worker = await createInProcessWorker({
      client: workerClient,
      pollIntervalMs: 50,
      lease: { durationMs: 1000, heartbeatMs: 20 },
      processors: createProcessors({
        client: workerClient,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ signal, complete }) => {
              started.resolve();
              await sleep(5000, { signal });
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

    const stop = await worker.start();
    await started.promise;
    await readEntered.promise;

    const stoppingAt = performance.now();
    await stop();

    expect(performance.now() - stoppingAt).toBeLessThan(1000);
    expect((await stateAdapter.getJobs({ jobIds: [chain.id] }))[0]).toMatchObject({
      status: "completed",
      attempt: 1,
    });
  });
};
