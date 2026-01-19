import { TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import {
  createQueuertClient,
  createQueuertInProcessWorker,
  defineJobTypes,
  LeaseConfig,
} from "../index.js";
import { JobAlreadyCompletedError } from "../queuert-helper.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

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
    const leaseConfig = { leaseMs: 1, renewIntervalMs: 100 } satisfies LeaseConfig;

    const worker1 = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      workerId: "w1",
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
              await expect(async () => complete(async () => null)).rejects.toThrow(
                JobAlreadyCompletedError,
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
              await expect(async () => complete(async () => null)).rejects.toThrow(
                JobAlreadyCompletedError,
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
};
