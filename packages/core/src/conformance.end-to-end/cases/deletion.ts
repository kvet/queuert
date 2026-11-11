import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers";

import { createClient } from "../../client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { BlockerReferenceError, JobNotFoundError } from "../../errors.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createLogCollector } from "../support/log-collector.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndStateAdapter } from "../types.ts";

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};

export const deletionGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "deletion",
  cases: [
    {
      name: "deletes chain and all jobs in the tree",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 1 },
          }),
        );

        const deletedChains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.deleteChains({
            ...txCtx,
            ids: [chain.id],
          }),
        );

        assert.equal(deletedChains.length, 1);
        assert.partialDeepStrictEqual(deletedChains[0], {
          id: chain.id,
          typeName: "test",
          input: { value: 1 },
          status: "running",
        });

        const fetchedChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.getChain({
            ...txCtx,
            ...chain,
          }),
        );
        assert.equal(fetchedChain, undefined);
      },
    },
    {
      name: "returns correct chain status for chain with continuation",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
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

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "step1",
            input: { value: 1 },
          }),
        );

        await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
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
        assert.deepEqual(
          chainJobs.items.map((job) => job.typeName),
          ["step1", "step2"],
        );
        const continuationId = chainJobs.items[1].id;

        const deletedChains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.deleteChains({
            ...txCtx,
            ids: [chain.id],
          }),
        );

        assert.equal(deletedChains.length, 1);
        assert.partialDeepStrictEqual(deletedChains[0], {
          id: chain.id,
          typeName: "step1",
          input: { value: 1 },
          status: "running",
        });
        assert.equal(await client.getJob({ id: continuationId }), undefined);
      },
    },
    {
      name: "throws when deleting a blocker chain even after its dependents completed",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: { entry: true; input: null; output: null };
          main: { entry: true; input: null; output: null; blockers: [{ typeName: "blocker" }] };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const { blockerChain, mainChain } = await withCaseTransaction(
          stateAdapter,
          async (txCtx) => {
            const blockerChain = await client.createChain({
              ...txCtx,
              typeName: "blocker",
              input: null,
            });
            const mainChain = await client.createChain({
              ...txCtx,
              typeName: "main",
              input: null,
              blockers: [blockerChain],
            });
            return { blockerChain, mainChain };
          },
        );

        await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
            ...blockerChain,
            handler: async ({ job, completeJob }) =>
              completeJob(job, async ({ complete }) => complete({ output: null })),
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
            ...mainChain,
            handler: async ({ job, completeJob }) =>
              completeJob(job, async ({ complete }) => complete({ output: null })),
          }),
        );
        const completedMain = await client.getChain({ id: mainChain.id, typeName: "main" });
        assert.equal(completedMain!.status, "completed");

        await assert.rejects(
          async () =>
            withCaseTransaction(stateAdapter, async (txCtx) =>
              client.deleteChains({
                ...txCtx,
                ids: [blockerChain.id],
              }),
            ),
          BlockerReferenceError,
        );
      },
    },
    {
      name: "throws error when deleting chain referenced as a blocker",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
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

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const { blockerChain, mainChain } = await withCaseTransaction(
          stateAdapter,
          async (txCtx) => {
            const blockerChain = await client.createChain({
              ...txCtx,
              typeName: "blocker",
              input: { value: 1 },
            });
            const mainChain = await client.createChain({
              ...txCtx,
              typeName: "main",
              input: null,
              blockers: [blockerChain],
            });
            return { blockerChain, mainChain };
          },
        );

        assert.equal(mainChain.status, "running");
        const mainJob = await client.getJob({ id: mainChain.id });
        assert.equal(mainJob!.status, "blocked");

        await assert.rejects(
          async () =>
            withCaseTransaction(stateAdapter, async (txCtx) =>
              client.deleteChains({
                ...txCtx,
                ids: [blockerChain.id],
              }),
            ),
          BlockerReferenceError,
        );

        const deletedChains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.deleteChains({
            ...txCtx,
            ids: [mainChain.id, blockerChain.id],
          }),
        );

        assert.equal(deletedChains.length, 2);
        const deletedByType = Object.fromEntries(deletedChains.map((c) => [c.typeName, c]));
        assert.partialDeepStrictEqual(deletedByType.blocker, {
          id: blockerChain.id,
          typeName: "blocker",
          input: { value: 1 },
          status: "running",
        });
        assert.partialDeepStrictEqual(deletedByType.main, {
          id: mainChain.id,
          typeName: "main",
          input: null,
          status: "running",
        });

        const { fetchedBlocker, fetchedMain } = await withCaseTransaction(
          stateAdapter,
          async (txCtx) => ({
            fetchedBlocker: await client.getChain({
              ...txCtx,
              id: blockerChain.id,
              typeName: "blocker",
            }),
            fetchedMain: await client.getChain({
              ...txCtx,
              ...mainChain,
            }),
          }),
        );

        assert.equal(fetchedBlocker, undefined);
        assert.equal(fetchedMain, undefined);
      },
    },
    {
      name: "deleted job during complete is handled gracefully",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { deleteDuringAttempt: boolean };
            output: null;
          };
        }>();

        const logs = createLogCollector();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes, log: logs.log });

        const jobStarted = Promise.withResolvers<void>();
        const completeError = Promise.withResolvers<unknown>();

        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ job, complete }) => {
                  if (job.input.deleteDuringAttempt) {
                    jobStarted.resolve();
                    await sleep(200);
                  }

                  try {
                    return await withCaseTransaction(stateAdapter, async (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  } catch (error) {
                    completeError.resolve(error);
                    throw error;
                  }
                },
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { deleteDuringAttempt: true },
          }),
        );

        await workerRunner.start();
        await jobStarted.promise;

        const deletedChains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.deleteChains({
            ...txCtx,
            ids: [chain.id],
          }),
        );

        assert.equal(deletedChains.length, 1);
        assert.partialDeepStrictEqual(deletedChains[0], {
          id: chain.id,
          typeName: "test",
          input: { deleteDuringAttempt: true },
        });

        assert.ok((await completeError.promise) instanceof JobNotFoundError);

        const nextChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { deleteDuringAttempt: false },
          }),
        );
        const completed = await client.awaitChain(nextChain, completionOptions);
        assert.equal(completed.status, "completed");
        await workerRunner.close();
        assert.equal(logs.entriesOfType("job_attempt_failed").length, 0);
      },
    },
    {
      name: "deletes batch-created chains",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { value: number };
            output: null;
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: [
              { typeName: "test", input: { value: 1 } },
              { typeName: "test", input: { value: 2 } },
              { typeName: "test", input: { value: 3 } },
            ],
          }),
        );

        const deletedChains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.deleteChains({
            ...txCtx,
            ids: chains.map((c) => c.id),
          }),
        );

        assert.equal(deletedChains.length, 3);
        const deletedIds = deletedChains.map((c) => c.id);
        for (const chain of chains) {
          assert.ok(deletedIds.includes(chain.id));
        }

        for (const chain of chains) {
          const fetched = await withCaseTransaction(stateAdapter, async (txCtx) =>
            client.getChain({ ...txCtx, id: chain.id }),
          );
          assert.equal(fetched, undefined);
        }
      },
    },
    {
      name: "throws when deleting batch-created blocker",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
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

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const blocker = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "blocker",
            input: null,
          }),
        );

        const [mainA, mainB] = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: [
              { typeName: "main", input: { label: "A" }, blockers: [blocker] },
              { typeName: "main", input: { label: "B" }, blockers: [blocker] },
            ],
          }),
        );

        assert.equal(mainA.status, "running");
        assert.equal(mainB.status, "running");
        const jobA = await client.getJob({ id: mainA.id });
        const jobB = await client.getJob({ id: mainB.id });
        assert.equal(jobA!.status, "blocked");
        assert.equal(jobB!.status, "blocked");

        await assert.rejects(
          async () =>
            withCaseTransaction(stateAdapter, async (txCtx) =>
              client.deleteChains({
                ...txCtx,
                ids: [blocker.id],
              }),
            ),
          BlockerReferenceError,
        );

        const deletedChains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.deleteChains({
            ...txCtx,
            ids: [mainA.id, mainB.id, blocker.id],
          }),
        );

        assert.equal(deletedChains.length, 3);
      },
    },
    {
      name: "throws when called without transaction context",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: null;
            output: null;
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: null,
          }),
        );

        await assert.rejects(
          async () =>
            // @ts-expect-error missing txCtx
            client.deleteChains({ ids: [chain.id] }),
          /requires a transaction context/,
        );
      },
    },
    {
      name: "deleteChains throws when the context is not in a transaction",
      run: async ({ createStateAdapter, createNotifyAdapter, withNonTransactionContext }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: null }),
        );

        await assert.rejects(
          async () =>
            withNonTransactionContext(async (txCtx) =>
              client.deleteChains({ ...txCtx, ids: [chain.id] }),
            ),
          /not in a transaction/,
        );

        assert.notEqual(await client.getChain({ id: chain.id, typeName: "test" }), undefined);
      },
    },
    {
      name: "deleteChain deletes a single chain and returns it",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 42 },
          }),
        );

        const deleted = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.deleteChain({ ...txCtx, id: chain.id }),
        );

        assert.partialDeepStrictEqual(deleted, {
          id: chain.id,
          typeName: "test",
          input: { value: 42 },
          status: "running",
        });

        const fetched = await client.getChain({ id: chain.id });
        assert.equal(fetched, undefined);
      },
    },
    {
      name: "deleteChain returns undefined for nonexistent chain",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const deleted = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.deleteChain({
            ...txCtx,
            id: "00000000-0000-0000-0000-000000000000",
          }),
        );

        assert.equal(deleted, undefined);
      },
    },
    {
      name: "deleteChain throws when chain is referenced as a blocker",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: { entry: true; input: null; output: null };
          main: {
            entry: true;
            input: null;
            output: null;
            blockers: [{ typeName: "blocker" }];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const blockerChain = await withCaseTransaction(stateAdapter, async (txCtx) => {
          const blockerChain = await client.createChain({
            ...txCtx,
            typeName: "blocker",
            input: null,
          });
          await client.createChain({
            ...txCtx,
            typeName: "main",
            input: null,
            blockers: [blockerChain],
          });
          return blockerChain;
        });

        await assert.rejects(
          async () =>
            withCaseTransaction(stateAdapter, async (txCtx) =>
              client.deleteChain({ ...txCtx, id: blockerChain.id }),
            ),
          BlockerReferenceError,
        );
      },
    },
    {
      name: "deleteChain throws when called without transaction context",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: null }),
        );

        await assert.rejects(
          // @ts-expect-error missing txCtx
          async () => client.deleteChain({ id: chain.id }),
          /requires a transaction context/,
        );
      },
    },
    {
      name: "deleteChain throws when the context is not in a transaction",
      run: async ({ createStateAdapter, createNotifyAdapter, withNonTransactionContext }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: null }),
        );

        await assert.rejects(
          async () =>
            withNonTransactionContext(async (txCtx) =>
              client.deleteChain({ ...txCtx, id: chain.id }),
            ),
          /not in a transaction/,
        );

        assert.notEqual(await client.getChain({ id: chain.id, typeName: "test" }), undefined);
      },
    },
    {
      name: "waits for a fenced transaction of the running job before deleting its chain",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const handlerAsserted = Promise.withResolvers<void>();
        await using workerRunner = createWorkerRunner({
          client,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ job, fence }) => {
                  const { deletion } = await withCaseTransaction(stateAdapter, async (txCtx) => {
                    await fence({ ...txCtx });
                    const pendingDeletion = withCaseTransaction(
                      stateAdapter,
                      async (deletionTxCtx) =>
                        client.deleteChains({ ...deletionTxCtx, ids: [job.chainId] }),
                    );
                    await sleep(200);
                    const [fencedJob] = await stateAdapter.getJobs({ txCtx, jobIds: [job.id] });
                    assert.equal(fencedJob!.status, "running");
                    return { deletion: pendingDeletion };
                  });
                  assert.equal((await deletion).length, 1);
                  await assert.rejects(
                    async () =>
                      withCaseTransaction(stateAdapter, async (txCtx) => fence({ ...txCtx })),
                    JobNotFoundError,
                  );
                  handlerAsserted.resolve();
                  throw new Error("attempt lost");
                },
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: null }),
        );

        await workerRunner.start();
        await handlerAsserted.promise;
        assert.equal(await client.getChain({ id: chain.id }), undefined);
      },
    },
  ],
};

