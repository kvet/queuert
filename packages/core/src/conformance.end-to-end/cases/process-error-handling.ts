import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { dynamicSyncAsync, syncAsync, resource, step, wait } from "@queuert/sync-async";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { runInModeOf } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker/worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createCaseStateAdapter } from "../support/create-case-state-adapter.ts";
import type { EndToEndPoisonTransactionContext } from "../types.ts";

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};
const fastBackoff = { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 };

export const processErrorHandlingGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "process-error-handling",
  cases: [
    {
      name: "reschedules when handler throws before opening its transaction",
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
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  backoffConfig: fastBackoff,
                  attemptHandler: async ({ job, applyOutcome }) => {
                    if (job.attempt === 1) {
                      throw new Error("Simulated handler error");
                    }
                    assert.ok(typeof job?.lastAttemptError === "string");
                    assert.ok(job.lastAttemptError.includes("Error: Simulated handler error"));
                    return stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({ ...txCtx, output: { result: job.input.value * 2 } }),
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
              input: { value: 10 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { result: 20 });

        assert.equal((yield* step(client.getJob({ id: chain.id })))?.attempt, 2);
      }),
    },
    {
      name: "reschedules when handler throws inside its transaction before applyOutcome",
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
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  backoffConfig: fastBackoff,
                  attemptHandler: async ({ job, applyOutcome }) => {
                    if (job.attempt > 1) {
                      assert.ok(typeof job?.lastAttemptError === "string");
                      assert.ok(job.lastAttemptError.includes("Error: Simulated handler error"));
                    }
                    return stateAdapter.withTransaction((txCtx) => {
                      if (job.attempt === 1) {
                        throw new Error("Simulated handler error");
                      }
                      return applyOutcome({
                        ...txCtx,
                        output: { result: job.input.value * 2 },
                      });
                    });
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
              input: { value: 10 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { result: 20 });

        assert.equal((yield* step(client.getJob({ id: chain.id })))?.attempt, 2);
      }),
    },
    {
      name: "reschedules when handler throws inside its transaction after applyOutcome",
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
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  backoffConfig: fastBackoff,
                  attemptHandler: async ({ job, applyOutcome }) => {
                    if (job.attempt > 1) {
                      assert.ok(typeof job?.lastAttemptError === "string");
                      assert.ok(job.lastAttemptError.includes("Error: Error after applyOutcome"));
                    }
                    return stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          const result = yield* step(
                            applyOutcome({
                              ...txCtx,
                              output: { result: job.input.value * 2 },
                            }),
                          );
                          if (job.attempt === 1) {
                            throw new Error("Error after applyOutcome");
                          }
                          return result;
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
              input: { value: 10 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { result: 20 });

        assert.equal((yield* step(client.getJob({ id: chain.id })))?.attempt, 2);
      }),
    },
    {
      name: "reschedules when handler returns without calling applyOutcome",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
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
              backoffConfig: fastBackoff,
              processors: {
                test: {
                  // @ts-expect-error the handler must return what applyOutcome returned
                  attemptHandler: async ({ job, applyOutcome }) => {
                    if (job.attempt === 1) {
                      return;
                    }
                    assert.ok(typeof job?.lastAttemptError === "string");
                    assert.ok(
                      job.lastAttemptError.includes(
                        "Attempt handler returned without a committed `applyOutcome` call",
                      ),
                    );
                    return stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({ ...txCtx, output: { done: true } }),
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
      name: "rolls back the continuation when handler throws after applyOutcome with continueWith inside its transaction",
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
            input: { value: number };
            output: { result: number };
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
                step1: {
                  backoffConfig: fastBackoff,
                  attemptHandler: async ({ job, applyOutcome }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          const result = yield* step(
                            applyOutcome({
                              ...txCtx,
                              continueWith: {
                                typeName: "step2",
                                input: { value: job.input.value * 2 },
                              },
                            }),
                          );
                          if (job.attempt === 1) {
                            throw new Error("Error after applyOutcome with continueWith");
                          }
                          return result;
                        }),
                      ),
                    ),
                },
                step2: {
                  attemptHandler: async ({ job, applyOutcome }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({ ...txCtx, output: { result: job.input.value } }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "step1",
              input: { value: 10 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { result: 20 });

        assert.equal((yield* step(client.getJob({ id: chain.id })))?.attempt, 2);
        const jobs = yield* step(client.listChainJobs({ chainId: chain.id }));
        assert.deepEqual(
          jobs.items.map((job) => job.typeName),
          ["step1", "step2"],
        );
      }),
    },
    {
      name: "keeps the dependent blocked when the blocker handler throws after applyOutcome inside its transaction",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: { value: number };
            output: { done: true };
          };
          dependent: {
            entry: true;
            input: null;
            output: { result: string };
            blockers: [{ typeName: "blocker" }];
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
                blocker: {
                  backoffConfig: fastBackoff,
                  attemptHandler: async ({ job, applyOutcome }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          const result = yield* step(
                            applyOutcome({
                              ...txCtx,
                              output: { done: true },
                            }),
                          );
                          if (job.attempt === 1) {
                            throw new Error("Error after blocker applyOutcome");
                          }
                          return result;
                        }),
                      ),
                    ),
                },
                dependent: {
                  attemptHandler: async ({ job, applyOutcome }) => {
                    const [blocker] = job.blockers;
                    assert.equal((await client.getJob({ id: blocker.id }))?.attempt, 2);
                    return stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({ ...txCtx, output: { result: "ok" } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const blockerChain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "blocker",
              input: { value: 1 },
            }),
          ),
        );
        const dependentChain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "dependent",
              input: null,
              blockers: [blockerChain],
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(
          client.awaitChain({ chain: dependentChain, ...completionOptions }),
        );
        assert.deepEqual(completed.output, { result: "ok" });
      }),
    },
    {
      name: "serializes various error types as the last reschedule error",
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
              processors: {
                test: {
                  backoffConfig: fastBackoff,
                  attemptHandler: async ({ job, applyOutcome }) => {
                    switch (job.attempt) {
                      case 1:
                        throw new Error("plain error");
                      case 2:
                        assert.ok(typeof job?.lastAttemptError === "string");
                        assert.ok(job.lastAttemptError.includes("plain error"));
                        assert.match(job.lastAttemptError, /at\s/);
                        // oxlint-disable-next-line typescript/only-throw-error -- test intentionally throws non-Error values
                        throw { code: "ETIMEOUT", detail: "connection lost" };
                      case 3:
                        assert.ok(typeof job?.lastAttemptError === "string");
                        assert.ok(job.lastAttemptError.includes("ETIMEOUT"));
                        assert.ok(job.lastAttemptError.includes("connection lost"));
                        // oxlint-disable-next-line typescript/only-throw-error -- test intentionally throws non-Error values
                        throw "string error";
                      case 4:
                        assert.equal(job.lastAttemptError, "string error");
                        return stateAdapter.withTransaction((txCtx) =>
                          applyOutcome({ ...txCtx, output: null }),
                        );
                      default:
                        throw new Error(`unexpected attempt ${job.attempt}`);
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
              input: null,
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain({ chain, ...completionOptions }));
      }),
    },
    {
      name: "completes when handler catches an error from its own transaction and then finishes",
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
              processors: {
                test: {
                  backoffConfig: fastBackoff,
                  attemptHandler: async ({ job, applyOutcome }) => {
                    assert.equal(job.attempt, 1);
                    await assertRejects(
                      () =>
                        stateAdapter.withTransaction(() => {
                          throw new Error("transaction boom");
                        }),
                      /transaction boom/,
                    );
                    return stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({ ...txCtx, output: null }),
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
      }),
    },
    {
      name: "reschedules with fractional backoff delays",
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
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  backoffConfig: { initialDelayMs: 1.5, multiplier: 1.5, maxDelayMs: 10 },
                  attemptHandler: async ({ job, applyOutcome }) => {
                    if (job.attempt < 3) {
                      throw new Error(`Simulated error on attempt ${job.attempt}`);
                    }
                    return stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({ ...txCtx, output: { result: job.input.value * 2 } }),
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
              input: { value: 10 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { result: 20 });
      }),
    },
  ],
};

