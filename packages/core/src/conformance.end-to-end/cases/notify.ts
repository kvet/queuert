import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers";

import { createClient } from "../../client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { retryUntilPasses } from "../../conformance/retry-until-passes.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createSpyNotifyAdapter } from "../support/spy-notify-adapter.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndStateAdapter } from "../types.ts";

export const notifyGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "notify",
  cases: [
    {
      name: "schedules processing immediately",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ job, complete }) => {
                  await sleep(50);
                  return withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { result: job.input.value } }),
                  );
                },
              },
            },
          }),
        });

        await workerRunner.start();
        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: { value: 1 } }),
        );

        const signal = AbortSignal.timeout(2000);
        await client.awaitChain(chain, { timeoutMs: 2000 });
        if (signal.aborted) {
          throw new Error("Timed out waiting for chain completion");
        }
      },
    },
    {
      name: "distributes processing to multiple workers",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
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
                  attemptHandler: async ({ job, complete }) => {
                    await sleep(50);
                    return withCaseTransaction(stateAdapter, async (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value } }),
                    );
                  },
                },
              },
            }),
          });

        await using stack = new AsyncDisposableStack();
        const workerRunners = Array.from({ length: 5 }, () => stack.use(createTestWorkerRunner()));
        for (const workerRunner of workerRunners) {
          await workerRunner.start();
        }

        const chains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: Array.from({ length: 5 }, (_, i) => ({
              typeName: "test",
              input: { value: i },
            })),
          }),
        );

        const signal = AbortSignal.timeout(200);
        await Promise.all(
          chains.map(async (chain) => client.awaitChain(chain, { timeoutMs: 200 })),
        );
        if (signal.aborted) {
          throw new Error("Timed out waiting for chain completions");
        }
      },
    },
    {
      name: "handles distributed blocker jobs",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
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
        await using workerRunner1 = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ complete }) => {
                  await sleep(25);
                  return withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { allowed: true } }),
                  );
                },
              },
            },
          }),
        });
        await using workerRunner2 = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              main: {
                attemptHandler: async ({ complete }) => {
                  await sleep(25);
                  return withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { done: true } }),
                  );
                },
              },
            },
          }),
        });

        await workerRunner1.start();
        await workerRunner2.start();
        const chain = await withCaseTransaction(stateAdapter, async (txCtx) => {
          const blockerChain = await client.createChain({
            ...txCtx,
            typeName: "blocker",
            input: null,
          });
          return client.createChain({
            ...txCtx,
            typeName: "main",
            input: null,
            blockers: [blockerChain],
          });
        });

        const signal = AbortSignal.timeout(100);
        await client.awaitChain(chain, { signal, timeoutMs: 200 });
        if (signal.aborted) {
          throw new Error("Timed out waiting for chain completion");
        }
      },
    },
    {
      name: "handles distributed chain jobs",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          step1: { entry: true; input: null; continueWith: { typeName: "step2" } };
          step2: { input: null; output: { finished: true } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        await using workerRunner1 = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              step1: {
                attemptHandler: async ({ complete }) => {
                  await sleep(25);
                  return withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({
                      ...txCtx,
                      continueWith: { typeName: "step2", input: null },
                    }),
                  );
                },
              },
            },
          }),
        });
        await using workerRunner2 = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              step2: {
                attemptHandler: async ({ complete }) => {
                  await sleep(25);
                  return withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { finished: true } }),
                  );
                },
              },
            },
          }),
        });

        await workerRunner1.start();
        await workerRunner2.start();
        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "step1", input: null }),
        );

        const signal = AbortSignal.timeout(100);
        await client.awaitChain(chain, { timeoutMs: 200 });
        if (signal.aborted) {
          throw new Error("Timed out waiting for chain completion");
        }
      },
    },
    {
      name: "notifies workers about workerless completed jobs",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const jobStarted = Promise.withResolvers<void>();
        const jobCompleted = Promise.withResolvers<void>();

        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ signal }) => {
                  jobStarted.resolve();

                  await sleep(1000, { signal });
                  assert.equal(signal.aborted, true);
                  jobCompleted.resolve();

                  throw new Error();
                },
              },
            },
          }),
        });

        await workerRunner.start();
        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: null }),
        );

        await jobStarted.promise;

        await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
            ...chain,
            handler: async ({ job, completeJob }) =>
              completeJob(job, async ({ complete }) =>
                complete({ output: { result: "from-external" } }),
              ),
          }),
        );

        await jobCompleted.promise;
      },
    },
    {
      name: "notifies the expired worker's attempts as lost when another worker reclaims them",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const baseNotifyAdapter = notifyAdapter;
        const client = createClient({ stateAdapter, notifyAdapter: baseNotifyAdapter, jobTypes });
        const zombieClient = createClient({
          stateAdapter: {
            ...stateAdapter,
            extendWorkerLease: async ({ workerId }) =>
              (await stateAdapter.getWorkers({ workerIds: [workerId] }))[0],
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
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ signal, job, complete }) => {
                    if (job.attempt > 1) {
                      await jobCompleted.promise;
                      await sleep(10);

                      return withCaseTransaction(stateAdapter, async (txCtx) =>
                        complete({ ...txCtx, output: { result: "recovered" } }),
                      );
                    }

                    jobStarted.resolve();

                    await sleep(2000, { signal });
                    assert.equal(signal.aborted, true);
                    jobCompleted.resolve();

                    throw new Error();
                  },
                },
              },
            }),
          });

        await using zombieWorkerRunner = createTestWorkerRunner(zombieClient);
        await zombieWorkerRunner.start();
        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: null }),
        );

        await jobStarted.promise;
        await sleep(250);

        {
          await using workerRunner = createTestWorkerRunner(client);
          await workerRunner.start();
          await client.awaitChain(chain, { timeoutMs: 5000 });
        }

        await jobCompleted.promise;
      },
    },
    {
      name: "wakes an idle worker for a retry after a failed attempt",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
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
              attemptHandler: async ({ job, complete }) => {
                if (job.attempt === 1) {
                  firstAttemptStarted.resolve();
                  await gate.promise;
                  throw new Error("first attempt fails");
                }

                return withCaseTransaction(stateAdapter, async (txCtx) =>
                  complete({ ...txCtx, output: { result: "retried" } }),
                );
              },
              backoffConfig: { initialDelayMs: 10, multiplier: 1, maxDelayMs: 10 },
            },
          },
        });
        await using failingWorkerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors,
        });
        await using idleWorkerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          pollIntervalMs: 10_000,
          processors,
        });

        await failingWorkerRunner.start();
        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: null }),
        );
        await firstAttemptStarted.promise;

        await idleWorkerRunner.start();
        await sleep(100);

        const stopping = failingWorkerRunner.stop();
        gate.resolve();
        await stopping;

        const completedChain = await client.awaitChain(chain, {
          timeoutMs: 2000,
          pollIntervalMs: 50,
        });
        assert.deepEqual(completedChain.output, { result: "retried" });
      },
    },
    {
      name: "publishes every type scheduled in a commit in one call",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          first: { entry: true; input: null; output: null };
          second: { entry: true; input: null; output: null };
        }>();
        const spyNotifyAdapter = createSpyNotifyAdapter(notifyAdapter);
        const client = createClient({ stateAdapter, notifyAdapter: spyNotifyAdapter, jobTypes });

        await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: [
              { typeName: "first", input: null },
              { typeName: "first", input: null },
              { typeName: "second", input: null },
            ],
          }),
        );

        assert.deepEqual(spyNotifyAdapter.calls, [
          { name: "notifyJobsScheduled", args: ["first", "second"] },
        ]);
      },
    },
    {
      name: "wakes every idle worker when a job is scheduled",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const baseNotifyAdapter = notifyAdapter;

        let recording = false;
        let listeningCount = 0;
        const acquiringWorkerIds = new Set<string>();
        const client = createClient({
          stateAdapter: {
            ...stateAdapter,
            startJobAttempts: async (options) => {
              if (recording) acquiringWorkerIds.add(options.workerId);
              return stateAdapter.startJobAttempts(options);
            },
          },
          notifyAdapter: {
            ...baseNotifyAdapter,
            listenJobScheduled: async (typeNames, onNotification) => {
              const dispose = await baseNotifyAdapter.listenJobScheduled(typeNames, onNotification);
              listeningCount++;
              return async () => {
                listeningCount--;
                await dispose();
              };
            },
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
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, async (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    ),
                },
              },
            }),
          });

        await using workerRunner1 = createTestWorkerRunner();
        await using workerRunner2 = createTestWorkerRunner();
        await workerRunner1.start();
        await workerRunner2.start();
        await retryUntilPasses(
          async () => {
            assert.equal(listeningCount, 2);
          },
          { timeoutMs: 2000 },
        );
        recording = true;
        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: null }),
        );
        await client.awaitChain(chain, { timeoutMs: 2000 });
        await retryUntilPasses(
          async () => {
            assert.equal(acquiringWorkerIds.size, 2);
          },
          { timeoutMs: 2000 },
        );
      },
    },
    {
      name: "publishes every chain completed and attempt lost in a commit in one call each",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const spyNotifyAdapter = createSpyNotifyAdapter(notifyAdapter);
        const client = createClient({ stateAdapter, notifyAdapter: spyNotifyAdapter, jobTypes });

        const chains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: [
              { typeName: "test", input: null },
              { typeName: "test", input: null },
            ],
          }),
        );
        await using crashedWorkerRunner = createWorkerRunner({
          client,
          concurrency: chains.length,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ signal }) => {
                  await sleep(Number.POSITIVE_INFINITY, { signal });
                  throw new Error("crashed");
                },
              },
            },
          }),
        });

        await crashedWorkerRunner.start();
        await retryUntilPasses(async () => {
          const jobs = await client.getJobs({ ids: chains.map((chain) => chain.id) });
          assert.deepEqual(
            jobs.map((job) => job?.status),
            ["running", "running"],
          );
        });
        spyNotifyAdapter.calls.length = 0;

        await withCaseTransaction(stateAdapter, async (txCtx) => {
          for (const chain of chains) {
            await client.completeChain({
              ...txCtx,
              ...chain,
              handler: async ({ job, completeJob }) =>
                completeJob(job, async ({ complete }) => complete({ output: null })),
            });
          }
        });

        const chainIds = chains.map((chain) => chain.id).sort();
        assert.deepEqual(
          spyNotifyAdapter.calls
            .map((call) => ({ name: call.name, args: [...call.args].sort() }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          [
            { name: "notifyChainsCompleted", args: chainIds },
            { name: "notifyJobAttemptsLost", args: chainIds },
          ],
        );
        assert.equal(spyNotifyAdapter.calls.length, 2);
      },
    },
  ],
};
