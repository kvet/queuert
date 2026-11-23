import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { sleep } from "@queuert/helpers/sleep";
import { dynamicSyncAsync, syncAsync, resource, step, wait } from "@queuert/sync-async";

import type { AttemptMiddleware } from "../../attempt-middleware/attempt-middleware.ts";
import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { runInModeOf } from "../../conformance/adapters.ts";
import { retryUntilPasses } from "../../conformance/retry-until-passes.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import {
  ChainNotFoundError,
  JobAlreadyCompletedError,
  JobsAlreadyCompletedError,
  JobsNotFoundError,
  JobsTakenByAnotherWorkerError,
} from "../../errors.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
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

export const processGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "process",
  cases: [
    {
      name: "throws error when applyJobOutcome or fenceJob is called incorrectly",
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

        const applyJobOutcomeAfterHandler = Promise.withResolvers<() => unknown>();
        const fenceJobAfterHandler = Promise.withResolvers<() => unknown>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ applyJobOutcome, fenceJob }) => {
                    await context.withNonTransactionContext(async (nonTransactionCtx) => {
                      try {
                        await applyJobOutcome({ ...nonTransactionCtx, output: null });
                      } catch (error) {
                        assert.match((error as Error).message, /not in a transaction/);
                        return;
                      }
                      assert.fail("Expected applyJobOutcome to throw outside a transaction");
                    });
                    await context.withNonTransactionContext(async (nonTransactionCtx) => {
                      try {
                        await fenceJob({ ...nonTransactionCtx });
                      } catch (error) {
                        assert.match((error as Error).message, /not in a transaction/);
                        return;
                      }
                      assert.fail("Expected fenceJob to throw outside a transaction");
                    });
                    await assertRejects(async () => {
                      await fenceJob({});
                    }, /fenceJob requires a transaction context from the caller's transaction/);
                    await stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          yield* step(
                            assertRejects(
                              () =>
                                applyJobOutcome({
                                  ...txCtx,
                                  output: null,
                                  ...({ reschedule: { afterMs: 1 } } as object),
                                }),
                              /applyJobOutcome requires exactly one of output, continueWith or reschedule/,
                            ),
                          );
                          yield* step(
                            assertRejects(
                              () =>
                                applyJobOutcome({
                                  ...txCtx,
                                  ...({ fail: new Error("failed") } as object),
                                } as Parameters<typeof applyJobOutcome>[0]),
                              /applyJobOutcome requires exactly one of output, continueWith or reschedule/,
                            ),
                          );
                          yield* step(
                            assertRejects(
                              () =>
                                applyJobOutcome({
                                  ...txCtx,
                                  output: null,
                                  ...({ reason: "why" } as object),
                                }),
                              /applyJobOutcome accepts reason only together with reschedule/,
                            ),
                          );
                          yield* step(
                            assertRejects(
                              () =>
                                // @ts-expect-error the caller's transaction context is required
                                applyJobOutcome({ output: null }),
                              /applyJobOutcome requires a transaction context from the caller's transaction/,
                            ),
                          );

                          yield* step(fenceJob({ ...txCtx }));
                          return applyJobOutcome({ ...txCtx, output: null });
                        }),
                      ),
                    );
                    applyJobOutcomeAfterHandler.resolve(() =>
                      stateAdapter.withTransaction((txCtx) =>
                        applyJobOutcome({ ...txCtx, output: null }),
                      ),
                    );
                    fenceJobAfterHandler.resolve(() =>
                      stateAdapter.withTransaction((txCtx) =>
                        runInModeOf(
                          stateAdapter,
                          syncAsync(function* () {
                            yield* step(fenceJob({ ...txCtx }));
                          }),
                        ),
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
              input: null,
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain({ chain, ...completionOptions }));
        yield* wait(workerRunner.close());

        const callApplyJobOutcome = yield* wait(applyJobOutcomeAfterHandler.promise);
        yield* step(
          assertRejects(
            () => callApplyJobOutcome(),
            /applyJobOutcome cannot be called after the attempt handler has ended/,
          ),
        );
        const callFenceJob = yield* wait(fenceJobAfterHandler.promise);
        yield* step(
          assertRejects(
            () => callFenceJob(),
            /fenceJob cannot be called after the attempt handler has ended/,
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
                  attemptHandler: async ({ job, applyJobOutcome }) => {
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

                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
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
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    if (job.attempt < 2) {
                      throw new Error("Simulated failure");
                    }
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
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
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    if (job.lastAttemptError !== null) {
                      errors.push(job.lastAttemptError);
                    }

                    if (job.attempt < 4) {
                      throw new Error("Unexpected error");
                    }

                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
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
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    assert.equal(job.typeName, "test");
                    assert.deepEqual(job.input, { test: true });
                    assert.equal(job.status, "running");
                    assert.notEqual(job.id, undefined);
                    assert.deepEqual(job.chainId, job.id);

                    await stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          const completedJob = yield* step(
                            applyJobOutcome({
                              ...txCtx,
                              output: { result: true },
                            }),
                          );
                          assert.equal(completedJob.typeName, "test");
                          assert.equal(completedJob.status, "completed");
                          if (completedJob.status === "completed") {
                            assert.equal(completedJob.completedBy, workerId);
                          }
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
      name: "applyJobOutcome should be visible to reads later in the same transaction",
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
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          yield* step(
                            applyJobOutcome({
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
                        }),
                      ),
                    );
                  },
                },
                "continue-then-read": {
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          yield* step(
                            applyJobOutcome({
                              ...txCtx,
                              continueWith: { typeName: "tail", input: null },
                            }),
                          );
                          assert.equal(
                            (yield* step(client.getJob({ ...txCtx, id: job.id })))?.status,
                            "completed",
                          );
                        }),
                      ),
                    );
                  },
                },
                tail: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: { done: true } }),
                    );
                  },
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
      name: "keeps a committed `applyJobOutcome` call when the handler throws afterwards",
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
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    if (job.attempt === 1) {
                      await stateAdapter.withTransaction((txCtx) =>
                        applyJobOutcome({ ...txCtx, reschedule: { afterMs: 1 } }),
                      );
                      throw new Error("after a committed reschedule");
                    }
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: { done: true } }),
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
      name: "writes nothing when applyJobOutcome fails validation, so the caller may catch and apply an outcome again",
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
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          yield* step(
                            assertRejects(
                              () =>
                                applyJobOutcome({
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
                          return applyJobOutcome({ ...txCtx, output: null });
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
      name: "completes the attempt on a committed `applyJobOutcome` call without rescheduling",
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
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
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
        yield* wait(workerRunner.close());

        assert.ok(!spyStateAdapter.calls.map((call) => call.name).includes("rescheduleJobs"));
        assert.ok(logs.entriesOfType("job_attempt_completed").length > 0);
      }),
    },
    {
      name: "completes the attempt and reports a worker error when the handler throws after a committed `applyJobOutcome` call",
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
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
                    );
                    throw new Error("after a committed applyJobOutcome");
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
          "after a committed applyJobOutcome",
        );
        yield* wait(workerRunner.close());

        assert.ok(!spyStateAdapter.calls.map((call) => call.name).includes("rescheduleJobs"));
        assert.equal((yield* step(client.getJob({ id: chain.id })))?.attempt, 1);
      }),
    },
    {
      name: "fails applyJobOutcome and aborts the signal after a workerless takeover",
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
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    started.resolve();
                    await takenOver.promise;
                    await assertRejects(
                      () =>
                        stateAdapter.withTransaction((txCtx) =>
                          applyJobOutcome({ ...txCtx, output: { by: "worker" } }),
                        ),
                      JobAlreadyCompletedError,
                    );
                    assert.equal(job.signal.aborted, true);
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
      name: "completes the attempt in a new transaction after the transaction of its first `applyJobOutcome` rolls back",
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
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    try {
                      await stateAdapter.withTransaction((txCtx) =>
                        runInModeOf(
                          stateAdapter,
                          syncAsync(function* () {
                            yield* step(applyJobOutcome({ ...txCtx, output: { try: 1 } }));
                            throw new Error("rolled back");
                          }),
                        ),
                      );
                    } catch {}
                    assert.equal(job.signal.aborted, false);
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: { try: 2 } }),
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
    {
      name: "settles every job of a batch in one transaction with one `applyJobOutcomes` call",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { index: number }; output: { doubled: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const middlewareJobIds = Promise.withResolvers<string[]>();
        const handlerJobIds = Promise.withResolvers<string[]>();
        const batchMiddleware: AttemptMiddleware<any, Record<string, never>> = {
          wrapHandler: async ({ jobs, next }) => {
            middlewareJobIds.resolve(jobs.map((job) => job.id));
            return next({});
          },
        };
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              backoffConfig: { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 },
              attemptMiddleware: [batchMiddleware],
              processors: {
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes, fenceJobs }) => {
                    handlerJobIds.resolve(jobs.map((job) => job.id));
                    await stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          yield* step(fenceJobs({ ...txCtx, jobs }));
                          const results = yield* step(
                            applyJobOutcomes({
                              ...txCtx,
                              items: jobs.map((job) =>
                                job.input.index === 0
                                  ? { job, output: { doubled: 0 } }
                                  : job.input.index === 1
                                    ? { job, reschedule: { afterMs: 60_000 }, reason: "later" }
                                    : { job, fail: new Error("bad item") },
                              ),
                            }),
                          );
                          assert.deepEqual(
                            results.map((result) => result.id),
                            jobs.map((job) => job.id),
                          );
                          assert.deepEqual(
                            results.map((result) => result.status),
                            jobs.map((job) => (job.input.index === 0 ? "completed" : "pending")),
                          );
                          return results;
                        }),
                      ),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [0, 1, 2].map((index) => ({ typeName: "task" as const, input: { index } })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(
          client.awaitChain({ chain: chains[0], ...completionOptions }),
        );
        assert.deepEqual(completed.output, { doubled: 0 });
        assert.deepEqual(
          (yield* wait(handlerJobIds.promise)).toSorted(),
          chains.map((chain) => chain.id).toSorted(),
        );
        assert.deepEqual(
          (yield* wait(middlewareJobIds.promise)).toSorted(),
          chains.map((chain) => chain.id).toSorted(),
        );

        const rescheduled = yield* step(client.getJob({ id: chains[1].id }));
        assert.equal(rescheduled?.status, "pending");
        assert.equal(rescheduled?.lastRescheduleReason, "later");
        assert.equal(rescheduled?.consecutiveFailures, 0);

        const failed = yield* step(client.getJob({ id: chains[2].id }));
        assert.equal(failed?.status, "pending");
        assert.equal(failed?.consecutiveFailures, 1);
        assert.ok(failed?.lastAttemptError?.includes("bad item"));
      }),
    },
    {
      name: "reschedules every job of a batch when the batched handler throws",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: { attempt: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
              processors: {
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    if (jobs.some((job) => job.attempt === 1)) throw new Error("batch failed");
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs.map((job) => ({ job, output: { attempt: job.attempt } })),
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "task", input: null },
                { typeName: "task", input: null },
              ],
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChains({ chains, ...completionOptions }));
        assert.deepEqual(
          completed.map((chain) => chain.output),
          [{ attempt: 2 }, { attempt: 2 }],
        );
      }),
    },
    {
      name: "rejects only the calls naming a job completed elsewhere, and settles the other jobs of the batch in the same attempt",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { index: number }; output: { source: string } };
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
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes, fenceJobs }) => {
                    const taken = jobs.find((job) => job.input.index === 0)!;
                    const other = jobs.find((job) => job.input.index === 1)!;
                    await stateAdapter.withTransaction((txCtx) =>
                      client.applyJobOutcome({
                        ...txCtx,
                        job: { id: taken.id, typeName: "task" },
                        output: { source: "external" },
                      }),
                    );
                    await assertRejects(
                      () =>
                        stateAdapter.withTransaction((txCtx) =>
                          runInModeOf(
                            stateAdapter,
                            syncAsync(function* () {
                              yield* step(fenceJobs({ ...txCtx, jobs: [taken, other] }));
                            }),
                          ),
                        ),
                      (error: unknown) => {
                        assert.ok(error instanceof JobsAlreadyCompletedError);
                        assert.deepEqual(error.jobIds, [taken.id]);
                        return true;
                      },
                    );
                    assert.equal(taken.signal.aborted, true);
                    assert.equal(other.signal.aborted, false);
                    await assertRejects(
                      () =>
                        stateAdapter.withTransaction((txCtx) =>
                          applyJobOutcomes({
                            ...txCtx,
                            items: [
                              { job: taken, output: { source: "worker" } },
                              { job: other, output: { source: "worker" } },
                            ],
                          }),
                        ),
                      (error: unknown) => {
                        assert.ok(error instanceof JobsAlreadyCompletedError);
                        assert.deepEqual(error.jobIds, [taken.id]);
                        return true;
                      },
                    );
                    await stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          yield* step(fenceJobs({ ...txCtx, jobs: [other] }));
                          return yield* step(
                            applyJobOutcomes({
                              ...txCtx,
                              items: [{ job: other, output: { source: "worker" } }],
                            }),
                          );
                        }),
                      ),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [0, 1].map((index) => ({ typeName: "task" as const, input: { index } })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChains({ chains, ...completionOptions }));
        assert.deepEqual(
          completed.map((chain) => chain.output),
          [{ source: "external" }, { source: "worker" }],
        );

        const jobs = yield* step(client.getJobs({ ids: chains.map((chain) => chain.id) }));
        assert.deepEqual(
          jobs.map((job) => [job?.attempt, job?.consecutiveFailures]),
          [
            [1, 0],
            [1, 0],
          ],
        );
      }),
    },
    {
      name: "splits the due jobs of a type into full batches of its batch limit, the last one partial",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: { batchSize: number } };
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
                task: {
                  batchLimit: 3,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs.map((job) => ({ job, output: { batchSize: jobs.length } })),
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: Array.from({ length: 7 }, () => ({ typeName: "task" as const, input: null })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChains({ chains, ...completionOptions }));
        assert.deepEqual(
          completed.map((chain) => chain.output.batchSize).toSorted((a, b) => a - b),
          [1, 3, 3, 3, 3, 3, 3],
        );
      }),
    },
    {
      name: "batches each type with its own batch limit, never mixing types, next to a single-job type",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          pair: { entry: true; input: null; output: { batchTypeNames: string[] } };
          triple: { entry: true; input: null; output: { batchTypeNames: string[] } };
          single: { entry: true; input: null; output: { typeName: string } };
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
                pair: {
                  batchLimit: 2,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs.map((job) => ({
                          job,
                          output: { batchTypeNames: jobs.map(({ typeName }) => typeName) },
                        })),
                      }),
                    );
                  },
                },
                triple: {
                  batchLimit: 3,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs.map((job) => ({
                          job,
                          output: { batchTypeNames: jobs.map(({ typeName }) => typeName) },
                        })),
                      }),
                    );
                  },
                },
                single: {
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: { typeName: job.typeName } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                ...Array.from({ length: 4 }, () => ({ typeName: "pair" as const, input: null })),
                ...Array.from({ length: 3 }, () => ({ typeName: "triple" as const, input: null })),
                ...Array.from({ length: 2 }, () => ({ typeName: "single" as const, input: null })),
              ],
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChains({ chains, ...completionOptions }));
        assert.deepEqual(
          completed.map((chain) => chain.output),
          [
            ...Array.from({ length: 4 }, () => ({ batchTypeNames: ["pair", "pair"] })),
            ...Array.from({ length: 3 }, () => ({
              batchTypeNames: ["triple", "triple", "triple"],
            })),
            { typeName: "single" },
            { typeName: "single" },
          ],
        );
      }),
    },
    {
      name: "runs a batch in one worker runner slot",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const firstBatchJobIds = Promise.withResolvers<string[]>();
        const released = Promise.withResolvers<void>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  batchLimit: 2,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    firstBatchJobIds.resolve(jobs.map((job) => job.id));
                    await released.promise;
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs.map((job) => ({ job, output: null })),
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: Array.from({ length: 4 }, () => ({ typeName: "task" as const, input: null })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const runningJobIds = yield* wait(firstBatchJobIds.promise);
        assert.equal(runningJobIds.length, 2);
        yield* wait(sleep(200));
        const jobs = yield* step(client.getJobs({ ids: chains.map((chain) => chain.id) }));
        assert.deepEqual(
          jobs.map((job) => job?.status),
          chains.map((chain) => (runningJobIds.includes(chain.id) ? "running" : "pending")),
        );
        released.resolve();
        yield* wait(client.awaitChains({ chains, ...completionOptions }));
      }),
    },
    {
      name: "continues jobs of a batch with blockers and a schedule",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          blocker: { entry: true; input: { value: number }; output: { value: number } };
          task: {
            entry: true;
            input: { index: number };
            continueWith: { typeName: "step" };
          };
          step: {
            input: { index: number };
            output: { index: number; blockerValues: number[]; deferredMs: number };
            blockers: [{ typeName: "blocker" }];
          };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const blockerChain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "blocker", input: { value: 7 } }),
          ),
        );
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: { value: job.input.value } }),
                    );
                  },
                },
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          const results = yield* step(
                            applyJobOutcomes({
                              ...txCtx,
                              items: jobs.map((job) => ({
                                job,
                                continueWith: {
                                  typeName: "step" as const,
                                  input: { index: job.input.index },
                                  blockers: [blockerChain],
                                  schedule: job.input.index === 0 ? undefined : { afterMs: 200 },
                                },
                              })),
                            }),
                          );
                          assert.deepEqual(
                            results.map((result) => result.continuedTo.typeName),
                            ["step", "step"],
                          );
                          return results;
                        }),
                      ),
                    );
                  },
                },
                step: {
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({
                        ...txCtx,
                        output: {
                          index: job.input.index,
                          blockerValues: job.blockers.map((blocker) => blocker.output.value),
                          deferredMs: job.scheduledAt.getTime() - job.createdAt.getTime(),
                        },
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [0, 1].map((index) => ({ typeName: "task" as const, input: { index } })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChains({ chains, ...completionOptions }));
        assert.deepEqual(
          completed.map((chain) => ({
            index: chain.output.index,
            blockerValues: chain.output.blockerValues,
            deferred: chain.output.deferredMs >= 200,
          })),
          [
            { index: 0, blockerValues: [7], deferred: false },
            { index: 1, blockerValues: [7], deferred: true },
          ],
        );
      }),
    },
    {
      name: "fails a job of a batch with backoff that grows with each failure",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: { attempt: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              backoffConfig: { initialDelayMs: 1, multiplier: 1000, maxDelayMs: 1000 },
              processors: {
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs.map((job) =>
                          job.attempt < 3
                            ? { job, fail: new Error(`failure ${job.attempt}`) }
                            : { job, output: { attempt: job.attempt } },
                        ),
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(
          retryUntilPasses(
            async () => {
              const job = await client.getJob({ id: chain.id });
              assert.equal(job?.status, "pending");
              assert.equal(job.consecutiveFailures, 2);
              assert.ok(job.lastAttemptError?.includes("failure 2"));
              assert.ok(job.scheduledAt.getTime() >= job.lastAttemptAt!.getTime() + 1000);
            },
            { intervalMs: 20, timeoutMs: 5000 },
          ),
        );
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { attempt: 3 });
      }),
    },
    {
      name: "applies the outcomes in a new transaction after the transaction of the first call rolls back",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: { try: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    await assertRejects(
                      () =>
                        stateAdapter.withTransaction((txCtx) =>
                          runInModeOf(
                            stateAdapter,
                            syncAsync(function* () {
                              yield* step(
                                applyJobOutcomes({
                                  ...txCtx,
                                  items: jobs.map((job) => ({ job, output: { try: 1 } })),
                                }),
                              );
                              throw new Error("rollback");
                            }),
                          ),
                        ),
                      /rollback/,
                    );
                    assert.deepEqual(
                      jobs.map((job) => job.signal.aborted),
                      [false, false],
                    );
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs.map((job) => ({ job, output: { try: 2 } })),
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "task", input: null },
                { typeName: "task", input: null },
              ],
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChains({ chains, ...completionOptions }));
        assert.deepEqual(
          completed.map((chain) => chain.output),
          [{ try: 2 }, { try: 2 }],
        );
        const jobs = yield* step(client.getJobs({ ids: chains.map((chain) => chain.id) }));
        assert.deepEqual(
          jobs.map((job) => job?.attempt),
          [1, 1],
        );
      }),
    },
    {
      name: "fails the jobs of a batch the handler returns without settling, and keeps the settled ones",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { index: number }; output: { attempt: number } };
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
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs
                          .filter((job) => job.input.index === 0)
                          .map((job) => ({ job, output: { attempt: job.attempt } })),
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [0, 1].map((index) => ({ typeName: "task" as const, input: { index } })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(
          client.awaitChain({ chain: chains[0], ...completionOptions }),
        );
        assert.deepEqual(completed.output, { attempt: 1 });
        yield* wait(
          retryUntilPasses(
            async () => {
              const job = await client.getJob({ id: chains[1].id });
              assert.equal(job?.status, "pending");
              assert.equal(job.consecutiveFailures, 1);
              assert.ok(
                job.lastAttemptError?.includes(
                  "Attempt handler returned without a committed `applyJobOutcomes` call for the job",
                ),
              );
            },
            { intervalMs: 20, timeoutMs: 5000 },
          ),
        );
      }),
    },
    {
      name: "fails the jobs of a batch left unsettled with the error the handler throws, and keeps the settled ones",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { index: number }; output: { attempt: number } };
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
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs
                          .filter((job) => job.input.index === 0)
                          .map((job) => ({ job, output: { attempt: job.attempt } })),
                      }),
                    );
                    throw new Error("after settling one job");
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [0, 1].map((index) => ({ typeName: "task" as const, input: { index } })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(
          client.awaitChain({ chain: chains[0], ...completionOptions }),
        );
        assert.deepEqual(completed.output, { attempt: 1 });
        yield* wait(
          retryUntilPasses(
            async () => {
              const job = await client.getJob({ id: chains[1].id });
              assert.equal(job?.status, "pending");
              assert.equal(job.consecutiveFailures, 1);
              assert.ok(job.lastAttemptError?.includes("after settling one job"));
            },
            { intervalMs: 20, timeoutMs: 5000 },
          ),
        );
        yield* wait(workerRunner.close());
        assert.equal(logs.entriesOfType("worker_error").length, 0);
      }),
    },
    {
      name: "settles each job of a batch in its own transaction",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { index: number }; output: { index: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes, fenceJobs }) => {
                    for (const job of jobs) {
                      await stateAdapter.withTransaction((txCtx) =>
                        runInModeOf(
                          stateAdapter,
                          syncAsync(function* () {
                            yield* step(fenceJobs({ ...txCtx, jobs: [job] }));
                            const [settled] = yield* step(
                              applyJobOutcomes({
                                ...txCtx,
                                items: [{ job, output: { index: job.input.index } }],
                              }),
                            );
                            assert.equal(settled.id, job.id);
                            assert.equal(settled.status, "completed");
                          }),
                        ),
                      );
                    }
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [0, 1, 2].map((index) => ({ typeName: "task" as const, input: { index } })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChains({ chains, ...completionOptions }));
        assert.deepEqual(
          completed.map((chain) => chain.output),
          [{ index: 0 }, { index: 1 }, { index: 2 }],
        );
        const jobs = yield* step(client.getJobs({ ids: chains.map((chain) => chain.id) }));
        assert.deepEqual(
          jobs.map((job) => job?.attempt),
          [1, 1, 1],
        );
      }),
    },
    {
      name: "fails only the jobs of a batch whose transaction rolled back",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { index: number }; output: { index: number } };
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
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    for (const job of jobs) {
                      const settle = () =>
                        stateAdapter.withTransaction((txCtx) =>
                          runInModeOf(
                            stateAdapter,
                            syncAsync(function* () {
                              yield* step(
                                applyJobOutcomes({
                                  ...txCtx,
                                  items: [{ job, output: { index: job.input.index } }],
                                }),
                              );
                              if (job.input.index === 0) throw new Error("rollback");
                            }),
                          ),
                        );
                      if (job.input.index === 0) {
                        await assertRejects(settle, /rollback/);
                      } else {
                        await settle();
                      }
                    }
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [0, 1].map((index) => ({ typeName: "task" as const, input: { index } })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(
          client.awaitChain({ chain: chains[1], ...completionOptions }),
        );
        assert.deepEqual(completed.output, { index: 1 });
        yield* wait(
          retryUntilPasses(
            async () => {
              const job = await client.getJob({ id: chains[0].id });
              assert.equal(job?.status, "pending");
              assert.equal(job.consecutiveFailures, 1);
            },
            { intervalMs: 20, timeoutMs: 5000 },
          ),
        );
      }),
    },
    {
      name: "hands a job of a batch back for another attempt without a failure through a reschedule",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { index: number }; output: { attempt: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs.map((job) =>
                          job.input.index === 0 && job.attempt === 1
                            ? { job, reschedule: { afterMs: 0 }, reason: "handed back" }
                            : { job, output: { attempt: job.attempt } },
                        ),
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [0, 1].map((index) => ({ typeName: "task" as const, input: { index } })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChains({ chains, ...completionOptions }));
        assert.deepEqual(
          completed.map((chain) => chain.output),
          [{ attempt: 2 }, { attempt: 1 }],
        );
        const handedBack = yield* step(client.getJob({ id: chains[0].id }));
        assert.equal(handedBack?.consecutiveFailures, 0);
        assert.equal(handedBack?.lastAttemptError, null);
      }),
    },
    {
      name: "counts a fail outcome without an error value as a failed attempt",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
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
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs.map((job) => ({ job, fail: undefined })),
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(
          retryUntilPasses(
            async () => {
              const job = await client.getJob({ id: chain.id });
              assert.equal(job?.status, "pending");
              assert.equal(job.consecutiveFailures, 1);
            },
            { intervalMs: 20, timeoutMs: 5000 },
          ),
        );
        yield* wait(workerRunner.close());
        assert.equal(logs.entriesOfType("job_attempt_failed").length, 1);
        assert.equal(logs.entriesOfType("job_attempt_completed").length, 0);
      }),
    },
    {
      name: "keeps the committed outcomes of a batch when the handler throws afterwards",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: { attempt: number } };
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
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs.map((job) => ({ job, output: { attempt: job.attempt } })),
                      }),
                    );
                    throw new Error("after a committed applyJobOutcomes");
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "task", input: null },
                { typeName: "task", input: null },
              ],
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChains({ chains, ...completionOptions }));
        assert.deepEqual(
          completed.map((chain) => chain.output),
          [{ attempt: 1 }, { attempt: 1 }],
        );
        yield* wait(workerRunner.close());
        assert.equal(logs.entriesOfType("job_attempt_completed").length, 2);
        assert.equal(logs.entriesOfType("job_attempt_failed").length, 0);
      }),
    },
    {
      name: "throws error when applyJobOutcomes or fenceJobs is called incorrectly",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const applyJobOutcomesAfterHandler = Promise.withResolvers<() => unknown>();
        const fenceJobsAfterHandler = Promise.withResolvers<() => unknown>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes, fenceJobs }) => {
                    const [first, second] = jobs;
                    const outsider = { id: "00000000-0000-0000-0000-000000000000" };
                    await context.withNonTransactionContext(async (nonTransactionCtx) => {
                      await assertRejects(async () => {
                        await applyJobOutcomes({
                          ...nonTransactionCtx,
                          items: [{ job: first, output: null }],
                        });
                      }, /not in a transaction/);
                      await assertRejects(async () => {
                        await fenceJobs({ ...nonTransactionCtx, jobs: [first] });
                      }, /not in a transaction/);
                    });
                    await stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          yield* step(
                            assertRejects(
                              () =>
                                applyJobOutcomes({
                                  ...txCtx,
                                  items: [{ job: outsider, output: null }],
                                }),
                              /applyJobOutcomes accepts only the jobs of this attempt/,
                            ),
                          );
                          yield* step(
                            assertRejects(
                              () =>
                                applyJobOutcomes({
                                  ...txCtx,
                                  items: [
                                    { job: first, output: null },
                                    { job: first, output: null },
                                  ],
                                }),
                              /applyJobOutcomes requires each job at most once/,
                            ),
                          );
                          yield* step(
                            assertRejects(
                              () =>
                                applyJobOutcomes({
                                  ...txCtx,
                                  items: [{ job: first } as { job: typeof first; output: null }],
                                }),
                              /applyJobOutcomes requires exactly one of output, continueWith, reschedule or fail/,
                            ),
                          );
                          yield* step(
                            assertRejects(
                              () =>
                                applyJobOutcomes({
                                  ...txCtx,
                                  items: [
                                    {
                                      job: first,
                                      fail: new Error("bad item"),
                                      ...({ output: null } as object),
                                    },
                                  ],
                                }),
                              /applyJobOutcomes requires exactly one of output, continueWith, reschedule or fail/,
                            ),
                          );
                          yield* step(
                            assertRejects(
                              () =>
                                // @ts-expect-error the caller's transaction context is required
                                applyJobOutcomes({ items: [{ job: first, output: null }] }),
                              /applyJobOutcomes requires a transaction context from the caller's transaction/,
                            ),
                          );
                          yield* step(
                            assertRejects(
                              () => fenceJobs({ ...txCtx, jobs: [outsider] }),
                              /fenceJobs accepts only the jobs of this attempt/,
                            ),
                          );
                          yield* step(
                            assertRejects(
                              () => fenceJobs({ ...txCtx, jobs: [first, first] }),
                              /fenceJobs requires each job at most once/,
                            ),
                          );
                          yield* step(
                            assertRejects(
                              () => fenceJobs({ jobs: [first] }),
                              /fenceJobs requires a transaction context from the caller's transaction/,
                            ),
                          );
                          assert.deepEqual(
                            yield* step(applyJobOutcomes({ ...txCtx, items: [] })),
                            [],
                          );
                          yield* step(fenceJobs({ ...txCtx, jobs: [] }));
                          yield* step(
                            applyJobOutcomes({ ...txCtx, items: [{ job: first, output: null }] }),
                          );
                          yield* step(
                            assertRejects(
                              () =>
                                applyJobOutcomes({
                                  ...txCtx,
                                  items: [
                                    { job: second, output: null },
                                    { job: first, output: null },
                                  ],
                                }),
                              /an outcome was already applied for this attempt/,
                            ),
                          );
                          assert.deepEqual(
                            jobs.map((job) => job.signal.aborted),
                            [false, false],
                          );
                          yield* step(
                            applyJobOutcomes({ ...txCtx, items: [{ job: second, output: null }] }),
                          );
                        }),
                      ),
                    );
                    applyJobOutcomesAfterHandler.resolve(() =>
                      stateAdapter.withTransaction((txCtx) =>
                        applyJobOutcomes({ ...txCtx, items: [{ job: first, output: null }] }),
                      ),
                    );
                    fenceJobsAfterHandler.resolve(() =>
                      stateAdapter.withTransaction((txCtx) =>
                        runInModeOf(
                          stateAdapter,
                          syncAsync(function* () {
                            yield* step(fenceJobs({ ...txCtx, jobs }));
                          }),
                        ),
                      ),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "task", input: null },
                { typeName: "task", input: null },
              ],
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChains({ chains, ...completionOptions }));
        yield* wait(workerRunner.close());
        const jobs = yield* step(client.getJobs({ ids: chains.map((chain) => chain.id) }));
        assert.deepEqual(
          jobs.map((job) => [job?.attempt, job?.consecutiveFailures]),
          [
            [1, 0],
            [1, 0],
          ],
        );

        const callApplyJobOutcomes = yield* wait(applyJobOutcomesAfterHandler.promise);
        yield* step(
          assertRejects(
            () => callApplyJobOutcomes(),
            /applyJobOutcomes cannot be called after the attempt handler has ended/,
          ),
        );
        const callFenceJobs = yield* wait(fenceJobsAfterHandler.promise);
        yield* step(
          assertRejects(
            () => callFenceJobs(),
            /fenceJobs cannot be called after the attempt handler has ended/,
          ),
        );
      }),
    },
    {
      name: "rejects only the calls naming a job taken by another attempt, and settles the other jobs of the batch in the same attempt",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { index: number }; output: { attempt: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes, fenceJobs }) => {
                    const taken = jobs.find((job) => job.input.index === 0 && job.attempt === 1);
                    const others = jobs.filter((job) => job !== taken);
                    if (taken !== undefined) {
                      await stateAdapter.withTransaction((txCtx) =>
                        client.applyJobOutcome({
                          ...txCtx,
                          job: { id: taken.id, typeName: "task" },
                          reschedule: { afterMs: 0 },
                        }),
                      );
                      await assertRejects(
                        () =>
                          stateAdapter.withTransaction((txCtx) =>
                            runInModeOf(
                              stateAdapter,
                              syncAsync(function* () {
                                yield* step(fenceJobs({ ...txCtx, jobs }));
                              }),
                            ),
                          ),
                        (error: unknown) => {
                          assert.ok(error instanceof JobsTakenByAnotherWorkerError);
                          assert.deepEqual(error.jobIds, [taken.id]);
                          return true;
                        },
                      );
                      await assertRejects(
                        () =>
                          stateAdapter.withTransaction((txCtx) =>
                            applyJobOutcomes({
                              ...txCtx,
                              items: jobs.map((job) => ({ job, output: { attempt: job.attempt } })),
                            }),
                          ),
                        (error: unknown) => {
                          assert.ok(error instanceof JobsTakenByAnotherWorkerError);
                          assert.deepEqual(error.jobIds, [taken.id]);
                          return true;
                        },
                      );
                    }
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: others.map((job) => ({ job, output: { attempt: job.attempt } })),
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [0, 1].map((index) => ({ typeName: "task" as const, input: { index } })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChains({ chains, ...completionOptions }));
        assert.deepEqual(
          completed.map((chain) => chain.output),
          [{ attempt: 2 }, { attempt: 1 }],
        );
        const jobs = yield* step(client.getJobs({ ids: chains.map((chain) => chain.id) }));
        assert.deepEqual(
          jobs.map((job) => job?.consecutiveFailures),
          [0, 0],
        );
      }),
    },
    {
      name: "rejects only the calls naming a job whose chain was deleted or that another attempt took, reporting the deleted jobs first, and settles the other jobs of the batch in the same attempt",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { index: number }; output: { attempt: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes, fenceJobs }) => {
                    const deleted = jobs.find((job) => job.input.index === 0);
                    const taken = jobs.find((job) => job.input.index === 1 && job.attempt === 1);
                    if (deleted !== undefined && taken !== undefined) {
                      await stateAdapter.withTransaction((txCtx) =>
                        client.deleteChains({ ...txCtx, ids: [deleted.chainId] }),
                      );
                      await stateAdapter.withTransaction((txCtx) =>
                        client.applyJobOutcome({
                          ...txCtx,
                          job: { id: taken.id, typeName: "task" },
                          reschedule: { afterMs: 0 },
                        }),
                      );
                      await assertRejects(
                        () =>
                          stateAdapter.withTransaction((txCtx) =>
                            runInModeOf(
                              stateAdapter,
                              syncAsync(function* () {
                                yield* step(fenceJobs({ ...txCtx, jobs }));
                              }),
                            ),
                          ),
                        (error: unknown) => {
                          assert.ok(error instanceof JobsNotFoundError);
                          assert.deepEqual(error.jobIds, [deleted.id]);
                          return true;
                        },
                      );
                      await assertRejects(
                        () =>
                          stateAdapter.withTransaction((txCtx) =>
                            applyJobOutcomes({
                              ...txCtx,
                              items: jobs.map((job) => ({ job, output: { attempt: job.attempt } })),
                            }),
                          ),
                        (error: unknown) => {
                          assert.ok(error instanceof JobsNotFoundError);
                          assert.deepEqual(error.jobIds, [deleted.id]);
                          return true;
                        },
                      );
                      await assertRejects(
                        () =>
                          stateAdapter.withTransaction((txCtx) =>
                            applyJobOutcomes({
                              ...txCtx,
                              items: jobs
                                .filter((job) => job !== deleted)
                                .map((job) => ({ job, output: { attempt: job.attempt } })),
                            }),
                          ),
                        (error: unknown) => {
                          assert.ok(error instanceof JobsTakenByAnotherWorkerError);
                          assert.deepEqual(error.jobIds, [taken.id]);
                          return true;
                        },
                      );
                    }
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs
                          .filter((job) => job !== deleted && job !== taken)
                          .map((job) => ({ job, output: { attempt: job.attempt } })),
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [0, 1, 2].map((index) => ({ typeName: "task" as const, input: { index } })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(
          client.awaitChains({ chains: chains.slice(1), ...completionOptions }),
        );
        assert.deepEqual(
          completed.map((chain) => chain.output),
          [{ attempt: 2 }, { attempt: 1 }],
        );
        assert.equal(yield* step(client.getChain({ id: chains[0].id })), undefined);
      }),
    },
    {
      name: "gives each job of a batch its own blocker chains with one lookup for the batch",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          blocker: { entry: true; input: null; output: { value: number } };
          task: {
            entry: true;
            input: null;
            output: { blockerValues: number[] };
            blockers: [{ typeName: "blocker" }];
          };
        }>();
        const spyStateAdapter = createSpyStateAdapter(stateAdapter);
        const client = createClient({ stateAdapter: spyStateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async () => {},
                },
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs.map((job) => ({
                          job,
                          output: {
                            blockerValues: job.blockers.map((blocker) => blocker.output.value),
                          },
                        })),
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const blockerChains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "blocker", input: null },
                { typeName: "blocker", input: null },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcomes({
              ...txCtx,
              items: blockerChains.map((blockerChain, index) => ({
                job: { id: blockerChain.id, typeName: "blocker" as const },
                output: { value: index + 1 },
              })),
            }),
          ),
        );
        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: blockerChains.map((blockerChain) => ({
                typeName: "task" as const,
                input: null,
                blockers: [blockerChain],
              })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChains({ chains, ...completionOptions }));
        assert.deepEqual(
          completed.map((chain) => chain.output),
          [{ blockerValues: [1] }, { blockerValues: [2] }],
        );
        assert.equal(
          spyStateAdapter.calls.filter((call) => call.name === "getJobsBlockers").length,
          1,
        );
      }),
    },
    {
      name: "skips the blocker lookup for a batch whose jobs have no blockers",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();
        const spyStateAdapter = createSpyStateAdapter(stateAdapter);
        const client = createClient({ stateAdapter: spyStateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: jobs.map((job) => ({ job, output: null })),
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "task", input: null },
                { typeName: "task", input: null },
              ],
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChains({ chains, ...completionOptions }));
        assert.ok(!spyStateAdapter.calls.some((call) => call.name === "getJobsBlockers"));
      }),
    },
    {
      name: "gives a handler with a batch limit typed as number and 1 at runtime a single job",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: { shape: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const batchLimit: number = 1;
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  batchLimit,
                  attemptHandler: async (options) => {
                    await (options.jobs
                      ? stateAdapter.withTransaction((txCtx) =>
                          options.applyJobOutcomes({
                            ...txCtx,
                            items: options.jobs.map((job) => ({ job, output: { shape: "batch" } })),
                          }),
                        )
                      : stateAdapter.withTransaction((txCtx) =>
                          options.applyJobOutcome({ ...txCtx, output: { shape: "single" } }),
                        ));
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { shape: "single" });
      }),
    },
  ],
};

