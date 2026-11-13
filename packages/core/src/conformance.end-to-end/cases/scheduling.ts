import assert from "node:assert/strict";

import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker/worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndStateAdapter } from "../types.ts";

export const schedulingGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "scheduling",
  cases: [
    {
      name: "createChain with schedule.afterMs defers job processing",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
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
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 1 },
              schedule: { afterMs: 300 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(assert.rejects(client.awaitChain(chain, { timeoutMs: 200 })));
        assert.notEqual(
          yield* wait(client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 400 })),
          undefined,
        );
      }),
    },
    {
      name: "createChain with schedule.at defers job processing",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
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
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 1 },
              schedule: { at: new Date(Date.now() + 300) },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(assert.rejects(client.awaitChain(chain, { timeoutMs: 200 })));
        assert.notEqual(
          yield* wait(client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 400 })),
          undefined,
        );
      }),
    },
    {
      name: "continueWith with schedule.afterMs defers continuation job",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          first: { entry: true; input: { value: number }; continueWith: { typeName: "second" } };
          second: { input: { continued: boolean }; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const firstCompleted = Promise.withResolvers<void>();
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
                    try {
                      return await withCaseTransaction(stateAdapter, (txCtx) =>
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
                      firstCompleted.resolve();
                    }
                  },
                },
                second: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: "done" } }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "first", input: { value: 1 } }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(firstCompleted.promise);
        yield* wait(assert.rejects(client.awaitChain(chain, { timeoutMs: 200 })));
        assert.notEqual(
          yield* wait(client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 400 })),
          undefined,
        );
      }),
    },
    {
      name: "continueWith with schedule.at defers continuation job",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          first: { entry: true; input: { value: number }; continueWith: { typeName: "second" } };
          second: { input: { continued: boolean }; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const firstCompleted = Promise.withResolvers<void>();
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
                    try {
                      return await withCaseTransaction(stateAdapter, (txCtx) =>
                        complete({
                          ...txCtx,
                          continueWith: {
                            typeName: "second",
                            input: { continued: true },
                            schedule: { at: new Date(Date.now() + 300) },
                          },
                        }),
                      );
                    } finally {
                      firstCompleted.resolve();
                    }
                  },
                },
                second: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: "done" } }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "first", input: { value: 1 } }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(firstCompleted.promise);
        yield* wait(assert.rejects(client.awaitChain(chain, { timeoutMs: 200 })));
        assert.notEqual(
          yield* wait(client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 400 })),
          undefined,
        );
      }),
    },
    {
      name: "rescheduling with afterMs defers the next attempt by the given delay",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        let attemptCount = 0;
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
                    attemptCount++;
                    if (attemptCount > 1) {
                      assert.equal(job.lastAttemptError, null);
                    }
                    if (attemptCount === 1) {
                      firstAttemptDone.resolve();
                      return withCaseTransaction(stateAdapter, (txCtx) =>
                        complete({ ...txCtx, reschedule: { afterMs: 300 } }),
                      );
                    }
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: { value: 1 } }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(firstAttemptDone.promise);
        yield* wait(assert.rejects(client.awaitChain(chain, { timeoutMs: 200 })));
        assert.notEqual(
          yield* wait(client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 400 })),
          undefined,
        );
        assert.equal(attemptCount, 2);
      }),
    },
    {
      name: "recurring job self-schedules after complete without matching its own chain",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
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
                    withCaseTransaction(stateAdapter, function* (txCtx) {
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
                },
              },
            }),
          }),
        );

        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
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
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        let attemptCount = 0;
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
                    attemptCount++;
                    if (attemptCount > 1) {
                      assert.equal(job.lastAttemptError, null);
                    }
                    if (attemptCount === 1) {
                      firstAttemptDone.resolve();
                      return withCaseTransaction(stateAdapter, (txCtx) =>
                        complete({
                          ...txCtx,
                          reschedule: { at: new Date(Date.now() + 300) },
                        }),
                      );
                    }
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: { value: 1 } }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(firstAttemptDone.promise);
        yield* wait(assert.rejects(client.awaitChain(chain, { timeoutMs: 200 })));
        assert.notEqual(
          yield* wait(client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 400 })),
          undefined,
        );
        assert.equal(attemptCount, 2);
      }),
    },
    {
      name: "createChain with past schedule.at clamps scheduledAt to now",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
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
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    ),
                },
              },
            }),
          }),
        );
        const past = new Date(Date.now() - 60 * 60 * 1000);

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
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
        yield* wait(client.awaitChain(chain, { timeoutMs: 2000, pollIntervalMs: 50 }));
      }),
    },
    {
      name: "continueWith with past schedule.at clamps scheduledAt to now",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
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
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        continueWith: { typeName: "second", input: null, schedule: { at: past } },
                      }),
                    ),
                },
                second: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "first", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain(chain, { timeoutMs: 2000, pollIntervalMs: 50 }));

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
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
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
                    }
                    if (attempts === 1) {
                      firstAttemptDone.resolve();
                      return withCaseTransaction(stateAdapter, (txCtx) =>
                        complete({ ...txCtx, reschedule: { at: past } }),
                      );
                    }
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(firstAttemptDone.promise);
        yield* wait(client.awaitChain(chain, { timeoutMs: 2000, pollIntervalMs: 50 }));

        assert.equal(attempts, 2);
      }),
    },
  ],
};
