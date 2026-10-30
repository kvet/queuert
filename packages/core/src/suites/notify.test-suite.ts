import { sleep } from "@queuert/helpers";
import { type TestAPI, expect } from "vitest";

import { createClient } from "../client.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../job-type-processors/create-job-type-processors.js";
import { defineJobTypes } from "../job-types/define-job-types.js";
import { createNoopNotifyAdapter } from "../notify-adapter/notify-adapter.noop.js";
import { createSpyNotifyAdapter } from "../notify-adapter/notify-adapter.spy.spec-helper.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const notifyTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("schedules processing immediately", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkers,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              await sleep(50);
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value } }),
              );
            },
          },
        },
      }),
    });

    await withWorkers([await worker.start()], async () => {
      const chain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
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

    const spyNotifyAdapter = createSpyNotifyAdapter(notifyAdapter ?? createNoopNotifyAdapter());
    const client = await createClient({
      stateAdapter,
      notifyAdapter: spyNotifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    await withTransaction(async (txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
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
    withWorkers,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    let recording = false;
    let listeningCount = 0;
    const acquiringWorkerIds = new Set<string>();
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        startJobAttempts: async (options) => {
          if (recording) acquiringWorkerIds.add(options.workerId);
          return stateAdapter.startJobAttempts(options);
        },
      },
      notifyAdapter: {
        ...notifyAdapter!,
        listenJobScheduled: async (typeNames, onNotification) => {
          const dispose = await notifyAdapter!.listenJobScheduled(typeNames, onNotification);
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
    const createWorker = async () =>
      createInProcessWorker({
        client,
        concurrency: 1,
        pollIntervalMs: 60_000,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            test: {
              attemptHandler: async ({ complete }) =>
                withTransaction(async (txCtx, transactionHooks) =>
                  complete({ ...txCtx, transactionHooks, output: null }),
                ),
            },
          },
        }),
      });

    await withWorkers(
      [await (await createWorker()).start(), await (await createWorker()).start()],
      async () => {
        await expect.poll(() => listeningCount, { timeout: 2000 }).toBe(2);
        recording = true;
        const chain = await withTransaction(async (txCtx, transactionHooks) =>
          client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
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
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const spyNotifyAdapter = createSpyNotifyAdapter(notifyAdapter ?? createNoopNotifyAdapter());
    const client = await createClient({
      stateAdapter,
      notifyAdapter: spyNotifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chains = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "test", input: null },
          { typeName: "test", input: null },
        ],
      }),
    );
    await stateAdapter.startJobAttempts({
      typeNames: ["test"],
      workerId: "worker",
      limit: chains.length,
    });
    spyNotifyAdapter.calls.length = 0;

    await withTransaction(async (txCtx, transactionHooks) => {
      for (const chain of chains) {
        await client.completeChain({
          ...txCtx,
          transactionHooks,
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

  it("distributes processing to multiple workers", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkers,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const createWorker = async () =>
      createInProcessWorker({
        client,
        concurrency: 1,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            test: {
              attemptHandler: async ({ job, complete }) => {
                await sleep(50);
                return withTransaction(async (txCtx, transactionHooks) =>
                  complete({ ...txCtx, transactionHooks, output: { result: job.input.value } }),
                );
              },
            },
          },
        }),
      });

    await withWorkers(
      await Promise.all(Array.from({ length: 5 }, async () => (await createWorker()).start())),
      async () => {
        const chains = await withTransaction(async (txCtx, transactionHooks) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
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
    withWorkers,
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

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker1 = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ complete }) => {
              await sleep(25);
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { allowed: true } }),
              );
            },
          },
        },
      }),
    });
    const worker2 = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          main: {
            attemptHandler: async ({ complete }) => {
              await sleep(25);
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { done: true } }),
              );
            },
          },
        },
      }),
    });

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      const chain = await withTransaction(async (txCtx, transactionHooks) => {
        const blockerChain = await client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: null,
        });
        return client.createChain({
          ...txCtx,
          transactionHooks,
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
    });
  });

  it("handles distributed chain jobs", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkers,
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

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker1 = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          step1: {
            attemptHandler: async ({ complete }) => {
              await sleep(25);
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
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
    const worker2 = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          step2: {
            attemptHandler: async ({ complete }) => {
              await sleep(25);
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { finished: true } }),
              );
            },
          },
        },
      }),
    });

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      const chain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "step1",
          input: null,
        }),
      );

      const signal = AbortSignal.timeout(100);
      await client.awaitChain(chain, { timeoutMs: 200 });
      if (signal.aborted) {
        expect.fail("Timed out waiting for chain completion");
      }
    });
  });

  // check that notify signals are sent when jobs are completed externally to workers
  // like there are 2 distributed workers with dedicated job handlers and first job is completed outside

  it("notifies workers about workerless completed jobs", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkers,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: { result: string };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
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

    await withWorkers([await worker.start()], async () => {
      const chain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      );

      await jobStarted.promise;

      await withTransaction(async (txCtx, transactionHooks) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
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

  it("aborts the attempt of a worker whose lease expired once another worker reclaims its job", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkers,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: { result: string };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const expiringClient = await createClient({
      stateAdapter: {
        ...stateAdapter,
        startWorker: async (params) => stateAdapter.startWorker({ ...params, leaseMs: 1 }),
        extendWorkerLease: async ({ workerId }) => ({
          id: workerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          startedAt: new Date(),
          leaseUntil: new Date(),
        }),
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();

    const createWorker = async (workerClient: typeof client) =>
      createInProcessWorker({
        client: workerClient,
        concurrency: 1,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            test: {
              attemptHandler: async ({ signal, job, complete }) => {
                if (job.attempt > 1) {
                  await jobCompleted.promise;

                  return withTransaction(async (txCtx, transactionHooks) =>
                    complete({ ...txCtx, transactionHooks, output: { result: "recovered" } }),
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

    await withWorkers([await (await createWorker(expiringClient)).start()], async () => {
      const chain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
        }),
      );

      await jobStarted.promise;
      await sleep(10);

      await withWorkers([await (await createWorker(client)).start()], async () => {
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
    withWorkers,
    withTransaction,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: { result: string };
      };
    }>();

    const client = await createClient({
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

            return withTransaction(async (txCtx, transactionHooks) =>
              complete({ ...txCtx, transactionHooks, output: { result: "retried" } }),
            );
          },
          backoffConfig: { initialDelayMs: 10, multiplier: 1, maxDelayMs: 10 },
        },
      },
    });
    const failingWorker = await createInProcessWorker({ client, concurrency: 1, processors });
    const idleWorker = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 10_000,
      processors,
    });

    const stopFailingWorker = await failingWorker.start();
    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      }),
    );
    await firstAttemptStarted.promise;

    // Started while the only job is running, so once settled it waits the full poll interval.
    await withWorkers([await idleWorker.start()], async () => {
      await sleep(100);

      const stopping = stopFailingWorker();
      gate.resolve();
      await stopping;

      await client.awaitChain(chain, { timeoutMs: 2000, pollIntervalMs: 50 });
    });
  });
};