export const processAsyncGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "process",
  cases: [
    {
      name: "rejects a second `applyJobOutcome` of the attempt in the same transaction without losing the attempt",
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
                attemptHandler: async ({ job, applyJobOutcome }) => {
                  await stateAdapter.withTransaction((txCtx) =>
                    runInModeOf(
                      stateAdapter,
                      syncAsync(function* () {
                        const completed = applyJobOutcome({ ...txCtx, output: null });
                        yield* step(
                          assertRejects(
                            () => applyJobOutcome({ ...txCtx, output: null }),
                            /an outcome is already being applied for this attempt/,
                          ),
                        );
                        assert.partialDeepStrictEqual(yield* step(completed), {
                          status: "completed",
                        });
                        yield* step(
                          assertRejects(
                            () => applyJobOutcome({ ...txCtx, output: null }),
                            /an outcome was already applied for this attempt/,
                          ),
                        );
                        assert.equal(job.signal.aborted, false);
                      }),
                    ),
                  );
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
        await workerRunner.close();

        assert.ok(!spyStateAdapter.calls.map((call) => call.name).includes("rescheduleJobs"));
      },
    },
    {
      name: "keeps the attempt alive when an extension lands after its own committed `applyJobOutcome` call",
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
                attemptHandler: async ({ job, applyJobOutcome }) => {
                  await stateAdapter.withTransaction((txCtx) =>
                    runInModeOf(
                      stateAdapter,
                      syncAsync(function* () {
                        const finished = yield* step(applyJobOutcome({ ...txCtx, output: null }));
                        yield* step(sleep(60));
                        return finished;
                      }),
                    ),
                  );
                  await sleep(100);
                  aborted = job.signal.aborted;
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
      name: "holds a workerless takeover until the fenced transaction ends, then fails fenceJob and aborts job.signal",
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
                attemptHandler: async ({ job, fenceJob, applyJobOutcome }) => {
                  const { takeover } = await stateAdapter.withTransaction((txCtx) =>
                    runInModeOf(
                      stateAdapter,
                      syncAsync(function* () {
                        yield* step(fenceJob({ ...txCtx }));
                        yield* step(fenceJob({ ...txCtx }));
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
                    () => stateAdapter.withTransaction((txCtx) => fenceJob({ ...txCtx })),
                    JobAlreadyCompletedError,
                  );
                  assert.equal(job.signal.aborted, true);
                  await assertRejects(
                    () =>
                      stateAdapter.withTransaction((txCtx) =>
                        applyJobOutcome({ ...txCtx, output: { by: "worker" } }),
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
    {
      name: "rejects a concurrent `applyJobOutcomes` naming a job being settled without losing the attempt",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
        await using notifyAdapter = await createCaseNotifyAdapter(
          createNotifyAdapter,
          stateAdapter,
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        await using workerRunner = createWorkerRunner({
          client,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              task: {
                batchLimit: 5,
                attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                  await stateAdapter.withTransaction(async (txCtx) => {
                    const completed = applyJobOutcomes({
                      ...txCtx,
                      items: jobs.map((job) => ({ job, output: null })),
                    });
                    await assertRejects(
                      async () =>
                        applyJobOutcomes({ ...txCtx, items: [{ job: jobs[1], output: null }] }),
                      /an outcome is already being applied for this attempt/,
                    );
                    assert.deepEqual(
                      jobs.map((job) => job.signal.aborted),
                      [false, false],
                    );
                    await completed;
                  });
                },
              },
            },
          }),
        });

        const chains = await stateAdapter.withTransaction((txCtx) =>
          client.createChains({
            ...txCtx,
            items: [
              { typeName: "task", input: null },
              { typeName: "task", input: null },
            ],
          }),
        );

        await workerRunner.start();
        await client.awaitChains({ chains, ...completionOptions });
        const jobs = await client.getJobs({ ids: chains.map((chain) => chain.id) });
        assert.deepEqual(
          jobs.map((job) => job?.attempt),
          [1, 1],
        );
      },
    },
    {
      name: "aborts the signal of every job of a batch when the worker runner stops",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
        await using notifyAdapter = await createCaseNotifyAdapter(
          createNotifyAdapter,
          stateAdapter,
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const started = Promise.withResolvers<AbortSignal[]>();
        await using workerRunner = createWorkerRunner({
          client,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              task: {
                batchLimit: 5,
                attemptHandler: async ({ jobs }) => {
                  started.resolve(jobs.map((job) => job.signal));
                  await Promise.all(
                    jobs.map(
                      (job) =>
                        new Promise((resolve) => {
                          job.signal.addEventListener("abort", resolve, { once: true });
                        }),
                    ),
                  );
                },
              },
            },
          }),
        });

        await stateAdapter.withTransaction((txCtx) =>
          client.createChains({
            ...txCtx,
            items: [
              { typeName: "task", input: null },
              { typeName: "task", input: null },
            ],
          }),
        );

        await workerRunner.start();
        const signals = await started.promise;
        assert.deepEqual(
          signals.map((signal) => signal.aborted),
          [false, false],
        );
        await workerRunner.close();
        assert.deepEqual(
          signals.map((signal) => signal.aborted),
          [true, true],
        );
      },
    },
  ],
};

