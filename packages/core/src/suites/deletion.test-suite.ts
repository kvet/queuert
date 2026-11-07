import { sleep } from "@queuert/helpers";
import { type TestAPI, expect } from "vitest";

import { createClient } from "../client.ts";
import type { Chain } from "../entities/chain.ts";
import { BlockerReferenceError, JobNotFoundError } from "../errors.ts";
import { createProcessors } from "../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../job-types/define-job-types.ts";
import { withTxHooks } from "../tx-hooks/tx-hooks.ts";
import { createWorkerRunner } from "../worker-runner.ts";
import type { TestSuiteContext } from "./spec-context.spec-helper.ts";

export const deletionTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("deletes chain and all jobs in the tree", async ({
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "test",
        input: { value: 1 },
      }),
    );

    const deletedChains = await withTransaction(async (txCtx, txHooks) =>
      client.deleteChains({
        ...txCtx,
        txHooks,
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

    await withTransaction(async (txCtx) => {
      const fetchedChain = await client.getChain({
        ...txCtx,
        ...chain,
      });
      expect(fetchedChain).toBeUndefined();
    });
  });

  it("returns correct chain status for chain with continuation", async ({
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "step1",
        input: { value: 1 },
      }),
    );

    await withTransaction(async (txCtx, txHooks) =>
      client.completeChain({
        ...txCtx,
        txHooks,
        ...chain,
        handler: async ({ job, completeJob }) => {
          if (job.typeName === "step1") {
            await completeJob(job, async ({ complete }) =>
              complete({ continueWith: { typeName: "step2", input: { continued: true } } }),
            );
          }
        },
      }),
    );

    const chainJobs = await client.listChainJobs({ chainId: chain.id, limit: 10 });
    expect(chainJobs.items.map((job) => job.typeName)).toEqual(["step1", "step2"]);
    const continuationId = chainJobs.items[1].id;

    const deletedChains = await withTransaction(async (txCtx, txHooks) =>
      client.deleteChains({
        ...txCtx,
        txHooks,
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

    const { blockerChain, mainChain } = await withTransaction(async (txCtx, txHooks) => {
      const blockerChain = await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "blocker",
        input: null,
      });
      const mainChain = await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "main",
        input: null,
        blockers: [blockerChain],
      });
      return { blockerChain, mainChain };
    });

    await withTransaction(async (txCtx, txHooks) =>
      client.completeChain({
        ...txCtx,
        txHooks,
        ...blockerChain,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ complete }) => complete({ output: null })),
      }),
    );
    await withTransaction(async (txCtx, txHooks) =>
      client.completeChain({
        ...txCtx,
        txHooks,
        ...mainChain,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ complete }) => complete({ output: null })),
      }),
    );
    const completedMain = await client.getChain({ id: mainChain.id, typeName: "main" });
    expect(completedMain!.status).toBe("completed");

    await expect(
      withTransaction(async (txCtx, txHooks) =>
        client.deleteChains({
          ...txCtx,
          txHooks,
          ids: [blockerChain.id],
        }),
      ),
    ).rejects.toThrow(BlockerReferenceError);
  });

  it("running job receives deletion signal and its fence and complete fail", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkerRunners,
    observabilityAdapter,
    log,
    skip,
  }) => {
    if (!notifyAdapter) return skip();

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

    const workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ signal, complete, fence }) => {
              jobStarted.resolve();

              await sleep(5000, { signal });

              expect(signal.aborted).toBe(true);
              await expect(withTransaction(async (txCtx) => fence({ ...txCtx }))).rejects.toThrow(
                JobNotFoundError,
              );
              const completion = withTransaction(async (txCtx, txHooks) =>
                complete({ ...txCtx, txHooks, output: null }),
              );
              await expect(completion).rejects.toThrow(JobNotFoundError);
              jobDeleted.resolve();

              return completion;
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "test",
        input: null,
      }),
    );

    await withWorkerRunners([await workerRunner.start()], async () => {
      await jobStarted.promise;

      const deletedChains = await withTransaction(async (txCtx, txHooks) =>
        client.deleteChains({
          ...txCtx,
          txHooks,
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

  it("waits for a fenced transaction of the running job before deleting its chain", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkerRunners,
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
    const handlerAsserted = Promise.withResolvers<void>();
    const workerRunner = createWorkerRunner({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, fence }) => {
              const { deletion } = await withTransaction(async (txCtx) => {
                await fence({ ...txCtx });
                const pendingDeletion = withTransaction(async (deletionTxCtx, txHooks) =>
                  client.deleteChains({ ...deletionTxCtx, txHooks, ids: [job.chainId] }),
                );
                await sleep(200);
                const [fencedJob] = await stateAdapter.getJobs({ txCtx, jobIds: [job.id] });
                expect(fencedJob!.status).toBe("running");
                return { deletion: pendingDeletion };
              });
              await expect(deletion).resolves.toHaveLength(1);
              await expect(withTransaction(async (txCtx) => fence({ ...txCtx }))).rejects.toThrow(
                JobNotFoundError,
              );
              handlerAsserted.resolve();
              throw new Error("attempt lost");
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({ ...txCtx, txHooks, typeName: "test", input: null }),
    );

    await withWorkerRunners([await workerRunner.start()], async () => {
      await handlerAsserted.promise;
    });
    expect(await client.getChain({ id: chain.id })).toBeUndefined();
  });

  it("throws error when deleting chain referenced as a blocker", async ({
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
    const mainChain = await withTransaction(async (txCtx, txHooks) => {
      blockerChain = await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "blocker",
        input: { value: 1 },
      });
      return client.createChain({
        ...txCtx,
        txHooks,
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
      withTransaction(async (txCtx, txHooks) =>
        client.deleteChains({
          ...txCtx,
          txHooks,
          ids: [blockerChain!.id],
        }),
      ),
    ).rejects.toThrow(BlockerReferenceError);

    // Deleting both together should succeed
    const deletedChains = await withTransaction(async (txCtx, txHooks) =>
      client.deleteChains({
        ...txCtx,
        txHooks,
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

    await withTransaction(async (txCtx) => {
      const fetchedBlocker = await client.getChain({
        ...txCtx,
        id: blockerChain!.id,
        typeName: "blocker",
      });
      const fetchedMain = await client.getChain({
        ...txCtx,
        ...mainChain,
      });

      expect(fetchedBlocker).toBeUndefined();
      expect(fetchedMain).toBeUndefined();
    });
  });

  it("deleted job during complete is handled gracefully", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkerRunners,
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

    const workerRunner = createWorkerRunner({
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
                return await withTransaction(async (txCtx, txHooks) =>
                  complete({ ...txCtx, txHooks, output: null }),
                );
              } catch (error) {
                processThrown.resolve();
                throw error;
              }
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "test",
        input: null,
      }),
    );

    await withWorkerRunners([await workerRunner.start()], async () => {
      await jobStarted.promise;

      const deletedChains = await withTransaction(async (txCtx, txHooks) =>
        client.deleteChains({
          ...txCtx,
          txHooks,
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

    const chains = await withTransaction(async (txCtx, txHooks) =>
      client.createChains({
        ...txCtx,
        txHooks,
        items: [
          { typeName: "test", input: { value: 1 } },
          { typeName: "test", input: { value: 2 } },
          { typeName: "test", input: { value: 3 } },
        ],
      }),
    );

    const deletedChains = await withTransaction(async (txCtx, txHooks) =>
      client.deleteChains({
        ...txCtx,
        txHooks,
        ids: chains.map((c) => c.id),
      }),
    );

    expect(deletedChains).toHaveLength(3);
    const deletedIds = new Set(deletedChains.map((c) => c.id));
    for (const chain of chains) {
      expect(deletedIds).toContain(chain.id);
    }

    for (const chain of chains) {
      const fetched = await withTransaction(async (txCtx) =>
        client.getChain({ ...txCtx, id: chain.id }),
      );
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

    const blocker = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "blocker",
        input: null,
      }),
    );

    const [mainA, mainB] = await withTransaction(async (txCtx, txHooks) =>
      client.createChains({
        ...txCtx,
        txHooks,
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
      withTransaction(async (txCtx, txHooks) =>
        client.deleteChains({
          ...txCtx,
          txHooks,
          ids: [blocker.id],
        }),
      ),
    ).rejects.toThrow(BlockerReferenceError);

    const deletedChains = await withTransaction(async (txCtx, txHooks) =>
      client.deleteChains({
        ...txCtx,
        txHooks,
        ids: [mainA.id, mainB.id, blocker.id],
      }),
    );

    expect(deletedChains).toHaveLength(3);
  });

  it("throws when called without transaction context or txHooks", async ({
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "test",
        input: null,
      }),
    );

    await expect(
      // @ts-expect-error missing txCtx
      client.deleteChains({ ids: [chain.id] }),
    ).rejects.toThrow("requires a transaction context");
    await withTransaction(async (txCtx) => {
      await expect(
        // @ts-expect-error missing txHooks
        client.deleteChains({ ...txCtx, ids: [chain.id] }),
      ).rejects.toThrow("deleteChains requires txHooks");
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({ ...txCtx, txHooks, typeName: "test", input: null }),
    );

    await withNonTransactionContext(async (txCtx) =>
      withTxHooks(async (txHooks) => {
        await expect(client.deleteChains({ ...txCtx, txHooks, ids: [chain.id] })).rejects.toThrow(
          "not in a transaction",
        );
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "test",
        input: { value: 42 },
      }),
    );

    const deleted = await withTransaction(async (txCtx, txHooks) =>
      client.deleteChain({ ...txCtx, txHooks, id: chain.id }),
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

    const deleted = await withTransaction(async (txCtx, txHooks) =>
      client.deleteChain({
        ...txCtx,
        txHooks,
        id: "00000000-0000-0000-0000-000000000000",
      }),
    );

    expect(deleted).toBeUndefined();
  });

  it("deleteChain throws when chain is referenced as a blocker", async ({
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
    await withTransaction(async (txCtx, txHooks) => {
      blockerChain = await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "blocker",
        input: null,
      });
      return client.createChain({
        ...txCtx,
        txHooks,
        typeName: "main",
        input: null,
        blockers: [blockerChain],
      });
    });

    await expect(
      withTransaction(async (txCtx, txHooks) =>
        client.deleteChain({ ...txCtx, txHooks, id: blockerChain!.id }),
      ),
    ).rejects.toThrow(BlockerReferenceError);
  });

  it("deleteChain throws when called without transaction context or txHooks", async ({
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({ ...txCtx, txHooks, typeName: "test", input: null }),
    );

    await expect(
      // @ts-expect-error missing txCtx
      client.deleteChain({ id: chain.id }),
    ).rejects.toThrow("requires a transaction context");
    await withTransaction(async (txCtx) => {
      await expect(
        // @ts-expect-error missing txHooks
        client.deleteChain({ ...txCtx, id: chain.id }),
      ).rejects.toThrow("deleteChains requires txHooks");
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

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({ ...txCtx, txHooks, typeName: "test", input: null }),
    );

    await withNonTransactionContext(async (txCtx) =>
      withTxHooks(async (txHooks) => {
        await expect(client.deleteChain({ ...txCtx, txHooks, id: chain.id })).rejects.toThrow(
          "not in a transaction",
        );
      }),
    );

    expect(await client.getChain({ id: chain.id, typeName: "test" })).toBeDefined();
  });
};
