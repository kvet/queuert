import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { sleep } from "@queuert/helpers/sleep";
import { dynamicSyncAsync, syncAsync, resource, step, wait } from "@queuert/sync-async";

import { createClient } from "../../client/client.ts";
import { runInModeOf } from "../../conformance/adapters.ts";
import { retryUntilPasses } from "../../conformance/retry-until-passes.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker/worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createCaseStateAdapter } from "../support/create-case-state-adapter.ts";
import { createSpyNotifyAdapter } from "../support/spy-notify-adapter.ts";
import type { EndToEndNotifyContext } from "../types.ts";

export const notifyGroup: ConformanceGroup<EndToEndNotifyContext> = {
  name: "notify",
  cases: [
    {
      name: "schedules processing immediately",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
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
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    await sleep(50);
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: { result: job.input.value } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        yield* wait(workerRunner.start());
        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: { value: 1 } }),
          ),
        );

        const signal = AbortSignal.timeout(2000);
        yield* wait(client.awaitChain({ chain, timeoutMs: 2000 }));
        if (signal.aborted) {
          throw new Error("Timed out waiting for chain completion");
        }
      }),
    },
    {
      name: "distributes processing to multiple workers",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const createTestWorkerRunner = () =>
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    await sleep(50);
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: { result: job.input.value } }),
                    );
                  },
                },
              },
            }),
          });

        const stack = yield* resource(new AsyncDisposableStack());
        const workerRunners = Array.from({ length: 5 }, () => stack.use(createTestWorkerRunner()));
        for (const workerRunner of workerRunners) {
          yield* wait(workerRunner.start());
        }

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: Array.from({ length: 5 }, (_, i) => ({
                typeName: "test",
                input: { value: i },
              })),
            }),
          ),
        );

        const signal = AbortSignal.timeout(200);
        yield* wait(client.awaitChains({ chains, timeoutMs: 200 }));
        if (signal.aborted) {
          throw new Error("Timed out waiting for chain completions");
        }
      }),
    },
    {
      name: "handles distributed blocker jobs",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          blocker: { entry: true; input: null; output: { allowed: boolean } };
          main: {
            entry: true;
            input: null;
            output: { done: true };
            blockers: [{ typeName: "blocker" }];
          };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner1 = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await sleep(25);
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: { allowed: true } }),
                    );
                  },
                },
              },
            }),
          }),
        );
        const workerRunner2 = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                main: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await sleep(25);
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: { done: true } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        yield* wait(workerRunner1.start());
        yield* wait(workerRunner2.start());
        const chain = yield* step(
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
                return yield* step(
                  client.createChain({
                    ...txCtx,
                    typeName: "main",
                    input: null,
                    blockers: [blockerChain],
                  }),
                );
              }),
            ),
          ),
        );

        const signal = AbortSignal.timeout(1000);
        yield* wait(client.awaitChain({ chain, signal, timeoutMs: 2000 }));
        if (signal.aborted) {
          throw new Error("Timed out waiting for chain completion");
        }
      }),
    },
    {
      name: "handles distributed chain jobs",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          step1: { entry: true; input: null; continueWith: { typeName: "step2" } };
          step2: { input: null; output: { finished: true } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner1 = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                step1: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await sleep(25);
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({
                        ...txCtx,
                        continueWith: { typeName: "step2", input: null },
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );
        const workerRunner2 = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                step2: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await sleep(25);
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: { finished: true } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        yield* wait(workerRunner1.start());
        yield* wait(workerRunner2.start());
        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "step1", input: null }),
          ),
        );

        const signal = AbortSignal.timeout(1000);
        yield* wait(client.awaitChain({ chain, timeoutMs: 2000 }));
        if (signal.aborted) {
          throw new Error("Timed out waiting for chain completion");
        }
      }),
    },
    {
      name: "notifies workers about workerless completed jobs",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const jobStarted = Promise.withResolvers<void>();
        const jobCompleted = Promise.withResolvers<void>();

        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job }) => {
                    jobStarted.resolve();

                    await sleep(1000, { signal: job.signal });
                    assert.equal(job.signal.aborted, true);
                    jobCompleted.resolve();

                    throw new Error();
                  },
                },
              },
            }),
          }),
        );

        yield* wait(workerRunner.start());
        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(jobStarted.promise);

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "test" },
              output: { result: "from-external" },
            }),
          ),
        );

        yield* wait(jobCompleted.promise);
      }),
    },
    {
      name: "notifies the expired worker's attempts as lost when another worker reclaims them",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const baseNotifyAdapter = notifyAdapter;
        const client = createClient({ stateAdapter, notifyAdapter: baseNotifyAdapter, jobTypes });
        const zombieClient = createClient({
          stateAdapter: {
            ...stateAdapter,
            extendWorkerLease: ({ workerId }) =>
              runInModeOf(
                stateAdapter,
                syncAsync(function* () {
                  const [worker] = yield* step(stateAdapter.getWorkers({ workerIds: [workerId] }));
                  return worker;
                }),
              ),
          },
          notifyAdapter: baseNotifyAdapter,
          jobTypes,
        });

        const jobStarted = Promise.withResolvers<void>();
        const jobCompleted = Promise.withResolvers<void>();

        const createTestWorkerRunner = (workerClient: typeof client) =>
          createWorkerRunner({
            client: workerClient,
            concurrency: 1,
            leaseConfig: { durationMs: 200, heartbeatMs: 50 },
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    if (job.attempt > 1) {
                      await jobCompleted.promise;
                      await sleep(10);

                      await stateAdapter.withTransaction((txCtx) =>
                        applyJobOutcome({ ...txCtx, output: { result: "recovered" } }),
                      );
                      return;
                    }

                    jobStarted.resolve();

                    await sleep(2000, { signal: job.signal });
                    assert.equal(job.signal.aborted, true);
                    jobCompleted.resolve();

                    throw new Error();
                  },
                },
              },
            }),
          });

        const zombieWorkerRunner = yield* resource(createTestWorkerRunner(zombieClient));
        yield* wait(zombieWorkerRunner.start());
        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(jobStarted.promise);
        yield* wait(sleep(250));

        {
          const workerRunner = yield* resource(createTestWorkerRunner(client));
          yield* wait(workerRunner.start());
          yield* wait(client.awaitChain({ chain, timeoutMs: 5000 }));
        }

        yield* wait(jobCompleted.promise);
      }),
    },
    {
      name: "wakes an idle worker for a retry after a failed attempt",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const firstAttemptStarted = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();

        const processors = createProcessors({
          client,
          jobTypes,
          processors: {
            test: {
              attemptHandler: async ({ job, applyJobOutcome }) => {
                if (job.attempt === 1) {
                  firstAttemptStarted.resolve();
                  await gate.promise;
                  throw new Error("first attempt fails");
                }

                await stateAdapter.withTransaction((txCtx) =>
                  applyJobOutcome({ ...txCtx, output: { result: "retried" } }),
                );
              },
              backoffConfig: { initialDelayMs: 10, multiplier: 1, maxDelayMs: 10 },
            },
          },
        });
        const failingWorkerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors,
          }),
        );
        const idleWorkerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 10_000,
            processors,
          }),
        );

        yield* wait(failingWorkerRunner.start());
        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );
        yield* wait(firstAttemptStarted.promise);

        yield* wait(idleWorkerRunner.start());
        yield* wait(sleep(100));

        const stopping = failingWorkerRunner.stop();
        gate.resolve();
        yield* wait(stopping);

        const completedChain = yield* wait(
          client.awaitChain({ chain, timeoutMs: 2000, pollIntervalMs: 50 }),
        );
        assert.deepEqual(completedChain.output, { result: "retried" });
      }),
    },
    {
      name: "publishes every type scheduled in a commit in one call",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          first: { entry: true; input: null; output: null };
          second: { entry: true; input: null; output: null };
        }>();
        const spyNotifyAdapter = createSpyNotifyAdapter(notifyAdapter);
        const client = createClient({ stateAdapter, notifyAdapter: spyNotifyAdapter, jobTypes });

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "first", input: null },
                { typeName: "first", input: null },
                { typeName: "second", input: null },
              ],
            }),
          ),
        );

        assert.deepEqual(spyNotifyAdapter.calls, [
          { name: "notifyJobsScheduled", args: ["first", "second"] },
        ]);
      }),
    },
    {
      name: "wakes every idle worker when a job is scheduled",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        let recording = false;
        let listeningCount = 0;
        const acquiringWorkerIds = new Set<string>();
        const client = createClient({
          stateAdapter: {
            ...stateAdapter,
            startJobAttempts: (options) => {
              if (recording) acquiringWorkerIds.add(options.workerId);
              return stateAdapter.startJobAttempts(options);
            },
          },
          notifyAdapter: {
            ...notifyAdapter,
            listenJobsScheduled: (typeNames, onNotification) =>
              runInModeOf(
                notifyAdapter,
                syncAsync(function* () {
                  const dispose = yield* step(
                    notifyAdapter.listenJobsScheduled(typeNames, onNotification),
                  );
                  listeningCount++;
                  return () =>
                    runInModeOf(
                      notifyAdapter,
                      syncAsync(function* () {
                        listeningCount--;
                        yield* step(dispose());
                      }),
                    );
                }),
              ),
          },
          jobTypes,
        });
        const createTestWorkerRunner = () =>
          createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 60_000,
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
          });

        const workerRunner1 = yield* resource(createTestWorkerRunner());
        const workerRunner2 = yield* resource(createTestWorkerRunner());
        yield* wait(workerRunner1.start());
        yield* wait(workerRunner2.start());
        yield* wait(
          retryUntilPasses(
            async () => {
              assert.equal(listeningCount, 2);
            },
            { timeoutMs: 2000 },
          ),
        );
        recording = true;
        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );
        yield* wait(client.awaitChain({ chain, timeoutMs: 2000 }));
        yield* wait(
          retryUntilPasses(
            async () => {
              assert.equal(acquiringWorkerIds.size, 2);
            },
            { timeoutMs: 2000 },
          ),
        );
      }),
    },
    {
      name: "publishes a commit's completed chains and lost attempts together",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const spyNotifyAdapter = createSpyNotifyAdapter(notifyAdapter);
        const client = createClient({ stateAdapter, notifyAdapter: spyNotifyAdapter, jobTypes });

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "test", input: null },
                { typeName: "test", input: null },
              ],
            }),
          ),
        );
        const crashedWorkerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: chains.length,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job }) => {
                    await sleep(Number.POSITIVE_INFINITY, { signal: job.signal });
                    throw new Error("crashed");
                  },
                },
              },
            }),
          }),
        );

        yield* wait(crashedWorkerRunner.start());
        yield* wait(
          retryUntilPasses(async () => {
            const jobs = await client.getJobs({ ids: chains.map((chain) => chain.id) });
            assert.deepEqual(
              jobs.map((job) => job?.status),
              ["running", "running"],
            );
          }),
        );
        spyNotifyAdapter.calls.length = 0;

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                for (const chain of chains) {
                  yield* step(
                    client.applyJobOutcome({
                      ...txCtx,
                      job: { id: chain.id, typeName: "test" },
                      output: null,
                    }),
                  );
                }
              }),
            ),
          ),
        );

        const chainIds = chains.map((chain) => chain.id).sort();
        const byNameAndArgs = (
          a: { name: string; args: string[] },
          b: { name: string; args: string[] },
        ): number => a.name.localeCompare(b.name) || a.args.join().localeCompare(b.args.join());
        assert.deepEqual(
          spyNotifyAdapter.calls
            .map((call) => ({ name: call.name, args: [...call.args].sort() }))
            .sort(byNameAndArgs),
          [
            { name: "notifyChainsCompleted", args: chainIds },
            { name: "notifyJobAttemptsLost", args: chainIds },
          ],
        );
      }),
    },
    {
      name: "publishes the jobs a transaction's calls scheduled in one notification per job type",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          first: { entry: true; input: null; output: null };
          second: { entry: true; input: null; output: null };
        }>();
        const spyNotifyAdapter = createSpyNotifyAdapter(notifyAdapter);
        const client = createClient({ stateAdapter, notifyAdapter: spyNotifyAdapter, jobTypes });

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                yield* step(client.createChain({ ...txCtx, typeName: "first", input: null }));
                yield* step(client.createChain({ ...txCtx, typeName: "second", input: null }));
                yield* step(client.createChain({ ...txCtx, typeName: "first", input: null }));
              }),
            ),
          ),
        );

        assert.deepEqual(
          spyNotifyAdapter.calls.map((call) => ({ name: call.name, args: [...call.args].sort() })),
          [{ name: "notifyJobsScheduled", args: ["first", "second"] }],
        );
      }),
    },
    {
      name: "wakes the pending jobs a rolled-back transaction's calls locked in one notification",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, mode }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter, mode));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          first: { entry: true; input: null; output: null };
          second: { entry: true; input: null; output: null };
        }>();
        const spyNotifyAdapter = createSpyNotifyAdapter(notifyAdapter);
        const client = createClient({ stateAdapter, notifyAdapter: spyNotifyAdapter, jobTypes });

        const [firstChain, secondChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "first", input: null },
                { typeName: "second", input: null },
              ],
            }),
          ),
        );
        const callsBeforeRollback = spyNotifyAdapter.calls.length;

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      client.applyJobOutcome({
                        ...txCtx,
                        job: { id: firstChain.id },
                        reschedule: { afterMs: 0 },
                      }),
                    );
                    yield* step(
                      client.applyJobOutcome({
                        ...txCtx,
                        job: { id: secondChain.id },
                        reschedule: { afterMs: 0 },
                      }),
                    );
                    throw new Error("rolled back");
                  }),
                ),
              ),
            /rolled back/,
          ),
        );

        assert.deepEqual(
          spyNotifyAdapter.calls
            .slice(callsBeforeRollback)
            .map((call) => ({ name: call.name, args: [...call.args].sort() })),
          [{ name: "notifyJobsScheduled", args: ["first", "second"] }],
        );
      }),
    },
  ],
};
