import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { sleep } from "@queuert/helpers/sleep";
import { dynamicSyncAsync, syncAsync, resource, step, wait } from "@queuert/sync-async";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { runInModeOf } from "../../conformance/adapters.ts";
import { retryUntilPasses } from "../../conformance/retry-until-passes.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { ChainNotFoundError, JobAlreadyCompletedError } from "../../errors.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import type { NotifyAdapter } from "../../notify-adapter/notify-adapter.ts";
import { createNoopObservabilityAdapter } from "../../observability-adapter/observability-adapter.noop.ts";
import { createWorkerRunner } from "../../worker/worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createCaseStateAdapter } from "../support/create-case-state-adapter.ts";
import { createLogCollector } from "../support/log-collector.ts";
import { createSpyNotifyAdapter } from "../support/spy-notify-adapter.ts";
import { createSpyStateAdapter } from "../support/spy-state-adapter.ts";
import type { EndToEndNotifyContext, EndToEndSavepointContext } from "../types.ts";

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};

const withFailingAttemptLostDispose = (
  notifyAdapter: NotifyAdapter<"async">,
): NotifyAdapter<"async"> => ({
  ...notifyAdapter,
  listenJobAttemptsLost: async (jobIds, onNotification) => {
    const dispose = await notifyAdapter.listenJobAttemptsLost(jobIds, onNotification);
    return async () => {
      await dispose();
      throw new Error("dispose failed");
    };
  },
});