export const processErrorHandlingPoisonTransactionGroup: ConformanceGroup<EndToEndPoisonTransactionContext> =
  {
    name: "process-error-handling",
    cases: [
      {
        name: "recovers when user code poisons its transaction before applyOutcome",
        run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
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
          const workerRunner = yield* resource(
            createWorkerRunner({
              client,
              concurrency: 1,
              processors: createProcessors({
                client,
                jobTypes,
                processors: {
                  test: {
                    backoffConfig: fastBackoff,
                    attemptHandler: async ({ job, applyOutcome }) =>
                      stateAdapter.withTransaction((txCtx) =>
                        runInModeOf(
                          stateAdapter,
                          syncAsync(function* () {
                            if (job.attempt === 1) {
                              yield* step(context.poisonTransaction(txCtx));
                            }
                            return applyOutcome({
                              ...txCtx,
                              output: { result: job.input.value * 2 },
                            });
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
              client.createChain({
                ...txCtx,
                typeName: "test",
                input: { value: 10 },
              }),
            ),
          );

          yield* wait(workerRunner.start());
          const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
          assert.deepEqual(completed.output, { result: 20 });

          assert.equal((yield* step(client.getJob({ id: chain.id })))?.attempt, 2);
        }),
      },
      {
        name: "recovers when user code poisons a separate transaction before applyOutcome",
        run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
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
          const workerRunner = yield* resource(
            createWorkerRunner({
              client,
              concurrency: 1,
              processors: createProcessors({
                client,
                jobTypes,
                processors: {
                  test: {
                    backoffConfig: fastBackoff,
                    attemptHandler: async ({ job, applyOutcome }) => {
                      if (job.attempt === 1) {
                        await stateAdapter.withTransaction((txCtx) =>
                          runInModeOf(
                            stateAdapter,
                            syncAsync(function* () {
                              yield* step(context.poisonTransaction(txCtx));
                            }),
                          ),
                        );
                      }
                      return stateAdapter.withTransaction((txCtx) =>
                        applyOutcome({ ...txCtx, output: { result: job.input.value * 2 } }),
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
                input: { value: 10 },
              }),
            ),
          );

          yield* wait(workerRunner.start());
          const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
          assert.deepEqual(completed.output, { result: 20 });
        }),
      },
    ],
  };
