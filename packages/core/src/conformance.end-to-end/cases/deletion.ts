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
import { createSpyNotifyAdapter } from "../support/spy-notify-adapter.ts";
import type { EndToEndNotifyContext } from "../types.ts";

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
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "step1" },
              continueWith: { typeName: "step2", input: { continued: true } },
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
            client.applyJobOutcome({
              ...txCtx,
              job: { id: blockerChain.id, typeName: "blocker" },
              output: null,
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: mainChain.id, typeName: "main" },
              output: null,
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

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.deleteChains({
                  ...txCtx,
                  ids: [mainChain.id, blockerChain.id],
                }),
              ),
            BlockerReferenceError,
          ),
        );

        const deletedChains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const deletedMain = yield* step(
                  client.deleteChains({ ...txCtx, ids: [mainChain.id] }),
                );
                const deletedBlocker = yield* step(
                  client.deleteChains({ ...txCtx, ids: [blockerChain.id] }),
                );
                return [...deletedMain, ...deletedBlocker];
              }),
            ),
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
      name: "deleted job during applyJobOutcome is handled gracefully",
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
        const applyJobOutcomeError = Promise.withResolvers<unknown>();

        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    if (job.input.deleteDuringAttempt) {
                      jobStarted.resolve();
                      await sleep(200);
                    }

                    try {
                      await stateAdapter.withTransaction((txCtx) =>
                        applyJobOutcome({ ...txCtx, output: null }),
                      );
                      return;
                    } catch (error) {
                      applyJobOutcomeError.resolve(error);
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

        assert.ok((yield* wait(applyJobOutcomeError.promise)) instanceof JobNotFoundError);

        const nextChain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { deleteDuringAttempt: false },
            }),
          ),
        );
        const completed = yield* wait(
          client.awaitChain({ chain: nextChain, ...completionOptions }),
        );
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
      name: "throws when deleting a batch-created blocker before its dependents",
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
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const deletedMains = yield* step(
                  client.deleteChains({ ...txCtx, ids: [mainA.id, mainB.id] }),
                );
                const deletedBlocker = yield* step(
                  client.deleteChains({ ...txCtx, ids: [blocker.id] }),
                );
                return [...deletedMains, ...deletedBlocker];
              }),
            ),
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
    {
      name: "deleteChains after a locked read does not wake workers for the job it deleted",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = createSpyNotifyAdapter(
          yield* resource(createCaseNotifyAdapter(createNotifyAdapter, stateAdapter)),
        );
        const jobTypes = defineJobTypes<{
          "await-approval": {
            entry: true;
            input: null;
            output: { approved: boolean };
            continueWith: { typeName: "process-request" };
          };
          "process-request": { input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "await-approval", input: null }),
          ),
        );
        notifyAdapter.calls.length = 0;

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                yield* step(client.getChain({ ...txCtx, id: chain.id, lock: "exclusive" }));
                yield* step(client.deleteChains({ ...txCtx, ids: [chain.id] }));
              }),
            ),
          ),
        );

        assert.deepEqual(
          [
            ...new Set(
              notifyAdapter.calls.flatMap(({ name, args }) =>
                name === "notifyJobsScheduled" ? args : [],
              ),
            ),
          ],
          [],
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
                attemptHandler: async ({ job, fenceJob }) => {
                  const { deletion } = await stateAdapter.withTransaction((txCtx) =>
                    runInModeOf(
                      stateAdapter,
                      syncAsync(function* () {
                        yield* step(fenceJob({ ...txCtx }));
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
                    () => stateAdapter.withTransaction((txCtx) => fenceJob({ ...txCtx })),
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

export const deletionNotifyGroup: ConformanceGroup<EndToEndNotifyContext> = {
  name: "deletion",
  cases: [
    {
      name: "running job receives deletion signal and its fenceJob and applyJobOutcome fail",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
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
                  attemptHandler: async ({ job, applyJobOutcome, fenceJob }) => {
                    jobStarted.resolve();

                    await sleep(5000, { signal: job.signal });

                    assert.equal(job.signal.aborted, true);
                    await assertRejects(
                      () => stateAdapter.withTransaction((txCtx) => fenceJob({ ...txCtx })),
                      JobNotFoundError,
                    );
                    try {
                      await stateAdapter.withTransaction((txCtx) =>
                        applyJobOutcome({ ...txCtx, output: null }),
                      );
                    } catch (error) {
                      assert.ok(error instanceof JobNotFoundError);
                      jobDeleted.resolve();
                      throw error;
                    }
                    throw new Error("applyJobOutcome succeeded after the chain was deleted");
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

export const deletionNotifyConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "deletion",
    cases: [
      {
        name: "starts a pending job once the transaction deleting its chain rolls back",
        run: async ({ createStateAdapter, createNotifyAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          await using notifyAdapter = await createCaseNotifyAdapter(
            createNotifyAdapter,
            stateAdapter,
          );
          const jobTypes = defineJobTypes<{
            task: { entry: true; input: null; output: null };
          }>();

          const workerIdle = Promise.withResolvers<void>();
          const client = createClient({
            stateAdapter: {
              ...stateAdapter,
              getStartAttemptDelayMs: async (params) => {
                const delayMs = await stateAdapter.getStartAttemptDelayMs(params);
                workerIdle.resolve();
                return delayMs;
              },
            },
            notifyAdapter,
            jobTypes,
          });

          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 60_000,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          });

          const chain = await stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          );

          const deleted = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const transaction = assertRejects(
            async () =>
              stateAdapter.withTransaction(async (txCtx) => {
                await client.deleteChains({ ...txCtx, ids: [chain.id] });
                deleted.resolve();
                await release.promise;
                throw new Error("rollback");
              }),
            Error,
          );

          await deleted.promise;
          await workerRunner.start();
          await workerIdle.promise;
          release.resolve();
          await transaction;

          await client.awaitChain({ chain, ...completionOptions });
        },
      },
      {
        name: "starts a pending blocker job once the transaction whose delete it refused commits",
        run: async ({ createStateAdapter, createNotifyAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          await using notifyAdapter = await createCaseNotifyAdapter(
            createNotifyAdapter,
            stateAdapter,
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

          const workerIdle = Promise.withResolvers<void>();
          const client = createClient({
            stateAdapter: {
              ...stateAdapter,
              getStartAttemptDelayMs: async (params) => {
                const delayMs = await stateAdapter.getStartAttemptDelayMs(params);
                workerIdle.resolve();
                return delayMs;
              },
            },
            notifyAdapter,
            jobTypes,
          });

          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 60_000,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
                    );
                  },
                },
                main: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          });

          const blockerChain = await stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "blocker", input: null }),
          );
          await stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: null,
              blockers: [blockerChain],
            }),
          );

          const deleted = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const transaction = stateAdapter.withTransaction(async (txCtx) => {
            await assertRejects(
              async () => client.deleteChains({ ...txCtx, ids: [blockerChain.id] }),
              BlockerReferenceError,
            );
            deleted.resolve();
            await release.promise;
          });

          await deleted.promise;
          await workerRunner.start();
          await workerIdle.promise;
          release.resolve();
          await transaction;

          await client.awaitChain({ chain: blockerChain, ...completionOptions });
        },
      },
      {
        name: "starts a pending blocker job once the transaction whose delete it refused rolls back",
        run: async ({ createStateAdapter, createNotifyAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          await using notifyAdapter = await createCaseNotifyAdapter(
            createNotifyAdapter,
            stateAdapter,
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

          const workerIdle = Promise.withResolvers<void>();
          const client = createClient({
            stateAdapter: {
              ...stateAdapter,
              getStartAttemptDelayMs: async (params) => {
                const delayMs = await stateAdapter.getStartAttemptDelayMs(params);
                workerIdle.resolve();
                return delayMs;
              },
            },
            notifyAdapter,
            jobTypes,
          });

          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 60_000,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
                    );
                  },
                },
                main: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          });

          const blockerChain = await stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "blocker", input: null }),
          );
          await stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: null,
              blockers: [blockerChain],
            }),
          );

          const deleted = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const transaction = assertRejects(
            async () =>
              stateAdapter.withTransaction(async (txCtx) => {
                await assertRejects(
                  async () => client.deleteChains({ ...txCtx, ids: [blockerChain.id] }),
                  BlockerReferenceError,
                );
                deleted.resolve();
                await release.promise;
                throw new Error("rollback");
              }),
            Error,
          );

          await deleted.promise;
          await workerRunner.start();
          await workerIdle.promise;
          release.resolve();
          await transaction;

          await client.awaitChain({ chain: blockerChain, ...completionOptions });
        },
      },
    ],
  };

