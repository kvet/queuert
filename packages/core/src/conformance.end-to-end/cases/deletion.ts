import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { sleep } from "@queuert/helpers/sleep";
import { dynamicSyncAsync, syncAsync, resource, step, wait } from "@queuert/sync-async";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { runInModeOf } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { BlockerReferenceError, JobNotFoundError } from "../../errors.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker/worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createCaseStateAdapter } from "../support/create-case-state-adapter.ts";
import { createLogCollector } from "../support/log-collector.ts";

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};

export const deletionGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "deletion",
  cases: [
    {
      name: "deletes chain and all jobs in the tree",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 1 },
            }),
          ),
        );

        const deletedChains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.deleteChains({
              ...txCtx,
              ids: [chain.id],
            }),
          ),
        );

        assert.equal(deletedChains.length, 1);
        assert.partialDeepStrictEqual(deletedChains[0], {
          id: chain.id,
          typeName: "test",
          input: { value: 1 },
          status: "running",
        });

        const fetchedChain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.getChain({
              ...txCtx,
              ...chain,
            }),
          ),
        );
        assert.equal(fetchedChain, undefined);
      }),
    },
    {
      name: "returns correct chain status for chain with continuation",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "step1",
              input: { value: 1 },
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.completeChain({
              ...txCtx,
              ...chain,
              handler: ({ job, completeJob }) => {
                if (job.typeName === "step1") {
                  return completeJob(job, ({ complete }) =>
                    complete({ continueWith: { typeName: "step2", input: { continued: true } } }),
                  );
                }
              },
            }),
          ),
        );

        const chainJobs = yield* step(client.listChainJobs({ chainId: chain.id, limit: 10 }));
        assert.deepEqual(
          chainJobs.items.map((job) => job.typeName),
          ["step1", "step2"],
        );
        const continuationId = chainJobs.items[1].id;

        const deletedChains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.deleteChains({
              ...txCtx,
              ids: [chain.id],
            }),
          ),
        );

        assert.equal(deletedChains.length, 1);
        assert.partialDeepStrictEqual(deletedChains[0], {
          id: chain.id,
          typeName: "step1",
          input: { value: 1 },
          status: "running",
        });
        assert.equal(yield* step(client.getJob({ id: continuationId })), undefined);
      }),
    },
    {
      name: "throws when deleting a blocker chain even after its dependents completed",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          blocker: { entry: true; input: null; output: null };
          main: { entry: true; input: null; output: null; blockers: [{ typeName: "blocker" }] };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const { blockerChain, mainChain } = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const blockerChain = yield* step(
                  client.createChain({
                    ...txCtx,
                    typeName: "blocker",
                    input: null,
                  }),
                );
                const mainChain = yield* step(
                  client.createChain({
                    ...txCtx,
                    typeName: "main",
                    input: null,
                    blockers: [blockerChain],
                  }),
                );
                return { blockerChain, mainChain };
              }),
            ),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.completeChain({
              ...txCtx,
              ...blockerChain,
              handler: ({ job, completeJob }) =>
                completeJob(job, ({ complete }) => complete({ output: null })),
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.completeChain({
              ...txCtx,
              ...mainChain,
              handler: ({ job, completeJob }) =>
                completeJob(job, ({ complete }) => complete({ output: null })),
            }),
          ),
        );
        const completedMain = yield* step(client.getChain({ id: mainChain.id, typeName: "main" }));
        assert.equal(completedMain!.status, "completed");

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.deleteChains({
                  ...txCtx,
                  ids: [blockerChain.id],
                }),
              ),
            BlockerReferenceError,
          ),
        );
      }),
    },
    {
      name: "throws error when deleting chain referenced as a blocker",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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

        const { blockerChain, mainChain } = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const blockerChain = yield* step(
                  client.createChain({
                    ...txCtx,
                    typeName: "blocker",
                    input: { value: 1 },
                  }),
                );
                const mainChain = yield* step(
                  client.createChain({
                    ...txCtx,
                    typeName: "main",
                    input: null,
                    blockers: [blockerChain],
                  }),
                );
                return { blockerChain, mainChain };
              }),
            ),
          ),
        );

        assert.equal(mainChain.status, "running");
        const mainJob = yield* step(client.getJob({ id: mainChain.id }));
        assert.equal(mainJob!.status, "blocked");

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.deleteChains({
                  ...txCtx,
                  ids: [blockerChain.id],
                }),
              ),
            BlockerReferenceError,
          ),
        );

        const deletedChains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.deleteChains({
              ...txCtx,
              ids: [mainChain.id, blockerChain.id],
            }),
          ),
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

        const { fetchedBlocker, fetchedMain } = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                return {
                  fetchedBlocker: yield* step(
                    client.getChain({
                      ...txCtx,
                      id: blockerChain.id,
                      typeName: "blocker",
                    }),
                  ),
                  fetchedMain: yield* step(
                    client.getChain({
                      ...txCtx,
                      ...mainChain,
                    }),
                  ),
                };
              }),
            ),
          ),
        );

        assert.equal(fetchedBlocker, undefined);
        assert.equal(fetchedMain, undefined);
      }),
    },
    {
      name: "deleted job during complete is handled gracefully",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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

        const workerRunner = yield* resource(
          createWorkerRunner({
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
                      return await stateAdapter.withTransaction((txCtx) =>
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
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { deleteDuringAttempt: true },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(jobStarted.promise);

        const deletedChains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.deleteChains({
              ...txCtx,
              ids: [chain.id],
            }),
          ),
        );

        assert.equal(deletedChains.length, 1);
        assert.partialDeepStrictEqual(deletedChains[0], {
          id: chain.id,
          typeName: "test",
          input: { deleteDuringAttempt: true },
        });

        assert.ok((yield* wait(completeError.promise)) instanceof JobNotFoundError);

        const nextChain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { deleteDuringAttempt: false },
            }),
          ),
        );
        const completed = yield* wait(client.awaitChain(nextChain, completionOptions));
        assert.equal(completed.status, "completed");
        yield* wait(workerRunner.close());
        assert.equal(logs.entriesOfType("job_attempt_failed").length, 0);
      }),
    },
    {
      name: "deletes batch-created chains",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { value: number };
            output: null;
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "test", input: { value: 1 } },
                { typeName: "test", input: { value: 2 } },
                { typeName: "test", input: { value: 3 } },
              ],
            }),
          ),
        );

        const deletedChains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.deleteChains({
              ...txCtx,
              ids: chains.map((c) => c.id),
            }),
          ),
        );

        assert.equal(deletedChains.length, 3);
        const deletedIds = deletedChains.map((c) => c.id);
        for (const chain of chains) {
          assert.ok(deletedIds.includes(chain.id));
        }

        for (const chain of chains) {
          const fetched = yield* step(
            stateAdapter.withTransaction((txCtx) => client.getChain({ ...txCtx, id: chain.id })),
          );
          assert.equal(fetched, undefined);
        }
      }),
    },
    {
      name: "throws when deleting batch-created blocker",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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

        const blocker = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "blocker",
              input: null,
            }),
          ),
        );

        const [mainA, mainB] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "main", input: { label: "A" }, blockers: [blocker] },
                { typeName: "main", input: { label: "B" }, blockers: [blocker] },
              ],
            }),
          ),
        );

        assert.equal(mainA.status, "running");
        assert.equal(mainB.status, "running");
        const jobA = yield* step(client.getJob({ id: mainA.id }));
        const jobB = yield* step(client.getJob({ id: mainB.id }));
        assert.equal(jobA!.status, "blocked");
        assert.equal(jobB!.status, "blocked");

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.deleteChains({
                  ...txCtx,
                  ids: [blocker.id],
                }),
              ),
            BlockerReferenceError,
          ),
        );

        const deletedChains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.deleteChains({
              ...txCtx,
              ids: [mainA.id, mainB.id, blocker.id],
            }),
          ),
        );

        assert.equal(deletedChains.length, 3);
      }),
    },
    {
      name: "throws when called without transaction context",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: null;
            output: null;
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: null,
            }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              // @ts-expect-error missing txCtx
              client.deleteChains({ ids: [chain.id] }),
            /requires a transaction context/,
          ),
        );
      }),
    },
    {
      name: "deleteChains throws when the context is not in a transaction",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              context.withNonTransactionContext((txCtx) =>
                client.deleteChains({ ...txCtx, ids: [chain.id] }),
              ),
            /not in a transaction/,
          ),
        );

        assert.notEqual(
          yield* step(client.getChain({ id: chain.id, typeName: "test" })),
          undefined,
        );
      }),
    },
    {
      name: "deleteChain deletes a single chain and returns it",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 42 },
            }),
          ),
        );

        const deleted = yield* step(
          stateAdapter.withTransaction((txCtx) => client.deleteChain({ ...txCtx, id: chain.id })),
        );

        assert.partialDeepStrictEqual(deleted, {
          id: chain.id,
          typeName: "test",
          input: { value: 42 },
          status: "running",
        });

        const fetched = yield* step(client.getChain({ id: chain.id }));
        assert.equal(fetched, undefined);
      }),
    },
    {
      name: "deleteChain returns undefined for nonexistent chain",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const deleted = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.deleteChain({
              ...txCtx,
              id: "00000000-0000-0000-0000-000000000000",
            }),
          ),
        );

        assert.equal(deleted, undefined);
      }),
    },
    {
      name: "deleteChain throws when chain is referenced as a blocker",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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

        const blockerChain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const blockerChain = yield* step(
                  client.createChain({
                    ...txCtx,
                    typeName: "blocker",
                    input: null,
                  }),
                );
                yield* step(
                  client.createChain({
                    ...txCtx,
                    typeName: "main",
                    input: null,
                    blockers: [blockerChain],
                  }),
                );
                return blockerChain;
              }),
            ),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.deleteChain({ ...txCtx, id: blockerChain.id }),
              ),
            BlockerReferenceError,
          ),
        );
      }),
    },
    {
      name: "deleteChain throws when called without transaction context",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* step(
          assertRejects(
            // @ts-expect-error missing txCtx
            () => client.deleteChain({ id: chain.id }),
            /requires a transaction context/,
          ),
        );
      }),
    },
    {
      name: "deleteChain throws when the context is not in a transaction",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              context.withNonTransactionContext((txCtx) =>
                client.deleteChain({ ...txCtx, id: chain.id }),
              ),
            /not in a transaction/,
          ),
        );

        assert.notEqual(
          yield* step(client.getChain({ id: chain.id, typeName: "test" })),
          undefined,
        );
      }),
    },
  ],
};

