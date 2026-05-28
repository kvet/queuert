import { type TestAPI, expectTypeOf } from "vitest";

import { createClient } from "../client.js";
import { type Chain } from "../entities/chain.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { sleep } from "../helpers/sleep.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const blockerChainsTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("handles long blocker chains", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: { value: number };
        output: { done: true };
        continueWith: { typeName: "blocker" };
      };
      main: {
        entry: true;
        input: { start: boolean };
        output: { finalResult: number };
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
    let blockerChainId: string;

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) => {
              expect(job.chainId).toEqual(blockerChainId);

              return complete(async ({ continueWith }) =>
                job.input.value < 1
                  ? continueWith({
                      typeName: "blocker",
                      input: { value: job.input.value + 1 },
                    })
                  : { done: true },
              );
            },
          },
          main: {
            attemptHandler: async ({
              job: {
                blockers: [blocker],
                input,
              },
              complete,
            }) => {
              expectTypeOf<(typeof blocker)["output"]>().toEqualTypeOf<{
                done: true;
              }>();

              return complete(async () => ({
                finalResult: (blocker.output.done ? 1 : 0) + (input.start ? 1 : 0),
              }));
            },
          },
        },
      }),
    });

    expectTypeOf<Parameters<typeof client.startChain<"main">>[0]["blockers"]>().not.toBeUndefined();

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => {
        const dependencyChain = await client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 0 },
        });
        blockerChainId = dependencyChain.id;

        const chain = await client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: { start: true },
          blockers: [dependencyChain],
        });

        return chain;
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededChain = await client.awaitChain(chain, completionOptions);

      expect(succeededChain.output).toEqual({ finalResult: 2 });
    });
  });

  it("handles completed blocker chains", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      main: {
        entry: true;
        input: null;
        output: { finalResult: number };
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
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({ result: job.input.value }));
            },
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              const [blocker] = job.blockers;

              return complete(async () => ({
                finalResult: blocker.output.result,
              }));
            },
          },
        },
      }),
    });

    const blockerChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 1 },
        }),
      ),
    );
    const completedBlockerChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...blockerChain,
          complete: async ({ job, complete }) => {
            return complete(job, async () => ({ result: job.input.value }));
          },
        }),
      ),
    );

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: null,
          blockers: [completedBlockerChain],
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededChain = await client.awaitChain(chain, completionOptions);

      expect(succeededChain.output).toEqual({
        finalResult: completedBlockerChain.output.result,
      });
    });
  });

  it("independent chains spawned during processing do not inherit context", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      inner: {
        entry: true;
        input: null;
        output: null;
      };
      outer: {
        entry: true;
        input: null;
        output: null;
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const childChains: Chain<string, "inner", null, null>[] = [];

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          inner: {
            attemptHandler: async ({ complete }) => {
              return complete(async () => {
                return null;
              });
            },
          },
          outer: {
            attemptHandler: async ({ prepare, complete }) => {
              await prepare({ mode: "staged" }, async (txCtx) => {
                childChains.push(
                  await withTransactionHooks(async (transactionHooks) =>
                    client.startChain({
                      ...txCtx,
                      transactionHooks,
                      typeName: "inner",
                      input: null,
                    }),
                  ),
                );
              });

              childChains.push(
                await withTransactionHooks(async (transactionHooks) =>
                  withTransaction(async (txCtx) =>
                    client.startChain({
                      ...txCtx,
                      transactionHooks,
                      typeName: "inner",
                      input: null,
                    }),
                  ),
                ),
              );

              return complete(async (txCtx) => {
                childChains.push(
                  await withTransactionHooks(async (transactionHooks) =>
                    client.startChain({
                      ...txCtx,
                      transactionHooks,
                      typeName: "inner",
                      input: null,
                    }),
                  ),
                );

                return null;
              });
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "outer",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);

      const succeededChildChains = await Promise.all(
        childChains.map(async (chain) => client.awaitChain(chain, completionOptions)),
      );

      expect(succeededChildChains).toHaveLength(3);
    });
  });

  it("handles chains that are distributed across workers", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "finish" };
      };
      finish: {
        input: { valueNext: number };
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
    const worker1 = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 100,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async ({ continueWith }) =>
                continueWith({
                  typeName: "finish",
                  input: { valueNext: job.input.value + 1 },
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
      pollIntervalMs: 100,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          finish: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async () => ({
                result: job.input.valueNext + 1,
              }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      const finishedChain = await client.awaitChain(chain, completionOptions);

      expect(finishedChain.output).toEqual({ result: 3 });
    });
  });

  it("handles multiple blocker chains", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      main: {
        entry: true;
        input: null;
        output: { finalResult: number[] };
        blockers: [{ typeName: "blocker" }, ...{ typeName: "blocker" }[]];
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
          blocker: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({ result: job.input.value }));
            },
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({
                finalResult: job.blockers.map((blocker) => blocker.output.result),
              }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => {
        const blockerChains = await client.startChains({
          ...txCtx,
          transactionHooks,
          items: Array.from({ length: 5 }, (_, i) => ({
            typeName: "blocker",
            input: { value: i + 1 },
          })),
        });
        return client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: null,
          // Assert non-empty tuple type - length 5 is guaranteed by Array.from
          blockers: blockerChains as [
            (typeof blockerChains)[number],
            ...(typeof blockerChains)[number][],
          ],
        });
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededChain = await client.awaitChain(chain, completionOptions);

      expect(succeededChain.output).toEqual({
        finalResult: Array.from({ length: 5 }, (_, i) => i + 1),
      });
    });
  });

  it("continueWith supports blockers", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      first: {
        entry: true;
        input: { id: string };
        continueWith: { typeName: "second" };
      };
      second: {
        input: { fromFirst: string };
        output: { finalResult: number };
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
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async () => ({ result: job.input.value * 10 }));
            },
          },
          first: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async ({ continueWith, ...txCtx }) => {
                const blockerChain = await client.startChain({
                  ...txCtx,
                  typeName: "blocker",
                  input: { value: 5 },
                });
                const continuedJob = await continueWith({
                  typeName: "second",
                  input: { fromFirst: job.input.id },
                  blockers: [blockerChain],
                });
                return continuedJob;
              });
            },
          },
          second: {
            attemptHandler: async ({
              job: {
                blockers: [blocker],
              },
              prepare,
              complete,
            }) => {
              await prepare({ mode: "atomic" });
              return complete(async () => ({ finalResult: blocker.output.result }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "first",
          input: { id: "test-123" },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededChain = await client.awaitChain(chain, completionOptions);

      expect(succeededChain.output).toEqual({ finalResult: 50 });
    });
  });

  it("batch-creates multiple blocker chains", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      main: {
        entry: true;
        input: null;
        output: { finalResult: number[] };
        blockers: [{ typeName: "blocker" }, ...{ typeName: "blocker" }[]];
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
          blocker: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({ result: job.input.value }));
            },
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({
                finalResult: job.blockers.map((blocker) => blocker.output.result),
              }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => {
        const blockerChains = await client.startChains({
          ...txCtx,
          transactionHooks,
          items: [
            {
              typeName: "blocker",
              input: { value: 1 },
            },
            {
              typeName: "blocker",
              input: { value: 2 },
            },
            {
              typeName: "blocker",
              input: { value: 3 },
            },
            {
              typeName: "blocker",
              input: { value: 4 },
            },
            {
              typeName: "blocker",
              input: { value: 5 },
            },
          ],
        });
        return client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: null,
          blockers: blockerChains,
        });
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededChain = await client.awaitChain(chain, completionOptions);

      expect(succeededChain.output).toEqual({
        finalResult: Array.from({ length: 5 }, (_, i) => i + 1),
      });
    });
  });

  it("batch-creates chains with shared blocker", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      main: {
        entry: true;
        input: { label: string };
        output: { finalResult: number };
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
    const worker = await createInProcessWorker({
      client,
      concurrency: 2,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({ result: job.input.value }));
            },
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({
                finalResult: job.blockers[0].output.result,
              }));
            },
          },
        },
      }),
    });

    const blocker = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 99 },
        }),
      ),
    );

    const [mainA, mainB] = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "main", input: { label: "A" }, blockers: [blocker] },
            { typeName: "main", input: { label: "B" }, blockers: [blocker] },
          ],
        }),
      ),
    );

    expect(mainA.status).toBe("blocked");
    expect(mainB.status).toBe("blocked");

    await withWorkers([await worker.start()], async () => {
      const [resultA, resultB] = await Promise.all([
        client.awaitChain(mainA, completionOptions),
        client.awaitChain(mainB, completionOptions),
      ]);

      expect(resultA.output).toEqual({ finalResult: 99 });
      expect(resultB.output).toEqual({ finalResult: 99 });
    });
  });

  it("raises scheduledAt to unblock time so blocked-since-creation jobs don't jump the queue", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: null;
        output: null;
      };
      main: {
        entry: true;
        input: null;
        output: null;
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

    const blockerHeld = Promise.withResolvers<void>();
    const releaseBlocker = Promise.withResolvers<void>();

    const mainChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => {
        const blockerChain = await client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: null,
        });
        return client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: null,
          blockers: [blockerChain],
        });
      }),
    );

    const mainAtCreation = await client.getJob({ id: mainChain.id });
    expect(mainAtCreation).toBeDefined();
    const creationScheduledAt = mainAtCreation!.scheduledAt.getTime();

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ complete }) => {
              blockerHeld.resolve();
              await releaseBlocker.promise;
              return complete(async () => null);
            },
          },
          main: { attemptHandler: async ({ complete }) => complete(async () => null) },
        },
      }),
    });

    await withWorkers([await worker.start()], async () => {
      await blockerHeld.promise;
      await sleep(10);
      releaseBlocker.resolve();
      await client.awaitChain(mainChain, completionOptions);
    });

    const unblockedMain = await client.getJob({ id: mainChain.id });
    expect(unblockedMain).toBeDefined();
    expect(unblockedMain!.scheduledAt.getTime()).toBeGreaterThan(creationScheduledAt);
  });
};