const blockerGraphJobTypes = defineJobTypes<{
  root: { entry: true; input: null; output: null };
  middle: { entry: true; input: null; output: null; blockers: [{ typeName: "root" }] };
  leaf: { entry: true; input: null; output: null; blockers: [{ typeName: "middle" }] };
  joined: {
    entry: true;
    input: null;
    output: null;
    blockers: [{ typeName: "root" }, { typeName: "middle" }];
  };
  step: { entry: true; input: null; continueWith: { typeName: "waiting" } };
  waiting: { input: null; output: null; blockers: [{ typeName: "root" }] };
}>();

export const deletionConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "deletion",
    cases: [
      {
        name: "deletes a blocked chain while the chain it waits on completes",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          const client = createClient({ stateAdapter, jobTypes: blockerGraphJobTypes });

          for (let i = 0; i < 10; i++) {
            const { rootChain, middleChain } = await stateAdapter.withTransaction(async (txCtx) => {
              const rootChain = await client.createChain({
                ...txCtx,
                typeName: "root",
                input: null,
              });
              const middleChain = await client.createChain({
                ...txCtx,
                typeName: "middle",
                input: null,
                blockers: [rootChain],
              });
              return { rootChain, middleChain };
            });

            await Promise.all([
              stateAdapter.withTransaction(async (txCtx) =>
                client.deleteChain({ ...txCtx, id: middleChain.id }),
              ),
              stateAdapter.withTransaction(async (txCtx) =>
                client.applyJobOutcome({
                  ...txCtx,
                  job: { id: rootChain.id, typeName: "root" },
                  output: null,
                }),
              ),
            ]);

            assert.equal(await client.getChain({ id: middleChain.id }), undefined);
            const [completedRoot] = await stateAdapter.getChains({ chainIds: [rootChain.id] });
            assert.equal(completedRoot!.status, "completed");
            assert.equal(completedRoot!.blocking, false);
          }
        },
      },
      {
        name: "deletes chains that wait on a chain and on each other while that chain completes",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          const client = createClient({ stateAdapter, jobTypes: blockerGraphJobTypes });

          for (let i = 0; i < 10; i++) {
            const { rootChain, middleChain, firstJoinedChain, secondJoinedChain } =
              await stateAdapter.withTransaction(async (txCtx) => {
                const rootChain = await client.createChain({
                  ...txCtx,
                  typeName: "root",
                  input: null,
                });
                const middleChain = await client.createChain({
                  ...txCtx,
                  typeName: "middle",
                  input: null,
                  blockers: [rootChain],
                });
                const firstJoinedChain = await client.createChain({
                  ...txCtx,
                  typeName: "joined",
                  input: null,
                  blockers: [rootChain, middleChain],
                });
                const secondJoinedChain = await client.createChain({
                  ...txCtx,
                  typeName: "joined",
                  input: null,
                  blockers: [rootChain, middleChain],
                });
                return { rootChain, middleChain, firstJoinedChain, secondJoinedChain };
              });

            await Promise.all([
              stateAdapter.withTransaction(async (txCtx) =>
                client.deleteChain({ ...txCtx, id: firstJoinedChain.id }),
              ),
              stateAdapter.withTransaction(async (txCtx) =>
                client.deleteChain({ ...txCtx, id: secondJoinedChain.id }),
              ),
              stateAdapter.withTransaction(async (txCtx) =>
                client.applyJobOutcome({
                  ...txCtx,
                  job: { id: rootChain.id, typeName: "root" },
                  output: null,
                }),
              ),
            ]);

            assert.equal(await client.getChain({ id: firstJoinedChain.id }), undefined);
            assert.equal(await client.getChain({ id: secondJoinedChain.id }), undefined);
            const [completedRoot, unblockedMiddle] = await stateAdapter.getChains({
              chainIds: [rootChain.id, middleChain.id],
            });
            assert.equal(completedRoot!.status, "completed");
            assert.equal(completedRoot!.blocking, true);
            assert.equal(unblockedMiddle!.head.status, "pending");
            assert.equal(unblockedMiddle!.blocking, false);
          }
        },
      },
      {
        name: "deletes a chain whose continuation waits on a chain while that chain completes",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          const client = createClient({ stateAdapter, jobTypes: blockerGraphJobTypes });

          for (let i = 0; i < 10; i++) {
            const { rootChain, stepChain } = await stateAdapter.withTransaction(async (txCtx) => {
              const rootChain = await client.createChain({
                ...txCtx,
                typeName: "root",
                input: null,
              });
              const stepChain = await client.createChain({
                ...txCtx,
                typeName: "step",
                input: null,
              });
              return { rootChain, stepChain };
            });
            await stateAdapter.withTransaction(async (txCtx) =>
              client.applyJobOutcome({
                ...txCtx,
                job: { id: stepChain.id, typeName: "step" },
                continueWith: { typeName: "waiting", input: null, blockers: [rootChain] },
              }),
            );

            await Promise.all([
              stateAdapter.withTransaction(async (txCtx) =>
                client.deleteChain({ ...txCtx, id: stepChain.id }),
              ),
              stateAdapter.withTransaction(async (txCtx) =>
                client.applyJobOutcome({
                  ...txCtx,
                  job: { id: rootChain.id, typeName: "root" },
                  output: null,
                }),
              ),
            ]);

            assert.equal(await client.getChain({ id: stepChain.id }), undefined);
            const [completedRoot] = await stateAdapter.getChains({ chainIds: [rootChain.id] });
            assert.equal(completedRoot!.status, "completed");
            assert.equal(completedRoot!.blocking, false);
          }
        },
      },
      {
        name: "deletes a chain while it continues with a job that waits on a chain that completes",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          const client = createClient({ stateAdapter, jobTypes: blockerGraphJobTypes });

          for (let i = 0; i < 30; i++) {
            const { rootChain, stepChain } = await stateAdapter.withTransaction(async (txCtx) => {
              const rootChain = await client.createChain({
                ...txCtx,
                typeName: "root",
                input: null,
              });
              const stepChain = await client.createChain({
                ...txCtx,
                typeName: "step",
                input: null,
              });
              return { rootChain, stepChain };
            });

            await Promise.all([
              Promise.resolve(
                stateAdapter.withTransaction(async (txCtx) =>
                  client.applyJobOutcome({
                    ...txCtx,
                    job: { id: stepChain.id, typeName: "step" },
                    continueWith: { typeName: "waiting", input: null, blockers: [rootChain] },
                  }),
                ),
              ).catch((error: unknown) => {
                assert.ok(error instanceof JobNotFoundError);
              }),
              stateAdapter.withTransaction(async (txCtx) =>
                client.deleteChain({ ...txCtx, id: stepChain.id }),
              ),
              stateAdapter.withTransaction(async (txCtx) =>
                client.applyJobOutcome({
                  ...txCtx,
                  job: { id: rootChain.id, typeName: "root" },
                  output: null,
                }),
              ),
            ]);

            assert.equal(await client.getChain({ id: stepChain.id }), undefined);
            const [completedRoot] = await stateAdapter.getChains({ chainIds: [rootChain.id] });
            assert.equal(completedRoot!.status, "completed");
            assert.equal(completedRoot!.blocking, false);
          }
        },
      },
      {
        name: "refuses concurrent deletes of chains that each wait on a chain the other deletes",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          const client = createClient({ stateAdapter, jobTypes: blockerGraphJobTypes });

          await Promise.all(
            Array.from({ length: 10 }, async () => {
              const { rootChain, middleChain, leafChain } = await stateAdapter.withTransaction(
                async (txCtx) => {
                  const rootChain = await client.createChain({
                    ...txCtx,
                    typeName: "root",
                    input: null,
                  });
                  const middleChain = await client.createChain({
                    ...txCtx,
                    typeName: "middle",
                    input: null,
                    blockers: [rootChain],
                  });
                  const leafChain = await client.createChain({
                    ...txCtx,
                    typeName: "leaf",
                    input: null,
                    blockers: [middleChain],
                  });
                  return { rootChain, middleChain, leafChain };
                },
              );

              await Promise.all([
                assertRejects(
                  async () =>
                    stateAdapter.withTransaction(async (txCtx) =>
                      client.deleteChains({ ...txCtx, ids: [leafChain.id, rootChain.id] }),
                    ),
                  BlockerReferenceError,
                ),
                assertRejects(
                  async () =>
                    stateAdapter.withTransaction(async (txCtx) =>
                      client.deleteChains({ ...txCtx, ids: [middleChain.id] }),
                    ),
                  BlockerReferenceError,
                ),
              ]);

              const remaining = await stateAdapter.getChains({
                chainIds: [rootChain.id, middleChain.id, leafChain.id],
              });
              assert.deepEqual(
                remaining.map((chain) => chain?.blocking),
                [true, true, false],
              );
            }),
          );
        },
      },
    ],
  };

export const deletionConcurrentTransactionsLockWaitGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "deletion",
    cases: [
      {
        name: "refuses to delete a chain that gains a blocked chain while the delete waits on its lock",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          const client = createClient({ stateAdapter, jobTypes: blockerGraphJobTypes });

          const rootChain = await stateAdapter.withTransaction(async (txCtx) =>
            client.createChain({ ...txCtx, typeName: "root", input: null }),
          );

          const created = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const creatorTx = stateAdapter.withTransaction(async (txCtx) => {
            const middleChain = await client.createChain({
              ...txCtx,
              typeName: "middle",
              input: null,
              blockers: [rootChain],
            });
            created.resolve();
            await release.promise;
            return middleChain;
          });

          await created.promise;

          let deleteSettled = false;
          const deleteTx = Promise.resolve(
            stateAdapter.withTransaction(async (txCtx) =>
              client.deleteChain({ ...txCtx, id: rootChain.id }),
            ),
          ).then(
            () => assert.fail("Expected the delete to be refused"),
            (error: unknown) => error,
          );
          void deleteTx.finally(() => {
            deleteSettled = true;
          });

          try {
            await sleep(100);
            assert.equal(deleteSettled, false);
          } finally {
            release.resolve();
          }
          await creatorTx;
          const error = await deleteTx;
          assert.ok(error instanceof BlockerReferenceError);
          assert.deepEqual(error.chainIds, [rootChain.id]);
        },
      },
    ],
  };
