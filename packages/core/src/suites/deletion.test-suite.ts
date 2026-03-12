import { type TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import {
  BlockerReferenceError,
  type JobChain,
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
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
    const registry = defineJobTypeRegistry<{
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

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
        }),
      ),
    );

    const deletedChains = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.deleteJobChains({
          ...txCtx,
          transactionHooks,
          ids: [jobChain.id],
        }),
      ),
    );

    expect(deletedChains).toHaveLength(1);
    expect(deletedChains[0]).toMatchObject({
      id: jobChain.id,
      typeName: "test",
      input: { value: 1 },
      status: "pending",
    });

    await runInTransaction(async (txCtx) => {
      const fetchedJobChain = await client.getJobChain({
        ...txCtx,
        id: jobChain.id,
        typeName: "test",
      });
      expect(fetchedJobChain).toBeUndefined();
    });
  });

  it("returns correct chain status for chain with continuation", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypeRegistry<{
      step1: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "step2" };
      };
      step2: {
        input: { continued: boolean };
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

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "step1",
          input: { value: 1 },
        }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.completeJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "step1",
          id: jobChain.id,
          complete: async ({ job, complete }) => {
            if (job.typeName === "step1") {
              await complete(job, async ({ continueWith }) =>
                continueWith({ typeName: "step2", input: { continued: true } }),
              );
            }
          },
        }),
      ),
    );

    const deletedChains = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.deleteJobChains({
          ...txCtx,
          transactionHooks,
          ids: [jobChain.id],
        }),
      ),
    );

    expect(deletedChains).toHaveLength(1);
    expect(deletedChains[0]).toMatchObject({
      id: jobChain.id,
      typeName: "step1",
      input: { value: 1 },
      status: "pending",
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
    const registry = defineJobTypeRegistry<{
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
      client,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
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
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await jobStarted.promise;

      const deletedChains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.deleteJobChains({
            ...txCtx,
            transactionHooks,
            ids: [jobChain.id],
          }),
        ),
      );

      expect(deletedChains).toHaveLength(1);
      expect(deletedChains[0]).toMatchObject({
        id: jobChain.id,
        typeName: "test",
        input: null,
        status: "running",
      });

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
    const registry = defineJobTypeRegistry<{
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
    const mainChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) => {
        blockerChain = await client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 1 },
        });
        return client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: null,
          blockers: [blockerChain],
        });
      }),
    );

    expect(mainChain.status).toBe("blocked");

    // Deleting blocker chain alone should fail — main chain depends on it
    await expect(
      withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.deleteJobChains({
            ...txCtx,
            transactionHooks,
            ids: [blockerChain!.id],
          }),
        ),
      ),
    ).rejects.toThrow(BlockerReferenceError);

    // Deleting both together should succeed
    const deletedChains = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.deleteJobChains({
          ...txCtx,
          transactionHooks,
          ids: [mainChain.id, blockerChain!.id],
        }),
      ),
    );

    expect(deletedChains).toHaveLength(2);
    const deletedByType = Object.fromEntries(deletedChains.map((c) => [c.typeName, c]));
    expect(deletedByType["blocker"]).toMatchObject({
      id: blockerChain!.id,
      typeName: "blocker",
      input: { value: 1 },
      status: "pending",
    });
    expect(deletedByType["main"]).toMatchObject({
      id: mainChain.id,
      typeName: "main",
      input: null,
      status: "blocked",
    });

    await runInTransaction(async (txCtx) => {
      const fetchedBlocker = await client.getJobChain({
        ...txCtx,
        id: blockerChain!.id,
        typeName: "blocker",
      });
      const fetchedMain = await client.getJobChain({
        ...txCtx,
        id: mainChain.id,
        typeName: "main",
      });

      expect(fetchedBlocker).toBeUndefined();
      expect(fetchedMain).toBeUndefined();
    });
  });

  it("cascade throws when deleting chain referenced as blocker", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypeRegistry<{
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
    await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) => {
        blockerChain = await client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 1 },
        });
        return client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: null,
          blockers: [blockerChain],
        });
      }),
    );

    // Cascade only expands downward (dependencies), not upward (dependents)
    // Blocker has no dependencies, so the set is just [blocker] — main still references it
    await expect(
      withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.deleteJobChains({
            ...txCtx,
            transactionHooks,
            ids: [blockerChain!.id],
            cascade: true,
          }),
        ),
      ),
    ).rejects.toThrow(BlockerReferenceError);
  });

  it("cascade deletes chain and its dependencies", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypeRegistry<{
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
    let mainChain: JobChain<string, "main", null, { finalResult: number }>;
    await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) => {
        blockerChain = await client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 1 },
        });
        mainChain = await client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: null,
          blockers: [blockerChain],
        });
      }),
    );

    // Cascade from the dependent includes its blocker dependency
    const deletedChains = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.deleteJobChains({
          ...txCtx,
          transactionHooks,
          ids: [mainChain!.id],
          cascade: true,
        }),
      ),
    );

    expect(deletedChains).toHaveLength(2);
  });

  it("cascade resolves transitive dependencies", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypeRegistry<{
      root: {
        entry: true;
        input: { label: string };
        output: null;
      };
      dependent: {
        entry: true;
        input: { label: string };
        output: null;
        blockers: [{ typeName: "root" } | { typeName: "dependent" }];
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    // A ← B ← C (C depends on B, B depends on A)
    let chainA: JobChain<string, "root", { label: string }, null>;
    let chainB: JobChain<string, "dependent", { label: string }, null>;
    const chainC = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) => {
        chainA = await client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "root",
          input: { label: "A" },
        });
        chainB = await client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "dependent",
          input: { label: "B" },
          blockers: [chainA],
        });
        return client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "dependent",
          input: { label: "C" },
          blockers: [chainB],
        });
      }),
    );

    // Cascade from the leaf deletes the entire dependency chain
    const deletedChains = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.deleteJobChains({
          ...txCtx,
          transactionHooks,
          ids: [chainC.id],
          cascade: true,
        }),
      ),
    );

    expect(deletedChains).toHaveLength(3);
    const deletedIds = new Set(deletedChains.map((c) => c.id));
    expect(deletedIds).toContain(chainA!.id);
    expect(deletedIds).toContain(chainB!.id);
    expect(deletedIds).toContain(chainC.id);
  });

  it("cascade deduplicates diamond dependencies", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypeRegistry<{
      root: {
        entry: true;
        input: { label: string };
        output: null;
      };
      mid: {
        entry: true;
        input: { label: string };
        output: null;
        blockers: [{ typeName: "root" }];
      };
      top: {
        entry: true;
        input: { label: string };
        output: null;
        blockers: [{ typeName: "mid" }, { typeName: "mid" }];
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    //     D
    //    / \
    //   B   C
    //    \ /
    //     A
    let chainA: JobChain<string, "root", { label: string }, null>;
    let chainB: JobChain<string, "mid", { label: string }, null>;
    let chainC: JobChain<string, "mid", { label: string }, null>;
    const chainD = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) => {
        chainA = await client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "root",
          input: { label: "A" },
        });
        chainB = await client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "mid",
          input: { label: "B" },
          blockers: [chainA],
        });
        chainC = await client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "mid",
          input: { label: "C" },
          blockers: [chainA],
        });
        return client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "top",
          input: { label: "D" },
          blockers: [chainB, chainC],
        });
      }),
    );

    const deletedChains = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.deleteJobChains({
          ...txCtx,
          transactionHooks,
          ids: [chainD.id],
          cascade: true,
        }),
      ),
    );

    expect(deletedChains).toHaveLength(4);
    const deletedIds = new Set(deletedChains.map((c) => c.id));
    expect(deletedIds).toContain(chainA!.id);
    expect(deletedIds).toContain(chainB!.id);
    expect(deletedIds).toContain(chainC!.id);
    expect(deletedIds).toContain(chainD.id);
  });

  it("cascade with no dependencies behaves like normal delete", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypeRegistry<{
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

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    const deletedChains = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.deleteJobChains({
          ...txCtx,
          transactionHooks,
          ids: [jobChain.id],
          cascade: true,
        }),
      ),
    );

    expect(deletedChains).toHaveLength(1);
    expect(deletedChains[0]).toMatchObject({ id: jobChain.id });
  });

  it("cascade throws when dependency has external dependents", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypeRegistry<{
      shared: {
        entry: true;
        input: null;
        output: null;
      };
      consumer: {
        entry: true;
        input: { label: string };
        output: null;
        blockers: [{ typeName: "shared" }];
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    // shared ← consumerA, shared ← consumerB
    let sharedChain: JobChain<string, "shared", null, null>;
    let consumerA: JobChain<string, "consumer", { label: string }, null>;
    await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) => {
        sharedChain = await client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "shared",
          input: null,
        });
        consumerA = await client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "consumer",
          input: { label: "A" },
          blockers: [sharedChain],
        });
        return client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "consumer",
          input: { label: "B" },
          blockers: [sharedChain],
        });
      }),
    );

    // Cascade from consumerA includes shared (dependency), but consumerB also depends on shared
    await expect(
      withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.deleteJobChains({
            ...txCtx,
            transactionHooks,
            ids: [consumerA!.id],
            cascade: true,
          }),
        ),
      ),
    ).rejects.toThrow(BlockerReferenceError);
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
    const registry = defineJobTypeRegistry<{
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
      client,
      concurrency: 1,
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
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
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await jobStarted.promise;

      const deletedChains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.deleteJobChains({
            ...txCtx,
            transactionHooks,
            ids: [jobChain.id],
          }),
        ),
      );

      expect(deletedChains).toHaveLength(1);
      expect(deletedChains[0]).toMatchObject({
        id: jobChain.id,
        typeName: "test",
        input: null,
      });

      await processThrown.promise;
    });

    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "job_attempt_failed",
      }),
    );
  });

  it("deletes batch-created chains", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypeRegistry<{
      test: {
        entry: true;
        input: { value: number };
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

    const chains = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "test", input: { value: 1 } },
            { typeName: "test", input: { value: 2 } },
            { typeName: "test", input: { value: 3 } },
          ],
        }),
      ),
    );

    const deletedChains = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.deleteJobChains({
          ...txCtx,
          transactionHooks,
          ids: chains.map((c) => c.id),
        }),
      ),
    );

    expect(deletedChains).toHaveLength(3);
    const deletedIds = new Set(deletedChains.map((c) => c.id));
    for (const chain of chains) {
      expect(deletedIds).toContain(chain.id);
    }

    for (const chain of chains) {
      const fetched = await runInTransaction(async (txCtx) =>
        client.getJobChain({ ...txCtx, id: chain.id }),
      );
      expect(fetched).toBeUndefined();
    }
  });

  it("throws when deleting batch-created blocker", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypeRegistry<{
      blocker: {
        entry: true;
        input: null;
        output: null;
      };
      main: {
        entry: true;
        input: { label: string };
        output: null;
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

    const blocker = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: null,
        }),
      ),
    );

    const [mainA, mainB] = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "main", input: { label: "A" }, blockers: [blocker] },
            { typeName: "main", input: { label: "B" }, blockers: [blocker] },
          ],
        }),
      ),
    );

    expect(mainA.status).toBe("blocked");
    expect(mainB.status).toBe("blocked");

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.deleteJobChains({
            ...txCtx,
            transactionHooks,
            ids: [blocker.id],
          }),
        ),
      ),
    ).rejects.toThrow(BlockerReferenceError);

    const deletedChains = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.deleteJobChains({
          ...txCtx,
          transactionHooks,
          ids: [mainA.id, mainB.id, blocker.id],
        }),
      ),
    );

    expect(deletedChains).toHaveLength(3);
  });

  it("cascade deletes batch-created diamond dependencies", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypeRegistry<{
      root: {
        entry: true;
        input: { label: string };
        output: null;
      };
      mid: {
        entry: true;
        input: { label: string };
        output: null;
        blockers: [{ typeName: "root" }];
      };
      top: {
        entry: true;
        input: { label: string };
        output: null;
        blockers: [{ typeName: "mid" }, { typeName: "mid" }];
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    //     D
    //    / \
    //   B   C  (batch-created)
    //    \ /
    //     A
    const chainA = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "root",
          input: { label: "A" },
        }),
      ),
    );

    const [chainB, chainC] = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "mid", input: { label: "B" }, blockers: [chainA] },
            { typeName: "mid", input: { label: "C" }, blockers: [chainA] },
          ],
        }),
      ),
    );

    const chainD = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "top",
          input: { label: "D" },
          blockers: [chainB, chainC],
        }),
      ),
    );

    const deletedChains = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.deleteJobChains({
          ...txCtx,
          transactionHooks,
          ids: [chainD.id],
          cascade: true,
        }),
      ),
    );

    expect(deletedChains).toHaveLength(4);
    const deletedIds = new Set(deletedChains.map((c) => c.id));
    expect(deletedIds).toContain(chainA.id);
    expect(deletedIds).toContain(chainB.id);
    expect(deletedIds).toContain(chainC.id);
    expect(deletedIds).toContain(chainD.id);
  });
};
