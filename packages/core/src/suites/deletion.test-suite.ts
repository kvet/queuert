import { TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createQueuert, DefineBlocker, defineUnionJobTypes, JobSequence } from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

export const deletionTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("deletes job sequence and all jobs in the tree", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
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
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { value: 1 },
        }),
      ),
    );

    await runInTransaction(async (context) =>
      queuert.deleteJobSequences({
        ...context,
        rootSequenceIds: [jobSequence.id],
      }),
    );

    await runInTransaction(async (context) => {
      const fetchedJobSequence = await queuert.getJobSequence({
        ...context,
        id: jobSequence.id,
        typeName: "test",
      });
      expect(fetchedJobSequence).toBeNull();
    });

    expectLogs([
      { type: "job_sequence_created" },
      { type: "job_created" },
      {
        type: "job_sequence_deleted",
        data: { id: jobSequence.id, deletedJobIds: [jobSequence.id] },
      },
    ]);
  });

  it("running job receives deletion signal", async ({
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

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await jobStarted.promise;

      await runInTransaction(async (context) =>
        queuert.deleteJobSequences({
          ...context,
          rootSequenceIds: [jobSequence.id],
        }),
      );

      await jobDeleted.promise;
    });
  });

  it("throws error when deleting sequence with external blockers", async ({
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
        blocker: {
          input: { value: number };
          output: { result: number };
        };
        main: {
          input: null;
          output: { finalResult: number };
          blockers: [DefineBlocker<"blocker">];
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

    const blockerSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "blocker",
          input: { value: 1 },
        }),
      ),
    );

    const mainSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "main",
          input: null,
          startBlockers: async () => [blockerSequence],
        }),
      ),
    );

    expect(mainSequence.status).toBe("blocked");

    await withWorkers(await Promise.all([worker.start(), worker.start()]), async () => {
      await expect(
        runInTransaction(async (context) =>
          queuert.deleteJobSequences({
            ...context,
            rootSequenceIds: [blockerSequence.id],
          }),
        ),
      ).rejects.toThrow("external job sequences depend on them");

      await runInTransaction(async (context) =>
        queuert.deleteJobSequences({
          ...context,
          rootSequenceIds: [blockerSequence.id, mainSequence.id],
        }),
      );

      blockerCanComplete.resolve();
    });

    await runInTransaction(async (context) => {
      const fetchedBlocker = await queuert.getJobSequence({
        ...context,
        id: blockerSequence.id,
        typeName: "blocker",
      });
      const fetchedMain = await queuert.getJobSequence({
        ...context,
        id: mainSequence.id,
        typeName: "main",
      });

      expect(fetchedBlocker).toBeNull();
      expect(fetchedMain).toBeNull();
    });
  });

  it("throws error when trying to delete non-root sequence", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
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
          input: null;
          output: { finalResult: number };
          blockers: [DefineBlocker<"blocker">];
        };
      }>(),
    });

    let blockerSequence: JobSequence<string, "blocker", { value: number }, { result: number }>;
    const mainSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "main",
          input: null,
          startBlockers: async () => {
            blockerSequence = await queuert.startJobSequence({
              ...context,
              typeName: "blocker",
              input: { value: 1 },
            });
            return [blockerSequence];
          },
        }),
      ),
    );

    await expect(
      runInTransaction(async (context) =>
        queuert.deleteJobSequences({
          ...context,
          rootSequenceIds: [blockerSequence.id],
        }),
      ),
    ).rejects.toThrow("must delete from the root sequence");

    await runInTransaction(async (context) =>
      queuert.deleteJobSequences({
        ...context,
        rootSequenceIds: [mainSequence.id],
      }),
    );
  });

  it("deleted job during complete is handled gracefully", async ({
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

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await jobStarted.promise;

      await runInTransaction(async (context) =>
        queuert.deleteJobSequences({
          ...context,
          rootSequenceIds: [jobSequence.id],
        }),
      );

      await processThrown.promise;
    });

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "job_sequence_deleted",
      }),
    );

    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "job_attempt_failed",
      }),
    );
  });
};