export const processGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "process",
  cases: [
    {
      name: "throws error when complete or fence is called incorrectly",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
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

        const completeAfterHandler = Promise.withResolvers<() => unknown>();
        const fenceAfterHandler = Promise.withResolvers<() => unknown>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ complete, fence }) => {
                    await context.withNonTransactionContext(async (nonTransactionCtx) => {
                      try {
                        await complete({ ...nonTransactionCtx, output: null });
                      } catch (error) {
                        assert.match((error as Error).message, /not in a transaction/);
                        return;
                      }
                      assert.fail("Expected complete to throw outside a transaction");
                    });
                    await context.withNonTransactionContext(async (nonTransactionCtx) => {
                      try {
                        await fence({ ...nonTransactionCtx });
                      } catch (error) {
                        assert.match((error as Error).message, /not in a transaction/);
                        return;
                      }
                      assert.fail("Expected fence to throw outside a transaction");
                    });
                    await assertRejects(async () => {
                      await fence({});
                    }, /fence requires a transaction context from the caller's transaction/);
                    const result = await stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          yield* step(
                            assertRejects(
                              () =>
                                complete({
                                  ...txCtx,
                                  output: null,
                                  ...({ reschedule: { afterMs: 1 } } as object),
                                }),
                              /complete requires exactly one of output, continueWith or reschedule/,
                            ),
                          );
                          yield* step(
                            assertRejects(
                              () =>
                                complete({
                                  ...txCtx,
                                  output: null,
                                  ...({ reason: "why" } as object),
                                }),
                              /complete accepts reason only together with reschedule/,
                            ),
                          );
                          yield* step(
                            assertRejects(
                              () =>
                                // @ts-expect-error the caller's transaction context is required
                                complete({ output: null }),
                              /complete requires a transaction context from the caller's transaction/,
                            ),
                          );

                          yield* step(fence({ ...txCtx }));
                          return complete({ ...txCtx, output: null });
                        }),
                      ),
                    );
                    completeAfterHandler.resolve(() =>
                      stateAdapter.withTransaction((txCtx) => complete({ ...txCtx, output: null })),
                    );
                    fenceAfterHandler.resolve(() =>
                      stateAdapter.withTransaction((txCtx) =>
                        runInModeOf(
                          stateAdapter,
                          syncAsync(function* () {
                            yield* step(fence({ ...txCtx }));
                          }),
                        ),
                      ),
                    );
                    return result;
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
        yield* wait(client.awaitChain({ chain, ...completionOptions }));
        yield* wait(workerRunner.close());

        const callComplete = yield* wait(completeAfterHandler.promise);
        yield* step(
          assertRejects(
            () => callComplete(),
            /complete cannot be called after the attempt handler has ended/,
          ),
        );
        const callFence = yield* wait(fenceAfterHandler.promise);
        yield* step(
          assertRejects(
            () => callFence(),
            /fence cannot be called after the attempt handler has ended/,
          ),
        );
      }),
    },
    {
      name: "provides attempt information to job process",
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

        const attempts: number[] = [];

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              backoffConfig: {
                initialDelayMs: 1,
                multiplier: 1,
                maxDelayMs: 1,
              },
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    attempts.push(job.attempt);

                    assert.ok(job.attempt > 0);
                    if (job.attempt > 1) {
                      assert.ok(job.lastAttemptAt instanceof Date);
                      assert.ok(typeof job?.lastAttemptError === "string");
                      assert.ok(job.lastAttemptError.includes("Error: Simulated failure"));
                    } else {
                      assert.equal(job.lastAttemptAt, null);
                      assert.equal(job.lastAttemptError, null);
                    }

                    if (job.attempt < 3) {
                      throw new Error("Simulated failure");
                    }

                    return stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
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
        yield* wait(client.awaitChain({ chain, ...completionOptions }));
        yield* wait(workerRunner.close());

        assert.deepEqual(attempts, [1, 2, 3]);
      }),
    },
    {
      name: "clears the last reschedule after a successful attempt following a failure",
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
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              backoffConfig: {
                initialDelayMs: 1,
                multiplier: 1,
                maxDelayMs: 1,
              },
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    if (job.attempt < 2) {
                      throw new Error("Simulated failure");
                    }
                    return stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
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
        yield* wait(client.awaitChain({ chain, ...completionOptions }));

        const completedJob = yield* step(client.getJob({ id: chain.id }));
        assert.equal(completedJob?.status, "completed");
        assert.equal(completedJob?.lastAttemptError, null);
        assert.equal(completedJob?.lastRescheduleReason, null);
      }),
    },
    {
      name: "uses exponential backoff progression for repeated failures",
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

        const errors: string[] = [];

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              backoffConfig: {
                initialDelayMs: 10,
                multiplier: 2.0,
                maxDelayMs: 100,
              },
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    if (job.lastAttemptError !== null) {
                      errors.push(job.lastAttemptError);
                    }

                    if (job.attempt < 4) {
                      throw new Error("Unexpected error");
                    }

                    return stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const job = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: null,
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain({ chain: job, ...completionOptions }));
        yield* wait(workerRunner.close());

        assert.equal(errors.length, 3);
        assert.ok(errors[0].includes("Error: Unexpected error"));
        assert.ok(errors[1].includes("Error: Unexpected error"));
        assert.ok(errors[2].includes("Error: Unexpected error"));
      }),
    },
    {
      name: "executes jobs",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { test: boolean };
            output: { result: boolean };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerId = stateAdapter.config.generateWorkerId();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            workerId,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    assert.equal(job.typeName, "test");
                    assert.deepEqual(job.input, { test: true });
                    assert.equal(job.status, "running");
                    assert.notEqual(job.id, undefined);
                    assert.deepEqual(job.chainId, job.id);

                    return stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          const completedJob = yield* step(
                            complete({
                              ...txCtx,
                              output: { result: true },
                            }),
                          );
                          assert.equal(completedJob.typeName, "test");
                          assert.equal(completedJob.status, "completed");
                          if (completedJob.status === "completed") {
                            assert.equal(completedJob.completedBy, workerId);
                          }
                          return completedJob;
                        }),
                      ),
                    );
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
              input: { test: true },
            }),
          ),
        );
        assert.deepEqual(chain.input, { test: true });

        yield* wait(workerRunner.start());
        const completedChain = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.equal(completedChain.status, "completed");
        assert.deepEqual(completedChain.output, { result: true });

        const completedJob = yield* step(client.getJob({ id: chain.id }));
        assert.equal(completedJob?.status, "completed");
        if (completedJob?.status === "completed") {
          assert.equal(completedJob.completedBy, workerId);
        }
      }),
    },
    {
      name: "complete should be visible to reads later in the same transaction",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          "output-then-read": {
            entry: true;
            input: null;
            output: { done: true };
          };
          "continue-then-read": {
            entry: true;
            input: null;
            continueWith: { typeName: "tail" };
          };
          tail: {
            input: null;
            output: { done: true };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                "output-then-read": {
                  attemptHandler: async ({ job, complete }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          const completedJob = yield* step(
                            complete({
                              ...txCtx,
                              output: { done: true },
                            }),
                          );
                          assert.equal(
                            (yield* step(client.getJob({ ...txCtx, id: job.id })))?.status,
                            "completed",
                          );
                          assert.equal(
                            (yield* step(client.getChain({ ...txCtx, id: job.chainId })))?.status,
                            "completed",
                          );
                          return completedJob;
                        }),
                      ),
                    ),
                },
                "continue-then-read": {
                  attemptHandler: async ({ job, complete }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          const completedJob = yield* step(
                            complete({
                              ...txCtx,
                              continueWith: { typeName: "tail", input: null },
                            }),
                          );
                          assert.equal(
                            (yield* step(client.getJob({ ...txCtx, id: job.id })))?.status,
                            "completed",
                          );
                          return completedJob;
                        }),
                      ),
                    ),
                },
                tail: {
                  attemptHandler: async ({ complete }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: { done: true } }),
                    ),
                },
              },
            }),
          }),
        );

        const [completedChain, continuedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "output-then-read", input: null },
                { typeName: "continue-then-read", input: null },
              ],
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain({ chain: completedChain, ...completionOptions }));
        yield* wait(client.awaitChain({ chain: continuedChain, ...completionOptions }));
      }),
    },
    {
      name: "keeps a committed `complete` call when the handler throws afterwards",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { done: true } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              backoffConfig: { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 },
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    if (job.attempt === 1) {
                      await stateAdapter.withTransaction((txCtx) =>
                        complete({ ...txCtx, reschedule: { afterMs: 1 } }),
                      );
                      throw new Error("after a committed reschedule");
                    }
                    await stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: { done: true } }),
                    );
                    throw new Error("after a committed output");
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { done: true });

        const job = yield* step(client.getJob({ id: chain.id }));
        assert.equal(job?.attempt, 2);
      }),
    },
    {
      name: "writes nothing when complete fails validation, so the caller may catch and complete again",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          blocker: { entry: true; input: null; output: null };
          test: { entry: true; input: null; output: null; continueWith: { typeName: "next" } };
          next: { input: null; output: null; blockers: [{ typeName: "blocker" }] };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ complete }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          yield* step(
                            assertRejects(
                              () =>
                                complete({
                                  ...txCtx,
                                  continueWith: {
                                    typeName: "next",
                                    input: null,
                                    blockers: [{ id: crypto.randomUUID(), typeName: "blocker" }],
                                  },
                                }),
                              ChainNotFoundError,
                            ),
                          );
                          return complete({ ...txCtx, output: null });
                        }),
                      ),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain({ chain, ...completionOptions }));

        const jobs = yield* step(client.listChainJobs({ chainId: chain.id }));
        assert.deepEqual(
          jobs.items.map((job) => job.typeName),
          ["test"],
        );
      }),
    },
    {
      name: "trusts a committed `complete` result returned by the handler without rescheduling",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const spyStateAdapter = createSpyStateAdapter(stateAdapter);
        const logs = createLogCollector();
        const client = createClient({
          stateAdapter: spyStateAdapter,
          notifyAdapter,
          jobTypes,
          log: logs.log,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ complete }) =>
                    stateAdapter.withTransaction((txCtx) => complete({ ...txCtx, output: null })),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain({ chain, ...completionOptions }));
        yield* wait(workerRunner.close());

        assert.ok(!spyStateAdapter.calls.map((call) => call.name).includes("rescheduleJobs"));
        assert.ok(logs.entriesOfType("job_attempt_completed").length > 0);
      }),
    },
    {
      name: "completes the attempt on a committed `complete` call when the handler returns another object",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const spyStateAdapter = createSpyStateAdapter(stateAdapter);
        const client = createClient({ stateAdapter: spyStateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              backoffConfig: { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 },
              processors: {
                test: {
                  attemptHandler: async ({ complete }) => {
                    const completed = await stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                    return { ...completed };
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain({ chain, ...completionOptions }));
        yield* wait(workerRunner.close());

        assert.ok(!spyStateAdapter.calls.map((call) => call.name).includes("rescheduleJobs"));
      }),
    },
    {
      name: "completes the attempt and reports a worker error when the handler throws after a committed `complete` call",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const spyStateAdapter = createSpyStateAdapter(stateAdapter);
        const workerError = Promise.withResolvers<unknown>();
        const client = createClient({
          stateAdapter: spyStateAdapter,
          notifyAdapter,
          observabilityAdapter: {
            ...createNoopObservabilityAdapter(),
            workerError: ({ error }) => {
              workerError.resolve(error);
            },
          },
          jobTypes,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              backoffConfig: { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 },
              processors: {
                test: {
                  attemptHandler: async ({ complete }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                    throw new Error("after a committed complete");
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.equal(
          ((yield* wait(workerError.promise)) as Error).message,
          "after a committed complete",
        );
        yield* wait(workerRunner.close());

        assert.ok(!spyStateAdapter.calls.map((call) => call.name).includes("rescheduleJobs"));
        assert.equal((yield* step(client.getJob({ id: chain.id })))?.attempt, 1);
      }),
    },
    {
      name: "fails complete and aborts the signal after a workerless takeover",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { by: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const started = Promise.withResolvers<void>();
        const takenOver = Promise.withResolvers<void>();
        const handlerAsserted = Promise.withResolvers<void>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ signal, complete }) => {
                    started.resolve();
                    await takenOver.promise;
                    await assertRejects(
                      () =>
                        stateAdapter.withTransaction((txCtx) =>
                          complete({ ...txCtx, output: { by: "worker" } }),
                        ),
                      JobAlreadyCompletedError,
                    );
                    assert.equal(signal.aborted, true);
                    handlerAsserted.resolve();
                    throw new Error("attempt lost");
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(started.promise);
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "test" },
              output: { by: "workerless" },
            }),
          ),
        );
        takenOver.resolve();
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { by: "workerless" });
        yield* wait(handlerAsserted.promise);
      }),
    },
    {
      name: "completes the attempt in a new transaction after the transaction of its first `complete` rolls back",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { try: number } };
        }>();
        const logs = createLogCollector();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes, log: logs.log });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ signal, complete }) => {
                    try {
                      await stateAdapter.withTransaction((txCtx) =>
                        runInModeOf(
                          stateAdapter,
                          syncAsync(function* () {
                            yield* step(complete({ ...txCtx, output: { try: 1 } }));
                            throw new Error("rolled back");
                          }),
                        ),
                      );
                    } catch {}
                    assert.equal(signal.aborted, false);
                    return stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: { try: 2 } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { try: 2 });
        yield* wait(workerRunner.close());

        assert.equal((yield* step(client.getJob({ id: chain.id })))?.attempt, 1);
        assert.equal(logs.entriesOfType("job_attempt_completed").length, 1);
      }),
    },
  ],
};

