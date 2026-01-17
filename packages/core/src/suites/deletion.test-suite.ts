import { TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createQueuert, defineJobTypes, JobChain } from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

export const deletionTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("deletes job chain and all jobs in the tree", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    const jobChain = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobChain({
          ...context,
          typeName: "test",
          input: { value: 1 },
        }),
      ),
    );

    await runInTransaction(async (context) =>
      queuert.deleteJobChains({
        ...context,
        rootChainIds: [jobChain.id],
      }),
    );

    await runInTransaction(async (context) => {
      const fetchedJobChain = await queuert.getJobChain({
        ...context,
        id: jobChain.id,
        typeName: "test",
      });
      expect(fetchedJobChain).toBeNull();
    });
  });

  it("running job receives deletion signal", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        test: {
          entry: true;
          input: null;
          output: null;
        };
      }>(),
    });

    const jobStarted = Promise.withResolvers<void>();
    const jobDeleted = Promise.withResolvers<void>();

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
      process: async ({ signal }) => {
        jobStarted.resolve();

        await sleep(5000, { signal });

        expect(signal.reason).toBe("not_found");
        jobDeleted.resolve();

        throw new Error();
      },
      leaseConfig: { leaseMs: 1000, renewIntervalMs: 100 },
    });

    const jobChain = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobChain({
          ...context,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await jobStarted.promise;

      await runInTransaction(async (context) =>
        queuert.deleteJobChains({
          ...context,
          rootChainIds: [jobChain.id],
        }),
      );

      await jobDeleted.promise;
    });
  });

  it("throws error when deleting chain with external blockers", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        blocker: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
        main: {
          entry: true;
          input: null;
          output: { finalResult: number };
          blockers: [{ typeName: "blocker" }];
        };
      }>(),
    });

    const blockerCanComplete = Promise.withResolvers<void>();

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "blocker",
        process: async ({ job, complete }) => {
          await blockerCanComplete.promise;
          return complete(async () => ({ result: job.input.value }));
        },
      })
      .implementJobType({
        typeName: "main",
        process: async ({
          job: {
            blockers: [blocker],
          },
          prepare,
          complete,
        }) => {
          await prepare({ mode: "atomic" });
          return complete(async () => ({ finalResult: blocker.output.result }));
        },
      });

    const blockerChain = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobChain({
          ...context,
          typeName: "blocker",
          input: { value: 1 },
        }),
      ),
    );

    const mainChain = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobChain({
          ...context,
          typeName: "main",
          input: null,
          startBlockers: async () => [blockerChain],
        }),
      ),
    );

    expect(mainChain.status).toBe("blocked");

    await withWorkers(await Promise.all([worker.start(), worker.start()]), async () => {
      await expect(
        runInTransaction(async (context) =>
          queuert.deleteJobChains({
            ...context,
            rootChainIds: [blockerChain.id],
          }),
        ),
      ).rejects.toThrow("external job chains depend on them");

      await runInTransaction(async (context) =>
        queuert.deleteJobChains({
          ...context,
          rootChainIds: [blockerChain.id, mainChain.id],
        }),
      );

      blockerCanComplete.resolve();
    });

    await runInTransaction(async (context) => {
      const fetchedBlocker = await queuert.getJobChain({
        ...context,
        id: blockerChain.id,
        typeName: "blocker",
      });
      const fetchedMain = await queuert.getJobChain({
        ...context,
        id: mainChain.id,
        typeName: "main",
      });

      expect(fetchedBlocker).toBeNull();
      expect(fetchedMain).toBeNull();
    });
  });

  it("throws error when trying to delete non-root chain", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        blocker: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
        main: {
          entry: true;
          input: null;
          output: { finalResult: number };
          blockers: [{ typeName: "blocker" }];
        };
      }>(),
    });

    let blockerChain: JobChain<string, "blocker", { value: number }, { result: number }>;
    const mainChain = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobChain({
          ...context,
          typeName: "main",
          input: null,
          startBlockers: async () => {
            blockerChain = await queuert.startJobChain({
              ...context,
              typeName: "blocker",
              input: { value: 1 },
            });
            return [blockerChain];
          },
        }),
      ),
    );

    await expect(
      runInTransaction(async (context) =>
        queuert.deleteJobChains({
          ...context,
          rootChainIds: [blockerChain.id],
        }),
      ),
    ).rejects.toThrow("must delete from the root chain");

    await runInTransaction(async (context) =>
      queuert.deleteJobChains({
        ...context,
        rootChainIds: [mainChain.id],
      }),
    );
  });

  it("deleted job during complete is handled gracefully", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        test: {
          entry: true;
          input: null;
          output: null;
        };
      }>(),
    });

    const jobStarted = Promise.withResolvers<void>();
    const processThrown = Promise.withResolvers<void>();

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
      process: async ({ complete }) => {
        jobStarted.resolve();
        await sleep(200);

        try {
          return await complete(async () => null);
        } catch (error) {
          processThrown.resolve();
          throw error;
        }
      },
      leaseConfig: { leaseMs: 100, renewIntervalMs: 10 },
    });

    const jobChain = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobChain({
          ...context,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await jobStarted.promise;

      await runInTransaction(async (context) =>
        queuert.deleteJobChains({
          ...context,
          rootChainIds: [jobChain.id],
        }),
      );

      await processThrown.promise;
    });

    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "job_attempt_failed",
      }),
    );
  });
};
