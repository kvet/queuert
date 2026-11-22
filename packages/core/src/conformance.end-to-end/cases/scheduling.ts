import assert from "node:assert/strict";

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

export const schedulingGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "scheduling",
  cases: [
    {
      name: "createChain with schedule.afterMs defers job processing",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 50,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                    ),
                },
              },
            }),
          }),
        );

        const deadline = Date.now() + 300;
        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 1 },
              schedule: { afterMs: 300 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const remainingMs = deadline - Date.now() - 100;
        if (remainingMs > 0) {
          yield* wait(assert.rejects(client.awaitChain({ chain, timeoutMs: remainingMs })));
        }
        assert.notEqual(
          yield* wait(client.awaitChain({ chain, pollIntervalMs: 100, timeoutMs: 5000 })),
          undefined,
        );
      }),
    },
    {
      name: "createChain with schedule.at defers job processing",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 50,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                    ),
                },
              },
            }),
          }),
        );

        const deadline = Date.now() + 300;
        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 1 },
              schedule: { at: new Date(deadline) },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const remainingMs = deadline - Date.now() - 100;
        if (remainingMs > 0) {
          yield* wait(assert.rejects(client.awaitChain({ chain, timeoutMs: remainingMs })));
        }
        assert.notEqual(
          yield* wait(client.awaitChain({ chain, pollIntervalMs: 100, timeoutMs: 5000 })),
          undefined,
        );
      }),
    },
    {
      name: "continueWith with schedule.afterMs defers continuation job",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          first: { entry: true; input: { value: number }; continueWith: { typeName: "second" } };
          second: { input: { continued: boolean }; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const firstCompleted = Promise.withResolvers<number>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 50,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                first: {
                  attemptHandler: async ({ complete }) => {
                    const continuationDeadline = Date.now() + 300;
                    try {
                      return await stateAdapter.withTransaction((txCtx) =>
                        complete({
                          ...txCtx,
                          continueWith: {
                            typeName: "second",
                            input: { continued: true },
                            schedule: { afterMs: 300 },
                          },
                        }),
                      );
                    } finally {
                      firstCompleted.resolve(continuationDeadline);
                    }
                  },
                },
                second: {
                  attemptHandler: async ({ complete }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: { result: "done" } }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "first", input: { value: 1 } }),
          ),
        );

        yield* wait(workerRunner.start());
        const deadline = yield* wait(firstCompleted.promise);
        const remainingMs = deadline - Date.now() - 100;
        if (remainingMs > 0) {
          yield* wait(assert.rejects(client.awaitChain({ chain, timeoutMs: remainingMs })));
        }
        assert.notEqual(
          yield* wait(client.awaitChain({ chain, pollIntervalMs: 100, timeoutMs: 5000 })),
          undefined,
        );
      }),
    },
    {
      name: "continueWith with schedule.at defers continuation job",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          first: { entry: true; input: { value: number }; continueWith: { typeName: "second" } };
          second: { input: { continued: boolean }; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const firstCompleted = Promise.withResolvers<number>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 50,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                first: {
                  attemptHandler: async ({ complete }) => {
                    const continuationDeadline = Date.now() + 300;
                    try {
                      return await stateAdapter.withTransaction((txCtx) =>
                        complete({
                          ...txCtx,
                          continueWith: {
                            typeName: "second",
                            input: { continued: true },
                            schedule: { at: new Date(continuationDeadline) },
                          },
                        }),
                      );
                    } finally {
                      firstCompleted.resolve(continuationDeadline);
                    }
                  },
                },
                second: {
                  attemptHandler: async ({ complete }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: { result: "done" } }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "first", input: { value: 1 } }),
          ),
        );

        yield* wait(workerRunner.start());
        const deadline = yield* wait(firstCompleted.promise);
        const remainingMs = deadline - Date.now() - 100;
        if (remainingMs > 0) {
          yield* wait(assert.rejects(client.awaitChain({ chain, timeoutMs: remainingMs })));
        }
        assert.notEqual(
          yield* wait(client.awaitChain({ chain, pollIntervalMs: 100, timeoutMs: 5000 })),
          undefined,
        );
      }),
    },
    {
      name: "rescheduling with afterMs defers the next attempt by the given delay",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        let attemptCount = 0;
        const firstAttemptDone = Promise.withResolvers<number>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 50,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    attemptCount++;
                    if (attemptCount > 1) {
                      assert.equal(job.lastAttemptError, null);
                      assert.equal(job.lastRescheduleReason, null);
                    }
                    if (attemptCount === 1) {
                      firstAttemptDone.resolve(Date.now() + 300);
                      return stateAdapter.withTransaction((txCtx) =>
                        complete({ ...txCtx, reschedule: { afterMs: 300 } }),
                      );
                    }
                    return stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: { value: 1 } }),
          ),
        );

        yield* wait(workerRunner.start());
        const deadline = yield* wait(firstAttemptDone.promise);
        const remainingMs = deadline - Date.now() - 100;
        if (remainingMs > 0) {
          yield* wait(assert.rejects(client.awaitChain({ chain, timeoutMs: remainingMs })));
        }
        assert.notEqual(
          yield* wait(client.awaitChain({ chain, pollIntervalMs: 100, timeoutMs: 5000 })),
          undefined,
        );
        assert.equal(attemptCount, 2);
      }),
    },
    {
      name: "a reschedule reason reaches the next attempt and restarts failure backoff",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const seen: {
          consecutiveFailures: number;
          lastAttemptError: string | null;
          lastRescheduleReason: string | null;
          delayMs: number;
        }[] = [];
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 20,
            backoffConfig: { initialDelayMs: 10, multiplier: 10, maxDelayMs: 60_000 },
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    seen.push({
                      consecutiveFailures: job.consecutiveFailures,
                      lastAttemptError: job.lastAttemptError,
                      lastRescheduleReason: job.lastRescheduleReason,
                      delayMs:
                        job.lastAttemptAt === null
                          ? 0
                          : job.scheduledAt.getTime() - job.lastAttemptAt.getTime(),
                    });
                    switch (seen.length) {
                      case 3:
                        return stateAdapter.withTransaction((txCtx) =>
                          complete({ ...txCtx, reschedule: { afterMs: 0 }, reason: "waiting" }),
                        );
                      case 5:
                        return stateAdapter.withTransaction((txCtx) =>
                          complete({ ...txCtx, output: null }),
                        );
                      default:
                        throw new Error(`failure ${seen.length}`);
                    }
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
        assert.notEqual(
          yield* wait(client.awaitChain({ chain, pollIntervalMs: 50, timeoutMs: 3_000 })),
          undefined,
        );
        assert.deepEqual(
          seen.map(({ consecutiveFailures }) => consecutiveFailures),
          [0, 1, 2, 0, 1],
        );
        assert.ok(seen[2].lastAttemptError?.includes("failure 2"));
        assert.equal(seen[2].lastRescheduleReason, null);
        assert.equal(seen[3].lastAttemptError, null);
        assert.equal(seen[3].lastRescheduleReason, "waiting");
        assert.ok(seen[4].lastAttemptError?.includes("failure 4"));
        assert.equal(seen[4].lastRescheduleReason, null);
        assert.ok(seen[4].delayMs < 1_000);
      }),
    },
    {
      name: "recurring job self-schedules after complete without matching its own chain",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          recurring: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        let completionCount = 0;
        const allDone = Promise.withResolvers<void>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 50,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                recurring: {
                  attemptHandler: async ({ complete }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          completionCount++;
                          const completedJob = yield* step(complete({ ...txCtx, output: null }));
                          if (completionCount < 3) {
                            const next = yield* step(
                              client.createChain({
                                ...txCtx,
                                typeName: "recurring",
                                input: null,
                                deduplication: { key: "recurring", scope: "running" },
                              }),
                            );
                            assert.equal(next.deduplicated, false);
                          } else {
                            allDone.resolve();
                          }
                          return completedJob;
                        }),
                      ),
                    ),
                },
              },
            }),
          }),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "recurring",
              input: null,
              deduplication: { key: "recurring", scope: "running" },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(allDone.promise);
        const { items: chains } = yield* step(
          client.listChains({ typeName: "recurring", limit: 10 }),
        );
        assert.equal(chains.length, 3);
        assert.equal(completionCount, 3);
      }),
    },
    {
      name: "rescheduling with schedule.at defers the next attempt to the given time",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        let attemptCount = 0;
        const firstAttemptDone = Promise.withResolvers<number>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 50,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    attemptCount++;
                    if (attemptCount > 1) {
                      assert.equal(job.lastAttemptError, null);
                      assert.equal(job.lastRescheduleReason, null);
                    }
                    if (attemptCount === 1) {
                      const rescheduleDeadline = Date.now() + 300;
                      firstAttemptDone.resolve(rescheduleDeadline);
                      return stateAdapter.withTransaction((txCtx) =>
                        complete({
                          ...txCtx,
                          reschedule: { at: new Date(rescheduleDeadline) },
                        }),
                      );
                    }
                    return stateAdapter.withTransaction((txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: { value: 1 } }),
          ),
        );

        yield* wait(workerRunner.start());
        const deadline = yield* wait(firstAttemptDone.promise);
        const remainingMs = deadline - Date.now() - 100;
        if (remainingMs > 0) {
          yield* wait(assert.rejects(client.awaitChain({ chain, timeoutMs: remainingMs })));
        }
        assert.notEqual(
          yield* wait(client.awaitChain({ chain, pollIntervalMs: 100, timeoutMs: 5000 })),
          undefined,
        );
        assert.equal(attemptCount, 2);
      }),
    },
    {
      name: "createChain with past schedule.at clamps scheduledAt to now",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
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
                  attemptHandler: async ({ complete }) =>
                    stateAdapter.withTransaction((txCtx) => complete({ ...txCtx, output: null })),
                },
              },
            }),
          }),
        );
        const past = new Date(Date.now() - 60 * 60 * 1000);

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: null,
              schedule: { at: past },
            }),
          ),
        );

        const headJob = yield* step(client.getJob({ id: chain.id }));
        assert.notEqual(headJob, undefined);
        assert.ok(headJob!.scheduledAt.getTime() - past.getTime() > 30 * 60 * 1000);

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain({ chain, timeoutMs: 2000, pollIntervalMs: 50 }));
      }),
    },
    {
      name: "continueWith with past schedule.at clamps scheduledAt to now",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          first: { entry: true; input: null; continueWith: { typeName: "second" } };
          second: { input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const past = new Date(Date.now() - 60 * 60 * 1000);
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                first: {
                  attemptHandler: async ({ complete }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      complete({
                        ...txCtx,
                        continueWith: { typeName: "second", input: null, schedule: { at: past } },
                      }),
                    ),
                },
                second: {
                  attemptHandler: async ({ complete }) =>
                    stateAdapter.withTransaction((txCtx) => complete({ ...txCtx, output: null })),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "first", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain({ chain, timeoutMs: 2000, pollIntervalMs: 50 }));

        const chainJobs = yield* step(
          client.listChainJobs({
            chainId: chain.id,
            orderDirection: "asc",
            limit: 10,
          }),
        );
        const continuation = chainJobs.items.find((job) => job.chainIndex === 1);
        assert.notEqual(continuation, undefined);
        assert.ok(continuation!.scheduledAt.getTime() - past.getTime() > 30 * 60 * 1000);
      }),
    },
    {
      name: "rescheduling with past schedule.at clamps scheduledAt to now",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const past = new Date(Date.now() - 60 * 60 * 1000);
        let attempts = 0;
        const firstAttemptDone = Promise.withResolvers<void>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 50,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    attempts++;
                    if (attempts > 1) {
                      assert.equal(job.lastAttemptError, null);
                      assert.equal(job.lastRescheduleReason, null);
                    }
                    if (attempts === 1) {
                      firstAttemptDone.resolve();
                      return stateAdapter.withTransaction((txCtx) =>
                        complete({ ...txCtx, reschedule: { at: past } }),
                      );
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
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(firstAttemptDone.promise);
        yield* wait(client.awaitChain({ chain, timeoutMs: 2000, pollIntervalMs: 50 }));

        assert.equal(attempts, 2);
      }),
    },
  ],
};