export const processAsyncGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "process",
  cases: [
    {
      name: "rejects a second `complete` of the attempt in the same transaction without losing the attempt",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
        await using notifyAdapter = await createCaseNotifyAdapter(
          createNotifyAdapter,
          stateAdapter,
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const spyStateAdapter = createSpyStateAdapter(stateAdapter);
        const client = createClient({ stateAdapter: spyStateAdapter, notifyAdapter, jobTypes });
        await using workerRunner = createWorkerRunner({
          client,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ signal, complete }) =>
                  stateAdapter.withTransaction((txCtx) =>
                    runInModeOf(
                      stateAdapter,
                      syncAsync(function* () {
                        const completed = complete({ ...txCtx, output: null });
                        yield* step(
                          assertRejects(
                            () => complete({ ...txCtx, output: null }),
                            /complete is already in progress for this attempt/,
                          ),
                        );
                        assert.partialDeepStrictEqual(yield* step(completed), {
                          status: "completed",
                        });
                        yield* step(
                          assertRejects(
                            () => complete({ ...txCtx, output: null }),
                            /complete already succeeded for this attempt/,
                          ),
                        );
                        assert.equal(signal.aborted, false);
                        return completed;
                      }),
                    ),
                  ),
              },
            },
          }),
        });

        const chain = await stateAdapter.withTransaction((txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: null }),
        );

        await workerRunner.start();
        await client.awaitChain({ chain, ...completionOptions });
        await workerRunner.close();

        assert.ok(!spyStateAdapter.calls.map((call) => call.name).includes("rescheduleJobs"));
      },
    },
    {
      name: "keeps the attempt alive when an extension lands after its own committed `complete` call",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
        await using notifyAdapter = await createCaseNotifyAdapter(
          createNotifyAdapter,
          stateAdapter,
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const logs = createLogCollector();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes, log: logs.log });
        let aborted: boolean | undefined;
        await using workerRunner = createWorkerRunner({
          client,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ signal, complete }) => {
                  const result = await stateAdapter.withTransaction((txCtx) =>
                    runInModeOf(
                      stateAdapter,
                      syncAsync(function* () {
                        const finished = yield* step(complete({ ...txCtx, output: null }));
                        yield* step(sleep(60));
                        return finished;
                      }),
                    ),
                  );
                  await sleep(100);
                  aborted = signal.aborted;
                  return result;
                },
              },
            },
          }),
        });

        const chain = await stateAdapter.withTransaction((txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: null }),
        );

        await workerRunner.start();
        await client.awaitChain({ chain, ...completionOptions });
        await retryUntilPasses(
          async () => {
            assert.equal(aborted, false);
          },
          { timeoutMs: 5000 },
        );
        await sleep(200);
        await workerRunner.close();

        assert.equal(aborted, false);
        assert.equal(logs.entriesOfType("job_attempt_lost").length, 0);
      },
    },
    {
      name: "holds a workerless takeover until the fenced transaction ends, then fails fence and aborts the signal",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
        await using notifyAdapter = await createCaseNotifyAdapter(
          createNotifyAdapter,
          stateAdapter,
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { by: string } };
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
                attemptHandler: async ({ job, signal, fence, complete }) => {
                  const { takeover } = await stateAdapter.withTransaction((txCtx) =>
                    runInModeOf(
                      stateAdapter,
                      syncAsync(function* () {
                        yield* step(fence({ ...txCtx }));
                        yield* step(fence({ ...txCtx }));
                        const pendingTakeover = stateAdapter.withTransaction((takeoverTxCtx) =>
                          client.applyJobOutcome({
                            ...takeoverTxCtx,
                            job: { id: job.id, typeName: "test" },
                            output: { by: "workerless" },
                          }),
                        );
                        yield* step(sleep(200));
                        const [fencedJob] = yield* step(
                          stateAdapter.getJobs({ txCtx, jobIds: [job.id] }),
                        );
                        assert.equal(fencedJob!.status, "running");
                        return { takeover: pendingTakeover };
                      }),
                    ),
                  );
                  assert.partialDeepStrictEqual(await takeover, { status: "completed" });

                  await assertRejects(
                    () => stateAdapter.withTransaction((txCtx) => fence({ ...txCtx })),
                    JobAlreadyCompletedError,
                  );
                  assert.equal(signal.aborted, true);
                  await assertRejects(
                    () =>
                      stateAdapter.withTransaction((txCtx) =>
                        complete({ ...txCtx, output: { by: "worker" } }),
                      ),
                    JobAlreadyCompletedError,
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
        const completed = await client.awaitChain({ chain, ...completionOptions });
        assert.deepEqual(completed.output, { by: "workerless" });
      },
    },
  ],
};