export const processNotifyGroup: ConformanceGroup<EndToEndNotifyContext> = {
  name: "process",
  cases: [
    {
      name: "aborts the signal when the attempt is lost after its `applyJobOutcome` call rolled back",
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
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    await assertRejects(
                      () =>
                        stateAdapter.withTransaction((txCtx) =>
                          runInModeOf(
                            stateAdapter,
                            syncAsync(function* () {
                              yield* step(applyJobOutcome({ ...txCtx, output: { by: "worker" } }));
                              throw new Error("rollback");
                            }),
                          ),
                        ),
                      /rollback/,
                    );
                    rolledBack.resolve(job.signal);
                    await sleep(completionOptions.timeoutMs, { signal: job.signal });
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
          notifyAdapter: {
            ...notifyAdapter,
            listenJobAttemptsLost: async (jobIds, onNotification) => {
              const dispose = await notifyAdapter.listenJobAttemptsLost(jobIds, onNotification);
              return async () => {
                await dispose();
                throw new Error("dispose failed");
              };
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
              backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
              processors: {
                test: {
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    if (job.attempt === 1) throw new Error("first attempt fails");
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
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
    {
      name: "aborts only the signal of the job of a batch whose chain is deleted, and settles the other jobs",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { index: number }; output: { attempt: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const started = Promise.withResolvers<void>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    const deleted = jobs.find((job) => job.input.index === 0)!;
                    const other = jobs.find((job) => job.input.index === 1)!;
                    started.resolve();
                    await sleep(completionOptions.timeoutMs, { signal: deleted.signal });
                    assert.equal(deleted.signal.aborted, true);
                    assert.equal(other.signal.aborted, false);
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: [{ job: other, output: { attempt: other.attempt } }],
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [0, 1].map((index) => ({ typeName: "task" as const, input: { index } })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(started.promise);
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.deleteChains({ ...txCtx, ids: [chains[0].id] }),
          ),
        );
        const completed = yield* wait(
          client.awaitChain({ chain: chains[1], ...completionOptions }),
        );
        assert.deepEqual(completed.output, { attempt: 1 });
      }),
    },
    {
      name: "aborts only the signal of the job of a batch completed elsewhere, and settles the other jobs",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { index: number }; output: { source: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const started = Promise.withResolvers<void>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  batchLimit: 5,
                  attemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    const external = jobs.find((job) => job.input.index === 0)!;
                    const other = jobs.find((job) => job.input.index === 1)!;
                    started.resolve();
                    await sleep(completionOptions.timeoutMs, { signal: external.signal });
                    assert.equal(external.signal.aborted, true);
                    assert.equal(other.signal.aborted, false);
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcomes({
                        ...txCtx,
                        items: [{ job: other, output: { source: "worker" } }],
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [0, 1].map((index) => ({ typeName: "task" as const, input: { index } })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(started.promise);
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chains[0].id, typeName: "task" },
              output: { source: "external" },
            }),
          ),
        );
        const completed = yield* wait(client.awaitChains({ chains, ...completionOptions }));
        assert.deepEqual(
          completed.map((chain) => chain.output),
          [{ source: "external" }, { source: "worker" }],
        );
        const jobs = yield* step(client.getJobs({ ids: chains.map((chain) => chain.id) }));
        assert.deepEqual(
          jobs.map((job) => [job?.attempt, job?.consecutiveFailures]),
          [
            [1, 0],
            [1, 0],
          ],
        );
      }),
    },
  ],
};

