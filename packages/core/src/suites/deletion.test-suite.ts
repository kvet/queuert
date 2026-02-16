import { type TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import {
  BlockerReferenceError,
  type JobChain,
  createClient,
  createInProcessWorker,
  defineJobTypes,
} from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const deletionTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("deletes job chain and all jobs in the tree", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 1 },
        }),
      ),
    );

    await runInTransaction(async (txContext) =>
      client.deleteJobChains({
        ...txContext,
        chainIds: [jobChain.id],
      }),
    );

    await runInTransaction(async (txContext) => {
      const fetchedJobChain = await client.getJobChain({
        ...txContext,
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
    const registry = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: null;
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    const jobStarted = Promise.withResolvers<void>();
    const jobDeleted = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        test: {
          attemptHandler: async ({ signal }) => {
            jobStarted.resolve();

            await sleep(5000, { signal });

            expect(signal.reason).toBe("not_found");
            jobDeleted.resolve();

            throw new Error();
          },
          leaseConfig: { leaseMs: 1000, renewIntervalMs: 100 },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await jobStarted.promise;

      await runInTransaction(async (txContext) =>
        client.deleteJobChains({
          ...txContext,
          chainIds: [jobChain.id],
        }),
      );

      await jobDeleted.promise;
    });
  });

  it("throws error when deleting chain referenced as a blocker", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    let blockerChain: JobChain<string, "blocker", { value: number }, { result: number }>;
    const mainChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) => {
        blockerChain = await client.startJobChain({
          ...txContext,
          typeName: "blocker",
          input: { value: 1 },
        });
        return client.startJobChain({
          ...txContext,
          typeName: "main",
          input: null,
          blockers: [blockerChain],
        });
      }),
    );

    expect(mainChain.status).toBe("blocked");

    // Deleting blocker chain alone should fail — main chain depends on it
    await expect(
      runInTransaction(async (txContext) =>
        client.deleteJobChains({
          ...txContext,
          chainIds: [blockerChain!.id],
        }),
      ),
    ).rejects.toThrow(BlockerReferenceError);

    // Deleting both together should succeed
    await runInTransaction(async (txContext) =>
      client.deleteJobChains({
        ...txContext,
        chainIds: [mainChain.id, blockerChain!.id],
      }),
    );

    await runInTransaction(async (txContext) => {
      const fetchedBlocker = await client.getJobChain({
        ...txContext,
        id: blockerChain!.id,
        typeName: "blocker",
      });
      const fetchedMain = await client.getJobChain({
        ...txContext,
        id: mainChain.id,
        typeName: "main",
      });

      expect(fetchedBlocker).toBeNull();
      expect(fetchedMain).toBeNull();
    });
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
    const registry = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: null;
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    const jobStarted = Promise.withResolvers<void>();
    const processThrown = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        test: {
          attemptHandler: async ({ complete }) => {
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
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await jobStarted.promise;

      await runInTransaction(async (txContext) =>
        client.deleteJobChains({
          ...txContext,
          chainIds: [jobChain.id],
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
