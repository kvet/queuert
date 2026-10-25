import { unwrap, sleep } from "@queuert/helpers";
import { type TestAPI, expect } from "vitest";

import { createClient } from "../client.js";
import { type Chain } from "../entities/chain.js";
import { BlockerReferenceError } from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../job-type-processors/create-job-type-processors.js";
import { defineJobTypes } from "../job-types/define-job-types.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { type TestSuiteContext, expectFailure } from "./spec-context.spec-helper.js";

export const deletionTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("deletes chain and all jobs in the tree", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 1 },
      }),
    );

    const deletedChains = await withTransaction((txCtx, transactionHooks) =>
      client.deleteChains({
        ...txCtx,
        transactionHooks,
        ids: [chain.id],
      }),
    );

    expect(deletedChains).toHaveLength(1);
    expect(deletedChains[0]).toMatchObject({
      id: chain.id,
      typeName: "test",
      input: { value: 1 },
      status: "running",
    });

    await withTransactionOperation(function* (txCtx) {
      const fetchedChain = yield* unwrap(
        client.getChain({
          ...txCtx,
          ...chain,
        }),
      );
      expect(fetchedChain).toBeUndefined();
    });
  });

  it("returns correct chain status for chain with continuation", async ({
    runInMode,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "step1",
        input: { value: 1 },
      }),
    );

    await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: ({ job, completeJob }) =>
          runInMode(function* () {
            if (job.typeName === "step1") {
              yield* unwrap(
                completeJob(job, ({ complete }) =>
                  complete({ continueWith: { typeName: "step2", input: { continued: true } } }),
                ),
              );
            }
          }),
      }),
    );

    const chainJobs = await client.listChainJobs({ chainId: chain.id, limit: 10 });
    expect(chainJobs.items.map((job) => job.typeName)).toEqual(["step1", "step2"]);
    const continuationId = chainJobs.items[1].id;

    const deletedChains = await withTransaction((txCtx, transactionHooks) =>
      client.deleteChains({
        ...txCtx,
        transactionHooks,
        ids: [chain.id],
      }),
    );

    expect(deletedChains).toHaveLength(1);
    expect(deletedChains[0]).toMatchObject({
      id: chain.id,
      typeName: "step1",
      input: { value: 1 },
      status: "running",
    });
    expect(await client.getJob({ id: continuationId })).toBeUndefined();
  });

  it("throws when deleting a blocker chain even after its dependents completed", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: { entry: true; input: null; output: null };
      main: { entry: true; input: null; output: null; blockers: [{ typeName: "blocker" }] };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const { blockerChain, mainChain } = await withTransactionOperation(
      function* (txCtx, transactionHooks) {
        const blockerChain = yield* unwrap(
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "blocker",
            input: null,
          }),
        );
        const mainChain = yield* unwrap(
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "main",
            input: null,
            blockers: [blockerChain],
          }),
        );
        return { blockerChain, mainChain };
      },
    );

    await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...blockerChain,
        handler: ({ job, completeJob }) =>
          completeJob(job, ({ complete }) => complete({ output: null })),
      }),
    );
    await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...mainChain,
        handler: ({ job, completeJob }) =>
          completeJob(job, ({ complete }) => complete({ output: null })),
      }),
    );
    const completedMain = await client.getChain({ id: mainChain.id, typeName: "main" });
    expect(completedMain!.status).toBe("completed");

    await expect(
      withTransaction((txCtx, transactionHooks) =>
        client.deleteChains({
          ...txCtx,
          transactionHooks,
          ids: [blockerChain.id],
        }),
      ),
    ).rejects.toThrow(BlockerReferenceError);
  });

  it("running job receives deletion signal", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: null;
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const jobStarted = Promise.withResolvers<void>();
    const jobDeleted = Promise.withResolvers<void>();

    const worker = createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ signal }) => {
              jobStarted.resolve();

              await sleep(5000, { signal });

              expect(signal.aborted).toBe(true);
              jobDeleted.resolve();

              throw new Error();
            },
            attemptConfig: { timeoutMs: 1000, heartbeatMs: 100 },
          },
        },
      }),
    });

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await jobStarted.promise;

      const deletedChains = await withTransaction((txCtx, transactionHooks) =>
        client.deleteChains({
          ...txCtx,
          transactionHooks,
          ids: [chain.id],
        }),
      );

      expect(deletedChains).toHaveLength(1);
      expect(deletedChains[0]).toMatchObject({
        id: chain.id,
        typeName: "test",
        input: null,
        status: "running",
      });

      await jobDeleted.promise;
    });
  });

  it("throws error when deleting chain referenced as a blocker", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    let blockerChain: Chain<string, "blocker", { value: number }, { result: number }>;
    const mainChain = await withTransactionOperation(function* (txCtx, transactionHooks) {
      blockerChain = yield* unwrap(
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 1 },
        }),
      );
      return client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: null,
        blockers: [blockerChain],
      });
    });

    expect(mainChain.status).toBe("running");
    const mainJob = await client.getJob({ id: mainChain.id });
    expect(mainJob!.status).toBe("blocked");

    // Deleting blocker chain alone should fail — main chain depends on it
    await expect(
      withTransaction((txCtx, transactionHooks) =>
        client.deleteChains({
          ...txCtx,
          transactionHooks,
          ids: [blockerChain!.id],
        }),
      ),
    ).rejects.toThrow(BlockerReferenceError);

    // Deleting both together should succeed
    const deletedChains = await withTransaction((txCtx, transactionHooks) =>
      client.deleteChains({
        ...txCtx,
        transactionHooks,
        ids: [mainChain.id, blockerChain!.id],
      }),
    );

    expect(deletedChains).toHaveLength(2);
    const deletedByType = Object.fromEntries(deletedChains.map((c) => [c.typeName, c]));
    expect(deletedByType.blocker).toMatchObject({
      id: blockerChain!.id,
      typeName: "blocker",
      input: { value: 1 },
      status: "running",
    });
    expect(deletedByType.main).toMatchObject({
      id: mainChain.id,
      typeName: "main",
      input: null,
      status: "running",
    });

    await withTransactionOperation(function* (txCtx) {
      const fetchedBlocker = yield* unwrap(
        client.getChain({
          ...txCtx,
          id: blockerChain!.id,
          typeName: "blocker",
        }),
      );
      const fetchedMain = yield* unwrap(
        client.getChain({
          ...txCtx,
          ...mainChain,
        }),
      );

      expect(fetchedBlocker).toBeUndefined();
      expect(fetchedMain).toBeUndefined();
    });
  });

  it("deleted job during complete is handled gracefully", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: null;
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const jobStarted = Promise.withResolvers<void>();
    const processThrown = Promise.withResolvers<void>();

    const worker = createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              jobStarted.resolve();
              await sleep(200);

              try {
                return await withTransaction((txCtx, transactionHooks) =>
                  complete({ ...txCtx, transactionHooks, output: null }),
                );
              } catch (error) {
                processThrown.resolve();
                throw error;
              }
            },
            attemptConfig: { timeoutMs: 100, heartbeatMs: 10 },
          },
        },
      }),
    });

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await jobStarted.promise;

      const deletedChains = await withTransaction((txCtx, transactionHooks) =>
        client.deleteChains({
          ...txCtx,
          transactionHooks,
          ids: [chain.id],
        }),
      );

      expect(deletedChains).toHaveLength(1);
      expect(deletedChains[0]).toMatchObject({
        id: chain.id,
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
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: null;
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chains = await withTransaction((txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "test", input: { value: 1 } },
          { typeName: "test", input: { value: 2 } },
          { typeName: "test", input: { value: 3 } },
        ],
      }),
    );

    const deletedChains = await withTransaction((txCtx, transactionHooks) =>
      client.deleteChains({
        ...txCtx,
        transactionHooks,
        ids: chains.map((c) => c.id),
      }),
    );

    expect(deletedChains).toHaveLength(3);
    const deletedIds = new Set(deletedChains.map((c) => c.id));
    for (const chain of chains) {
      expect(deletedIds).toContain(chain.id);
    }

    for (const chain of chains) {
      const fetched = await withTransaction((txCtx) => client.getChain({ ...txCtx, id: chain.id }));
      expect(fetched).toBeUndefined();
    }
  });

  it("throws when deleting batch-created blocker", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const blocker = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "blocker",
        input: null,
      }),
    );

    const [mainA, mainB] = await withTransaction((txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "main", input: { label: "A" }, blockers: [blocker] },
          { typeName: "main", input: { label: "B" }, blockers: [blocker] },
        ],
      }),
    );

    expect(mainA.status).toBe("running");
    expect(mainB.status).toBe("running");
    const jobA = await client.getJob({ id: mainA.id });
    const jobB = await client.getJob({ id: mainB.id });
    expect(jobA!.status).toBe("blocked");
    expect(jobB!.status).toBe("blocked");

    await expect(
      withTransaction((txCtx, transactionHooks) =>
        client.deleteChains({
          ...txCtx,
          transactionHooks,
          ids: [blocker.id],
        }),
      ),
    ).rejects.toThrow(BlockerReferenceError);

    const deletedChains = await withTransaction((txCtx, transactionHooks) =>
      client.deleteChains({
        ...txCtx,
        transactionHooks,
        ids: [mainA.id, mainB.id, blocker.id],
      }),
    );

    expect(deletedChains).toHaveLength(3);
  });

  it("throws when called without transaction context or transactionHooks", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: null;
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      }),
    );

    await expect(async () =>
      // @ts-expect-error missing txCtx
      client.deleteChains({ ids: [chain.id] }),
    ).rejects.toThrow("requires a transaction context");
    await withTransactionOperation(function* (txCtx) {
      yield* expectFailure(
        () =>
          // @ts-expect-error missing transactionHooks
          client.deleteChains({ ...txCtx, ids: [chain.id] }),
        "deleteChains requires transactionHooks",
      );
    });
  });

  it("deleteChains throws when the context is not in a transaction", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withNonTransactionContext,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withNonTransactionContext(async (txCtx) =>
      withTransactionHooks(async (transactionHooks) => {
        await expect(async () =>
          client.deleteChains({ ...txCtx, transactionHooks, ids: [chain.id] }),
        ).rejects.toThrow("not in a transaction");
      }),
    );

    expect(await client.getChain({ id: chain.id, typeName: "test" })).toBeDefined();
  });

  it("deleteChain deletes a single chain and returns it", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: { value: number }; output: null };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 42 },
      }),
    );

    const deleted = await withTransaction((txCtx, transactionHooks) =>
      client.deleteChain({ ...txCtx, transactionHooks, id: chain.id }),
    );

    expect(deleted).toMatchObject({
      id: chain.id,
      typeName: "test",
      input: { value: 42 },
      status: "running",
    });

    const fetched = await client.getChain({ id: chain.id });
    expect(fetched).toBeUndefined();
  });

  it("deleteChain returns undefined for nonexistent chain", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const deleted = await withTransaction((txCtx, transactionHooks) =>
      client.deleteChain({
        ...txCtx,
        transactionHooks,
        id: "00000000-0000-0000-0000-000000000000",
      }),
    );

    expect(deleted).toBeUndefined();
  });

  it("deleteChain throws when chain is referenced as a blocker", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: { entry: true; input: null; output: null };
      main: {
        entry: true;
        input: null;
        output: null;
        blockers: [{ typeName: "blocker" }];
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    let blockerChain: Chain<string, "blocker", null, null>;
    await withTransactionOperation(function* (txCtx, transactionHooks) {
      blockerChain = yield* unwrap(
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: null,
        }),
      );
      return client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: null,
        blockers: [blockerChain],
      });
    });

    await expect(
      withTransaction((txCtx, transactionHooks) =>
        client.deleteChain({ ...txCtx, transactionHooks, id: blockerChain!.id }),
      ),
    ).rejects.toThrow(BlockerReferenceError);
  });

  it("deleteChain throws when called without transaction context or transactionHooks", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await expect(async () =>
      // @ts-expect-error missing txCtx
      client.deleteChain({ id: chain.id }),
    ).rejects.toThrow("requires a transaction context");
    await withTransactionOperation(function* (txCtx) {
      yield* expectFailure(
        () =>
          // @ts-expect-error missing transactionHooks
          client.deleteChain({ ...txCtx, id: chain.id }),
        "deleteChains requires transactionHooks",
      );
    });
  });

  it("deleteChain throws when the context is not in a transaction", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withNonTransactionContext,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withNonTransactionContext(async (txCtx) =>
      withTransactionHooks(async (transactionHooks) => {
        await expect(async () =>
          client.deleteChain({ ...txCtx, transactionHooks, id: chain.id }),
        ).rejects.toThrow("not in a transaction");
      }),
    );

    expect(await client.getChain({ id: chain.id, typeName: "test" })).toBeDefined();
  });
};