export const deletionNotifyGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "deletion",
  cases: [
    {
      name: "running job receives deletion signal and its fence and complete fail",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: null;
            output: null;
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const jobStarted = Promise.withResolvers<void>();
        const jobDeleted = Promise.withResolvers<void>();

        await using workerRunner = createWorkerRunner({
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

                  assert.equal(signal.aborted, true);
                  await assert.rejects(async () => {
                    await withCaseTransaction(stateAdapter, async (txCtx) => {
                      await fence({ ...txCtx });
                    });
                  }, JobNotFoundError);
                  try {
                    await withCaseTransaction(stateAdapter, async (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  } catch (error) {
                    assert.ok(error instanceof JobNotFoundError);
                    jobDeleted.resolve();
                    throw error;
                  }
                  throw new Error("complete succeeded after the chain was deleted");
                },
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: null,
          }),
        );

        await workerRunner.start();
        await jobStarted.promise;

        const deletedChains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.deleteChains({
            ...txCtx,
            ids: [chain.id],
          }),
        );

        assert.equal(deletedChains.length, 1);
        assert.partialDeepStrictEqual(deletedChains[0], {
          id: chain.id,
          typeName: "test",
          input: null,
          status: "running",
        });

        await jobDeleted.promise;
      },
    },
  ],
};
