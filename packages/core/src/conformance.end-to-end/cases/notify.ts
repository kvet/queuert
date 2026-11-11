import assert from "node:assert/strict";

import { sleep, withWorkerRunners } from "@queuert/helpers";

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
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ job, complete }) => {
                  await sleep(50);
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { result: job.input.value } }),
                  );
                },
              },
            },
          }),
        });

        await withWorkerRunners([await workerRunner.start()], async () => {
          const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
            client.createChain({ ...txCtx, txHooks, typeName: "test", input: { value: 1 } }),
          );

          const signal = AbortSignal.timeout(2000);
          await client.awaitChain(chain, { timeoutMs: 2000 });
          if (signal.aborted) {
            throw new Error("Timed out waiting for chain completion");
          }
        });
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
                    return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                      complete({ ...txCtx, txHooks, output: { result: job.input.value } }),
                    );
                  },
                },
              },
            }),
          });

        await withWorkerRunners(
          await Promise.all(
            Array.from({ length: 5 }, async () => createTestWorkerRunner().start()),
          ),
          async () => {
            const chains = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
              client.createChains({
                ...txCtx,
                txHooks,
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
        );
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
        const workerRunner1 = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ complete }) => {
                  await sleep(25);
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { allowed: true } }),
                  );
                },
              },
            },
          }),
        });
        const workerRunner2 = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              main: {
                attemptHandler: async ({ complete }) => {
                  await sleep(25);
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { done: true } }),
                  );
                },
              },
            },
          }),
        });

        await withWorkerRunners(
          [await workerRunner1.start(), await workerRunner2.start()],
          async () => {
            const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) => {
              const blockerChain = await client.createChain({
                ...txCtx,
                txHooks,
                typeName: "blocker",
                input: null,
              });
              return client.createChain({
                ...txCtx,
                txHooks,
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
        );
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
        const workerRunner1 = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              step1: {
                attemptHandler: async ({ complete }) => {
                  await sleep(25);
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({
                      ...txCtx,
                      txHooks,
                      continueWith: { typeName: "step2", input: null },
                    }),
                  );
                },
              },
            },
          }),
        });
        const workerRunner2 = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              step2: {
                attemptHandler: async ({ complete }) => {
                  await sleep(25);
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { finished: true } }),
                  );
                },
              },
            },
          }),
        });

        await withWorkerRunners(
          [await workerRunner1.start(), await workerRunner2.start()],
          async () => {
            const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
              client.createChain({ ...txCtx, txHooks, typeName: "step1", input: null }),
            );

            const signal = AbortSignal.timeout(100);
            await client.awaitChain(chain, { timeoutMs: 200 });
            if (signal.aborted) {
              throw new Error("Timed out waiting for chain completion");
            }
          },
        );
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

        const workerRunner = createWorkerRunner({
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

        await withWorkerRunners([await workerRunner.start()], async () => {
          const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
            client.createChain({ ...txCtx, txHooks, typeName: "test", input: null }),
          );

          await jobStarted.promise;

          await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
            client.completeChain({
              ...txCtx,
              txHooks,
              ...chain,
              handler: async ({ job, completeJob }) =>
                completeJob(job, async ({ complete }) =>
                  complete({ output: { result: "from-external" } }),
                ),
            }),
          );

          await jobCompleted.promise;
        });
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

                      return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                        complete({ ...txCtx, txHooks, output: { result: "recovered" } }),
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

        await withWorkerRunners([await createTestWorkerRunner(zombieClient).start()], async () => {
          const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
            client.createChain({ ...txCtx, txHooks, typeName: "test", input: null }),
          );

          await jobStarted.promise;
          await sleep(250);

          await withWorkerRunners([await createTestWorkerRunner(client).start()], async () => {
            await client.awaitChain(chain, { timeoutMs: 5000 });
          });

          await jobCompleted.promise;
        });
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

                return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                  complete({ ...txCtx, txHooks, output: { result: "retried" } }),
                );
              },
              backoffConfig: { initialDelayMs: 10, multiplier: 1, maxDelayMs: 10 },
            },
          },
        });
        const failingWorkerRunner = createWorkerRunner({ client, concurrency: 1, processors });
        const idleWorkerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          pollIntervalMs: 10_000,
          processors,
        });

        const stopFailingWorkerRunner = await failingWorkerRunner.start();
        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "test", input: null }),
        );
        await firstAttemptStarted.promise;

        await withWorkerRunners([await idleWorkerRunner.start()], async () => {
          await sleep(100);

          const stopping = stopFailingWorkerRunner();
          gate.resolve();
          await stopping;

          const completedChain = await client.awaitChain(chain, {
            timeoutMs: 2000,
            pollIntervalMs: 50,
          });
          assert.deepEqual(completedChain.output, { result: "retried" });
        });
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

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChains({
            ...txCtx,
            txHooks,
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
                    withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                      complete({ ...txCtx, txHooks, output: null }),
                    ),
                },
              },
            }),
          });

        await withWorkerRunners(
          [await createTestWorkerRunner().start(), await createTestWorkerRunner().start()],
          async () => {
            await retryUntilPasses(
              async () => {
                assert.equal(listeningCount, 2);
              },
              { timeoutMs: 2000 },
            );
            recording = true;
            const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
              client.createChain({ ...txCtx, txHooks, typeName: "test", input: null }),
            );
            await client.awaitChain(chain, { timeoutMs: 2000 });
            await retryUntilPasses(
              async () => {
                assert.equal(acquiringWorkerIds.size, 2);
              },
              { timeoutMs: 2000 },
            );
          },
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

        const chains = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChains({
            ...txCtx,
            txHooks,
            items: [
              { typeName: "test", input: null },
              { typeName: "test", input: null },
            ],
          }),
        );
        const crashedWorkerRunner = createWorkerRunner({
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

        await withWorkerRunners([await crashedWorkerRunner.start()], async () => {
          await retryUntilPasses(async () => {
            const jobs = await client.getJobs({ ids: chains.map((chain) => chain.id) });
            assert.deepEqual(
              jobs.map((job) => job?.status),
              ["running", "running"],
            );
          });
          spyNotifyAdapter.calls.length = 0;

          await withCaseTransaction(stateAdapter, async (txCtx, txHooks) => {
            for (const chain of chains) {
              await client.completeChain({
                ...txCtx,
                txHooks,
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
        });
      },
    },
  ],
};