export const processNotifyGroup: ConformanceGroup<EndToEndNotifyContext> = {
  name: "process",
  cases: [
    {
      name: "aborts the signal when the attempt is lost after its `complete` call rolled back",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { by: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const rolledBack = Promise.withResolvers<AbortSignal>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ signal, complete }) => {
                    await assertRejects(
                      () =>
                        stateAdapter.withTransaction((txCtx) =>
                          runInModeOf(
                            stateAdapter,
                            syncAsync(function* () {
                              yield* step(complete({ ...txCtx, output: { by: "worker" } }));
                              throw new Error("rollback");
                            }),
                          ),
                        ),
                      /rollback/,
                    );
                    rolledBack.resolve(signal);
                    await sleep(completionOptions.timeoutMs, { signal });
                    throw new Error("attempt lost");
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        const signal = yield* wait(rolledBack.promise);
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "test" },
              output: { by: "workerless" },
            }),
          ),
        );
        yield* wait(
          retryUntilPasses(
            async () => {
              assert.equal(signal.aborted, true);
            },
            { timeoutMs: 5000 },
          ),
        );
      }),
    },
    {
      name: "reschedules a failed attempt when disposing its attempt-lost listener fails",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const client = createClient({
          stateAdapter,
          notifyAdapter: withFailingAttemptLostDispose(notifyAdapter),
          jobTypes,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    if (job.attempt === 1) throw new Error("first attempt fails");
                    return stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain({ chain, ...completionOptions }));

        assert.equal((yield* step(client.getJob({ id: chain.id })))?.attempt, 2);
      }),
    },
  ],
};

