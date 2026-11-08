import { sleep } from "@queuert/helpers";
import { type TestAPI, expect } from "vitest";

import { createClient } from "../client.ts";
import { createProcessors } from "../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../job-types/define-job-types.ts";
import { createSpyNotifyAdapter } from "../notify-adapter/notify-adapter.spy.spec-helper.ts";
import { createWorkerRunner } from "../worker-runner.ts";
import type { TestSuiteContext } from "./spec-context.spec-helper.ts";

export const notifyTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("schedules processing immediately", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkerRunners,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
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
              return withTransaction(async (txCtx, txHooks) =>
                complete({ ...txCtx, txHooks, output: { result: job.input.value } }),
              );
            },
          },
        },
      }),
    });

    await withWorkerRunners([await workerRunner.start()], async () => {
      const chain = await withTransaction(async (txCtx, txHooks) =>
        client.createChain({
          ...txCtx,
          txHooks,
          typeName: "test",
          input: { value: 1 },
        }),
      );

      const signal = AbortSignal.timeout(2000);
      await client.awaitChain(chain, { timeoutMs: 2000 });
      if (signal.aborted) {
        expect.fail("Timed out waiting for chain completion");
      }
    });
  });

  it("publishes every type scheduled in a commit in one call", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      first: { entry: true; input: null; output: null };
      second: { entry: true; input: null; output: null };
    }>();

    const spyNotifyAdapter = createSpyNotifyAdapter(notifyAdapter);
    const client = createClient({
      stateAdapter,
      notifyAdapter: spyNotifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    await withTransaction(async (txCtx, txHooks) =>
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

    expect(spyNotifyAdapter.calls).toEqual([
      { name: "notifyJobsScheduled", args: ["first", "second"] },
    ]);
  });

  it("wakes every idle worker when a job is scheduled", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkerRunners,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

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
        ...notifyAdapter,
        listenJobScheduled: async (typeNames, onNotification) => {
          const dispose = await notifyAdapter.listenJobScheduled(typeNames, onNotification);
          listeningCount++;
          return async () => {
            listeningCount--;
            await dispose();
          };
        },
      },
      observabilityAdapter,
      log,
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
                withTransaction(async (txCtx, txHooks) =>
                  complete({ ...txCtx, txHooks, output: null }),
                ),
            },
          },
        }),
      });

    await withWorkerRunners(
      [await createTestWorkerRunner().start(), await createTestWorkerRunner().start()],
      async () => {
        await expect.poll(() => listeningCount, { timeout: 2000 }).toBe(2);
        recording = true;
        const chain = await withTransaction(async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "test", input: null }),
        );
        await client.awaitChain(chain, { timeoutMs: 2000 });
        await expect.poll(() => acquiringWorkerIds.size, { timeout: 2000 }).toBe(2);
      },
    );
  });

  it("publishes every chain completed and attempt lost in a commit in one call each", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkerRunners,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const spyNotifyAdapter = createSpyNotifyAdapter(notifyAdapter);
    const client = createClient({
      stateAdapter,
      notifyAdapter: spyNotifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chains = await withTransaction(async (txCtx, txHooks) =>
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
      await expect
        .poll(async () =>
          Promise.all(chains.map(async (chain) => (await client.getJob({ id: chain.id }))?.status)),
        )
        .toEqual(["running", "running"]);
      spyNotifyAdapter.calls.length = 0;

      await withTransaction(async (txCtx, txHooks) => {
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
      expect(
        spyNotifyAdapter.calls.map((call) => ({ name: call.name, args: [...call.args].sort() })),
      ).toEqual(
        expect.arrayContaining([
          { name: "notifyChainsCompleted", args: chainIds },
          { name: "notifyJobAttemptsLost", args: chainIds },
        ]),
      );
      expect(spyNotifyAdapter.calls).toHaveLength(2);
    });
  });

  it("distributes processing to multiple workers", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkerRunners,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

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
                return withTransaction(async (txCtx, txHooks) =>
                  complete({ ...txCtx, txHooks, output: { result: job.input.value } }),
                );
              },
            },
          },
        }),
      });

    await withWorkerRunners(
      await Promise.all(Array.from({ length: 5 }, async () => createTestWorkerRunner().start())),
      async () => {
        const chains = await withTransaction(async (txCtx, txHooks) =>
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
          expect.fail("Timed out waiting for chain completions");
        }
      },
    );
  });

  it("handles distributed blocker jobs", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkerRunners,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: null;
        output: { allowed: boolean };
      };
      main: {
        entry: true;
        input: null;
        output: { done: true };
        blockers: [{ typeName: "blocker" }];
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
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
              return withTransaction(async (txCtx, txHooks) =>
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
              return withTransaction(async (txCtx, txHooks) =>
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
        const chain = await withTransaction(async (txCtx, txHooks) => {
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
        await client.awaitChain(chain, {
          signal,
          timeoutMs: 200,
        });
        if (signal.aborted) {
          expect.fail("Timed out waiting for chain completion");
        }
      },
    );
  });

  it("handles distributed chain jobs", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkerRunners,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      step1: {
        entry: true;
        input: null;
        continueWith: { typeName: "step2" };
      };
      step2: {
        input: null;
        output: { finished: true };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
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
              return withTransaction(async (txCtx, txHooks) =>
                complete({
                  ...txCtx,
                  txHooks,
                  continueWith: {
                    typeName: "step2",
                    input: null,
                  },
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
              return withTransaction(async (txCtx, txHooks) =>
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
        const chain = await withTransaction(async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "step1",
            input: null,
          }),
        );

        const signal = AbortSignal.timeout(100);
        await client.awaitChain(chain, { timeoutMs: 200 });
        if (signal.aborted) {
          expect.fail("Timed out waiting for chain completion");
        }
      },
    );
  });

  // check that notify signals are sent when jobs are completed externally to workers
  // like there are 2 distributed workers with dedicated job handlers and first job is completed outside

  it("notifies workers about workerless completed jobs", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkerRunners,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: { result: string };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

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
              expect(signal.aborted).toBe(true);
              jobCompleted.resolve();

              throw new Error();
            },
          },
        },
      }),
    });

    await withWorkerRunners([await workerRunner.start()], async () => {
      const chain = await withTransaction(async (txCtx, txHooks) =>
        client.createChain({
          ...txCtx,
          txHooks,
          typeName: "test",
          input: null,
        }),
      );

      await jobStarted.promise;

      await withTransaction(async (txCtx, txHooks) =>
        client.completeChain({
          ...txCtx,
          txHooks,
          ...chain,
          handler: async ({ job, completeJob }) => {
            return completeJob(job, async ({ complete }) =>
              complete({ output: { result: "from-external" } }),
            );
          },
        }),
      );

      await jobCompleted.promise;
    });
  });

  it("notifies the expired worker's attempts as lost when another worker reclaims them", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkerRunners,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: { result: string };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const zombieClient = createClient({
      stateAdapter: {
        ...stateAdapter,
        extendWorkerLease: async ({ workerId }) =>
          (await stateAdapter.getWorkers({ workerIds: [workerId] }))[0],
      },
      notifyAdapter,
      observabilityAdapter,
      log,
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

                  return withTransaction(async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { result: "recovered" } }),
                  );
                }

                jobStarted.resolve();

                await sleep(2000, { signal });
                expect(signal.aborted).toBe(true);
                jobCompleted.resolve();

                throw new Error();
              },
            },
          },
        }),
      });

    await withWorkerRunners([await createTestWorkerRunner(zombieClient).start()], async () => {
      const chain = await withTransaction(async (txCtx, txHooks) =>
        client.createChain({
          ...txCtx,
          txHooks,
          typeName: "test",
          input: null,
        }),
      );

      await jobStarted.promise;
      await sleep(250);

      await withWorkerRunners([await createTestWorkerRunner(client).start()], async () => {
        await client.awaitChain(chain, { timeoutMs: 5000 });
      });

      await jobCompleted.promise;
    });
  });

  it("wakes an idle worker for a retry after a failed attempt", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkerRunners,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: { result: string };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

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

            return withTransaction(async (txCtx, txHooks) =>
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
    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "test",
        input: null,
      }),
    );
    await firstAttemptStarted.promise;

    // Started while the only job is running, so once settled it waits the full poll interval.
    await withWorkerRunners([await idleWorkerRunner.start()], async () => {
      await sleep(100);

      const stopping = stopFailingWorkerRunner();
      gate.resolve();
      await stopping;

      await client.awaitChain(chain, { timeoutMs: 2000, pollIntervalMs: 50 });
    });
  });
};
