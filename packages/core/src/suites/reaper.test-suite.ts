import { TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createQueuert, defineUnionJobTypes, LeaseConfig } from "../index.js";
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
    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();
    const leaseConfig = { leaseMs: 10, renewIntervalMs: 100 } satisfies LeaseConfig;

    const worker = queuert.createWorker().implementJobType({
      name: "test",
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
    });

    const failJobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers(
      await Promise.all([
        worker.start({ defaultLeaseConfig: leaseConfig, pollIntervalMs: leaseConfig.leaseMs }),
        worker.start({ defaultLeaseConfig: leaseConfig, pollIntervalMs: leaseConfig.leaseMs }),
      ]),
      async () => {
        await jobStarted.promise;

        const successJobSequence = await queuert.withNotify(async () =>
          runInTransaction(async (context) =>
            queuert.startJobSequence({
              ...context,
              typeName: "test",
              input: null,
            }),
          ),
        );

        await Promise.all([
          queuert.waitForJobSequenceCompletion({
            ...successJobSequence,
            ...completionOptions,
          }),
          queuert.waitForJobSequenceCompletion({
            ...failJobSequence,
            ...completionOptions,
          }),
        ]);

        await jobCompleted.promise;
      },
    );

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
    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();
    const leaseConfig = { leaseMs: 1, renewIntervalMs: 100 } satisfies LeaseConfig;

    const worker = queuert.createWorker().implementJobType({
      name: "test",
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
    });

    const failJobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers(
      await Promise.all([
        worker.start({ defaultLeaseConfig: leaseConfig, pollIntervalMs: leaseConfig.leaseMs }),
        worker.start({ defaultLeaseConfig: leaseConfig, pollIntervalMs: leaseConfig.leaseMs }),
      ]),
      async () => {
        await jobStarted.promise;
        await sleep(10);

        const successJobSequence = await queuert.withNotify(async () =>
          runInTransaction(async (context) =>
            queuert.startJobSequence({
              ...context,
              typeName: "test",
              input: null,
            }),
          ),
        );

        await Promise.all([
          queuert.waitForJobSequenceCompletion({
            ...successJobSequence,
            ...completionOptions,
          }),
          queuert.waitForJobSequenceCompletion({
            ...failJobSequence,
            ...completionOptions,
          }),
        ]);

        await jobCompleted.promise;
      },
    );

    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worker_error",
      }),
    );
  });
};