export const processSavepointGroup: ConformanceGroup<EndToEndSavepointContext> = {
  name: "process",
  cases: [
    {
      name: "reschedules the attempt when applyJobOutcome rolls back in a savepoint",
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
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          let receipt: Awaited<ReturnType<typeof applyJobOutcome>> | undefined;
                          try {
                            yield* step(
                              context.withSavepoint(txCtx, (txCtx) =>
                                runInModeOf(
                                  stateAdapter,
                                  syncAsync(function* () {
                                    receipt = yield* step(
                                      applyJobOutcome({ ...txCtx, output: null }),
                                    );
                                    throw new Error("rollback to savepoint");
                                  }),
                                ),
                              ),
                            );
                          } catch {}
                          return receipt!;
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
            "Attempt handler returned without a committed `applyJobOutcome` call",
          ),
        );
        assert.equal(logs.entriesOfType("job_completed").length, 0);
      }),
    },
    {
      name: "commits the `applyJobOutcome` call made after one rolled back in a savepoint",
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
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          yield* step(
                            assertRejects(
                              () =>
                                applyJobOutcome({
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
                                      applyJobOutcome({ ...txCtx, output: { from: "savepoint" } }),
                                    );
                                    throw new Error("rollback to savepoint");
                                  }),
                                ),
                              ),
                            );
                          } catch {}
                          return applyJobOutcome({ ...txCtx, output: { from: "transaction" } });
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