export const processSavepointGroup: ConformanceGroup<EndToEndSavepointContext> = {
  name: "process",
  cases: [
    {
      name: "reschedules the attempt when complete rolls back in a savepoint",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const logs = createLogCollector();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes, log: logs.log });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              backoffConfig: { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 },
              processors: {
                test: {
                  attemptHandler: async ({ complete }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          let receipt: Awaited<ReturnType<typeof complete>> | undefined;
                          try {
                            yield* step(
                              context.withSavepoint(txCtx, (txCtx) =>
                                runInModeOf(
                                  stateAdapter,
                                  syncAsync(function* () {
                                    receipt = yield* step(complete({ ...txCtx, output: null }));
                                    throw new Error("rollback to savepoint");
                                  }),
                                ),
                              ),
                            );
                          } catch {}
                          return receipt!;
                        }),
                      ),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(
          retryUntilPasses(
            async () => {
              const job = await client.getJob({ id: chain.id });
              assert.deepEqual(
                { status: job?.status, attempt: job?.attempt },
                {
                  status: "pending",
                  attempt: 1,
                },
              );
            },
            { timeoutMs: 5000 },
          ),
        );
        yield* wait(workerRunner.close());

        const job = yield* step(client.getJob({ id: chain.id }));
        assert.ok(typeof job?.lastAttemptError === "string");
        assert.ok(
          job.lastAttemptError.includes(
            "Attempt handler returned without a committed `complete` call",
          ),
        );
        assert.equal(logs.entriesOfType("job_completed").length, 0);
      }),
    },
    {
      name: "commits the `complete` call made after one rolled back in a savepoint",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { from: string } };
        }>();
        const spyStateAdapter = createSpyStateAdapter(stateAdapter);
        const logs = createLogCollector();
        const client = createClient({
          stateAdapter: spyStateAdapter,
          notifyAdapter,
          jobTypes,
          log: logs.log,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ complete }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          yield* step(
                            assertRejects(
                              () =>
                                complete({
                                  ...txCtx,
                                  continueWith: {
                                    typeName: "test",
                                    input: null,
                                    blockers: [{ id: crypto.randomUUID(), typeName: "test" }],
                                  },
                                } as never),
                              ChainNotFoundError,
                            ),
                          );
                          try {
                            yield* step(
                              context.withSavepoint(txCtx, (txCtx) =>
                                runInModeOf(
                                  stateAdapter,
                                  syncAsync(function* () {
                                    yield* step(
                                      complete({ ...txCtx, output: { from: "savepoint" } }),
                                    );
                                    throw new Error("rollback to savepoint");
                                  }),
                                ),
                              ),
                            );
                          } catch {}
                          return complete({ ...txCtx, output: { from: "transaction" } });
                        }),
                      ),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { from: "transaction" });
        yield* wait(workerRunner.close());

        assert.ok(!spyStateAdapter.calls.map((call) => call.name).includes("rescheduleJobs"));
        const completedLogs = logs.entriesOfType("job_completed");
        assert.equal(completedLogs.length, 1);
        assert.partialDeepStrictEqual(completedLogs[0].data, { output: { from: "transaction" } });
      }),
    },
    {
      name: "publishes a commit's scheduled jobs after nested savepoints that locked a pending job roll back",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          created: { entry: true; input: null; output: null };
          locked: { entry: true; input: null; output: null };
        }>();
        const spyNotifyAdapter = createSpyNotifyAdapter(notifyAdapter);
        const client = createClient({ stateAdapter, notifyAdapter: spyNotifyAdapter, jobTypes });

        const lockedChain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "locked", input: null }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                yield* step(client.createChain({ ...txCtx, typeName: "created", input: null }));
                yield* step(
                  assertRejects(
                    () =>
                      context.withSavepoint(txCtx, (outerCtx) =>
                        runInModeOf(
                          stateAdapter,
                          syncAsync(function* () {
                            yield* step(
                              assertRejects(
                                () =>
                                  context.withSavepoint(outerCtx, (innerCtx) =>
                                    runInModeOf(
                                      stateAdapter,
                                      syncAsync(function* () {
                                        yield* step(
                                          client.applyJobOutcome({
                                            ...innerCtx,
                                            job: { id: lockedChain.id },
                                            reschedule: { afterMs: 0 },
                                          }),
                                        );
                                        throw new Error("inner savepoint rolled back");
                                      }),
                                    ),
                                  ),
                                /inner savepoint rolled back/,
                              ),
                            );
                            throw new Error("outer savepoint rolled back");
                          }),
                        ),
                      ),
                    /outer savepoint rolled back/,
                  ),
                );
              }),
            ),
          ),
        );

        const lastCall = spyNotifyAdapter.calls.at(-1);
        assert.deepEqual(
          { name: lastCall?.name, args: [...(lastCall?.args ?? [])].sort() },
          { name: "notifyJobsScheduled", args: ["created", "locked"] },
        );
      }),
    },
  ],
};