export const deletionAsyncGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "deletion",
  cases: [
    {
      name: "waits for a fenced transaction of the running job before deleting its chain",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
        await using notifyAdapter = await createCaseNotifyAdapter(
          createNotifyAdapter,
          stateAdapter,
        );
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
                  const { deletion } = await stateAdapter.withTransaction((txCtx) =>
                    runInModeOf(
                      stateAdapter,
                      syncAsync(function* () {
                        yield* step(fence({ ...txCtx }));
                        const pendingDeletion = stateAdapter.withTransaction((deletionTxCtx) =>
                          client.deleteChains({ ...deletionTxCtx, ids: [job.chainId] }),
                        );
                        yield* step(sleep(200));
                        const [fencedJob] = yield* step(
                          stateAdapter.getJobs({ txCtx, jobIds: [job.id] }),
                        );
                        assert.equal(fencedJob!.status, "running");
                        return { deletion: pendingDeletion };
                      }),
                    ),
                  );
                  assert.equal((await deletion).length, 1);
                  await assertRejects(
                    () => stateAdapter.withTransaction((txCtx) => fence({ ...txCtx })),
                    JobNotFoundError,
                  );
                  handlerAsserted.resolve();
                  throw new Error("attempt lost");
                },
              },
            },
          }),
        });

        const chain = await stateAdapter.withTransaction((txCtx) =>
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
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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

        const workerRunner = yield* resource(
          createWorkerRunner({
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
                    await assertRejects(
                      () => stateAdapter.withTransaction((txCtx) => fence({ ...txCtx })),
                      JobNotFoundError,
                    );
                    try {
                      await stateAdapter.withTransaction((txCtx) =>
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
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: null,
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(jobStarted.promise);

        const deletedChains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.deleteChains({
              ...txCtx,
              ids: [chain.id],
            }),
          ),
        );

        assert.equal(deletedChains.length, 1);
        assert.partialDeepStrictEqual(deletedChains[0], {
          id: chain.id,
          typeName: "test",
          input: null,
          status: "running",
        });

        yield* wait(jobDeleted.promise);
      }),
    },
  ],
};
