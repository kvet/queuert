import { type TestAPI } from "vitest";
import { JobAlreadyCompletedError, JobTakenByAnotherWorkerError } from "../errors.js";
import { sleep } from "../helpers/sleep.js";
import {
  type LeaseConfig,
  createQueuertClient,
  createQueuertInProcessWorker,
  defineJobTypes,
} from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const reaperTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("reaps abandoned jobs on lease renewal", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: null;
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });

    let failed = false;
    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();
    const leaseConfig = { leaseMs: 10, renewIntervalMs: 100 } satisfies LeaseConfig;

    const worker1 = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      workerId: "w1",
      concurrency: { maxSlots: 1 },
      jobTypeProcessing: {
        defaultLeaseConfig: leaseConfig,
        pollIntervalMs: leaseConfig.leaseMs,
      },
      jobTypeProcessors: {
        test: {
          process: async ({ signal, complete }) => {
            if (!failed) {
              failed = true;

              jobStarted.resolve();
              try {
                await sleep(leaseConfig.renewIntervalMs * 2, { signal });
              } finally {
                expect(signal.aborted).toBe(true);
                expect(signal.reason).toBeOneOf(["already_completed", "taken_by_another_worker"]);
                jobCompleted.resolve();
              }
            }

            return complete(async () => null);
          },
        },
      },
    });

    const worker2 = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      workerId: "w2",
      concurrency: { maxSlots: 1 },
      jobTypeProcessing: {
        defaultLeaseConfig: leaseConfig,
        pollIntervalMs: leaseConfig.leaseMs,
      },
      jobTypeProcessors: {
        test: {
          process: async ({ signal, complete }) => {
            if (!failed) {
              failed = true;

              jobStarted.resolve();
              try {
                await sleep(leaseConfig.renewIntervalMs * 2, { signal });
              } finally {
                expect(signal.aborted).toBe(true);
                expect(signal.reason).toBeOneOf(["already_completed", "taken_by_another_worker"]);
                jobCompleted.resolve();
              }
            }

            return complete(async () => null);
          },
        },
      },
    });

    const failJobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      await jobStarted.promise;
      await sleep(10);

      const successJobChain = await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.startJobChain({
            ...txContext,
            typeName: "test",
            input: null,
          }),
        ),
      );

      await Promise.all([
        client.waitForJobChainCompletion(successJobChain, completionOptions),
        client.waitForJobChainCompletion(failJobChain, completionOptions),
      ]);

      await jobCompleted.promise;
    });

    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worker_error",
      }),
    );
  });

  it("reaps abandoned jobs on complete", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: null;
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });

    let failed = false;
    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();
    const leaseConfig = { leaseMs: 10, renewIntervalMs: 100 } satisfies LeaseConfig;

    const worker1 = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      workerId: "w1",
      concurrency: { maxSlots: 1 },
      jobTypeProcessing: {
        defaultLeaseConfig: leaseConfig,
        pollIntervalMs: leaseConfig.leaseMs,
      },
      jobTypeProcessors: {
        test: {
          process: async ({ prepare, complete }) => {
            await prepare({ mode: "staged" });

            if (!failed) {
              failed = true;

              jobStarted.resolve();
              await sleep(leaseConfig.renewIntervalMs * 2);
              await expect(async () => complete(async () => null)).rejects.toSatisfy(
                (error) =>
                  error instanceof
                  (notifyAdapter ? JobTakenByAnotherWorkerError : JobAlreadyCompletedError),
              );
              jobCompleted.resolve();
            }
            await sleep(10);

            return complete(async () => null);
          },
        },
      },
    });

    const worker2 = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      workerId: "w2",
      concurrency: { maxSlots: 1 },
      jobTypeProcessing: {
        defaultLeaseConfig: leaseConfig,
        pollIntervalMs: leaseConfig.leaseMs,
      },
      jobTypeProcessors: {
        test: {
          process: async ({ prepare, complete }) => {
            await prepare({ mode: "staged" });

            if (!failed) {
              failed = true;

              jobStarted.resolve();
              await sleep(leaseConfig.renewIntervalMs * 2);
              await expect(async () => complete(async () => null)).rejects.toSatisfy(
                (error) =>
                  error instanceof
                  (notifyAdapter ? JobTakenByAnotherWorkerError : JobAlreadyCompletedError),
              );
              jobCompleted.resolve();
            }
            await sleep(10);

            return complete(async () => null);
          },
        },
      },
    });

    const failJobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      await jobStarted.promise;
      await sleep(10);

      const successJobChain = await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.startJobChain({
            ...txContext,
            typeName: "test",
            input: null,
          }),
        ),
      );

      await Promise.all([
        client.waitForJobChainCompletion(successJobChain, completionOptions),
        client.waitForJobChainCompletion(failJobChain, completionOptions),
      ]);

      await jobCompleted.promise;
    });

    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worker_error",
      }),
    );
  });

  it("does not reap its own in-progress jobs with concurrent slots", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
      test: {
        entry: true;
        input: { id: number };
        output: { id: number };
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });

    const jobsStarted = Promise.withResolvers<void>();
    const jobsCanComplete = Promise.withResolvers<void>();
    const processedJobs: number[] = [];
    const leaseConfig = { leaseMs: 10, renewIntervalMs: 1000 } satisfies LeaseConfig;

    const worker = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      workerId: "concurrent-worker",
      concurrency: { maxSlots: 2 },
      jobTypeProcessing: {
        defaultLeaseConfig: leaseConfig,
        pollIntervalMs: 10,
      },
      jobTypeProcessors: {
        test: {
          process: async ({ job, complete }) => {
            processedJobs.push(job.input.id);
            jobsStarted.resolve();

            await jobsCanComplete.promise;

            expect(job.attempt).toBe(1);

            return complete(async () => ({ id: job.input.id }));
          },
        },
      },
    });

    const jobChain1 = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { id: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await jobsStarted.promise;

      await sleep(leaseConfig.leaseMs * 5);

      const jobChain2 = await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.startJobChain({
            ...txContext,
            typeName: "test",
            input: { id: 2 },
          }),
        ),
      );

      jobsCanComplete.resolve();

      await Promise.all([
        client.waitForJobChainCompletion(jobChain1, completionOptions),
        client.waitForJobChainCompletion(jobChain2, completionOptions),
      ]);
    });

    expect(processedJobs.sort((a, b) => a - b)).toEqual([1, 2]);

    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "job_reaped",
      }),
    );

    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worker_error",
      }),
    );
  });
};
