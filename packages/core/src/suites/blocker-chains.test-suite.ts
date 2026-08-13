import { type TestAPI, expectTypeOf } from "vitest";

import { createClient } from "../client.js";
import { type Chain } from "../entities/chain.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { BlockerLimitExceededError } from "../errors.js";
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

              return complete(async ({ finish }) =>
                job.input.value < 1
                  ? finish({
                      continueWith: {
                        typeName: "blocker",
                        input: { value: job.input.value + 1 },
                      },
                    })
                  : finish({ output: { done: true } }),
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

              return complete(async ({ finish }) =>
                finish({
                  output: {
                    finalResult: (blocker.output.done ? 1 : 0) + (input.start ? 1 : 0),
                  },
                }),
              );
            },
          },
        },
      }),
    });

    expectTypeOf<
      Parameters<typeof client.createChain<"main">>[0]["blockers"]
    >().not.toBeUndefined();

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => {
        const dependencyChain = await client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 0 },
        });
        blockerChainId = dependencyChain.id;

        const chain = await client.createChain({
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
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value } }),
              );
            },
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              const [blocker] = job.blockers;

              return complete(async ({ finish }) =>
                finish({
                  output: {
                    finalResult: blocker.output.result,
                  },
                }),
              );
            },
          },
        },
      }),
    });

    const blockerChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
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
          handler: async ({ job, completeJob }) => {
            return completeJob(job, async ({ finish }) =>
              finish({ output: { result: job.input.value } }),
            );
          },
        }),
      ),
    );

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
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

  it("rejects createChain declaring more blockers than the limit", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
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
        blockers: { typeName: "blocker" }[];
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const blockerChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: null,
        }),
      ),
    );

    try {
      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "main",
            input: null,
            blockers: Array.from({ length: 101 }, () => blockerChain),
          }),
        ),
      );
      expect.fail("Expected createChain to throw an error due to exceeding blocker limit");
    } catch (error) {
      expect(error).toBeInstanceOf(BlockerLimitExceededError);
      expect((error as BlockerLimitExceededError).count).toBe(101);
      expect((error as BlockerLimitExceededError).limit).toBe(100);
      expect((error as BlockerLimitExceededError).typeName).toBe("main");
    }
  });

  it("rejects continueWith declaring more blockers than the limit", async ({
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
      starter: {
        entry: true;
        input: null;
        output: null;
        continueWith: { typeName: "next" };
      };
      next: {
        input: null;
        output: null;
        blockers: { typeName: "blocker" }[];
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const blockerChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: null,
        }),
      ),
    );

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ complete }) =>
              complete(async ({ finish }) => finish({ output: null })),
          },
          starter: {
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt === 1) {
                return complete(async ({ finish }) =>
                  finish({
                    continueWith: {
                      typeName: "next",
                      input: null,
                      blockers: Array.from({ length: 101 }, () => blockerChain),
                    },
                  }),
                );
              }

              expect(job.lastAttemptError).toContain("BlockerLimitExceededError");
              expect(job.lastAttemptError).toContain("exceeding the limit of 100");
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
          next: {
            attemptHandler: async ({ complete }) =>
              complete(async ({ finish }) => finish({ output: null })),
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "starter",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
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
            attemptHandler: async ({ complete }) =>
              complete(async ({ finish }) => finish({ output: null })),
          },
          outer: {
            attemptHandler: async ({ prepare, complete }) => {
              await prepare({ mode: "staged" }, async (txCtx) => {
                childChains.push(
                  await withTransactionHooks(async (transactionHooks) =>
                    client.createChain({
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
                    client.createChain({
                      ...txCtx,
                      transactionHooks,
                      typeName: "inner",
                      input: null,
                    }),
                  ),
                ),
              );

              return complete(async ({ finish, ...txCtx }) => {
                childChains.push(
                  await withTransactionHooks(async (transactionHooks) =>
                    client.createChain({
                      ...txCtx,
                      transactionHooks,
                      typeName: "inner",
                      input: null,
                    }),
                  ),
                );

                return finish({ output: null });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
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
              return complete(async ({ finish }) =>
                finish({
                  continueWith: {
                    typeName: "finish",
                    input: { valueNext: job.input.value + 1 },
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
      pollIntervalMs: 100,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          finish: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.valueNext + 1 } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
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
        blockers: { typeName: "blocker" }[];
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
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value } }),
              );
            },
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async ({ finish }) =>
                finish({
                  output: {
                    finalResult: job.blockers.map((blocker) => blocker.output.result),
                  },
                }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => {
        const blockerChains = await client.createChains({
          ...txCtx,
          transactionHooks,
          items: Array.from({ length: 5 }, (_, i) => ({
            typeName: "blocker",
            input: { value: i + 1 },
          })),
        });
        return client.createChain({
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
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value * 10 } }),
              );
            },
          },
          first: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async ({ finish, ...txCtx }) => {
                const blockerChain = await client.createChain({
                  ...txCtx,
                  typeName: "blocker",
                  input: { value: 5 },
                });
                return finish({
                  continueWith: {
                    typeName: "second",
                    input: { fromFirst: job.input.id },
                    blockers: [blockerChain],
                  },
                });
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
              return complete(async ({ finish }) =>
                finish({ output: { finalResult: blocker.output.result } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
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
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value } }),
              );
            },
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async ({ finish }) =>
                finish({
                  output: {
                    finalResult: job.blockers.map((blocker) => blocker.output.result),
                  },
                }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => {
        const blockerChains = await client.createChains({
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
        return client.createChain({
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
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.value } }),
              );
            },
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async ({ finish }) =>
                finish({
                  output: {
                    finalResult: job.blockers[0].output.result,
                  },
                }),
              );
            },
          },
        },
      }),
    });

    const blocker = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 99 },
        }),
      ),
    );

    const [mainA, mainB] = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "main", input: { label: "A" }, blockers: [blocker] },
            { typeName: "main", input: { label: "B" }, blockers: [blocker] },
          ],
        }),
      ),
    );

    expect(mainA.status).toBe("running");
    expect(mainB.status).toBe("running");

    const jobA = await client.getJob({ id: mainA.id });
    const jobB = await client.getJob({ id: mainB.id });
    expect(jobA!.status === "pending" && jobA!.blocked).toBe(true);
    expect(jobB!.status === "pending" && jobB!.blocked).toBe(true);

    await withWorkers([await worker.start()], async () => {
      const [resultA, resultB] = await Promise.all([
        client.awaitChain(mainA, completionOptions),
        client.awaitChain(mainB, completionOptions),
      ]);

      expect(resultA.output).toEqual({ finalResult: 99 });
      expect(resultB.output).toEqual({ finalResult: 99 });
    });
  });

  it("unblocks all jobs when multiple shared blocker chains complete concurrently", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
    skip,
  }) => {
    if (stateAdapter.transactionConcurrency === "serialized") return skip();
    const blockerCount = 5;
    const mainCount = 5;

    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: null;
        output: null;
      };
      main: {
        entry: true;
        input: { index: number };
        output: { result: number };
        blockers: { typeName: "blocker" }[];
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    let readyBlockers = 0;
    const allBlockersReady = Promise.withResolvers<void>();
    const releaseBlockers = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      client,
      concurrency: blockerCount + mainCount,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ complete }) => {
              return complete(async ({ finish }) => {
                readyBlockers++;
                if (readyBlockers === blockerCount) allBlockersReady.resolve();
                await releaseBlockers.promise;
                return finish({ output: null });
              });
            },
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async ({ finish }) =>
                finish({ output: { result: job.input.index } }),
              );
            },
          },
        },
      }),
    });

    const blockerChains = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: Array.from({ length: blockerCount }, () => ({
            typeName: "blocker",
            input: null,
          })),
        }),
      ),
    );

    const mainChains = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: Array.from({ length: mainCount }, (_, i) => ({
            typeName: "main",
            input: { index: i },
            blockers: blockerChains,
          })),
        }),
      ),
    );

    for (const chain of mainChains) {
      const job = await client.getJob({ id: chain.id });
      expect(job).toBeDefined();
      expect(job!.status).toBe("pending");
      if (job!.status === "pending") expect(job!.blocked).toBe(true);
    }

    await withWorkers([await worker.start()], async () => {
      await allBlockersReady.promise;
      releaseBlockers.resolve();

      const results = await Promise.all(
        mainChains.map(async (chain) => client.awaitChain(chain, completionOptions)),
      );

      for (let i = 0; i < results.length; i++) {
        expect(results[i].output).toEqual({ result: i });
      }
    });
  });

  it("handles duplicate blocker chain ids without breaking unblock", async ({
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
        output: { done: true };
        blockers: { typeName: "blocker" }[];
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
            attemptHandler: async ({ complete }) =>
              complete(async ({ finish }) => finish({ output: null })),
          },
          main: {
            attemptHandler: async ({ complete }) =>
              complete(async ({ finish }) => finish({ output: { done: true as const } })),
          },
        },
      }),
    });

    const blockerChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: null,
        }),
      ),
    );

    const mainChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: null,
          blockers: [blockerChain, blockerChain, blockerChain],
        }),
      ),
    );

    const mainJob = await client.getJob({ id: mainChain.id });
    expect(mainJob).toBeDefined();
    expect(mainJob!.status).toBe("pending");
    if (mainJob!.status === "pending") expect(mainJob!.blocked).toBe(true);

    await withWorkers([await worker.start()], async () => {
      const result = await client.awaitChain(mainChain, completionOptions);
      expect(result.output).toEqual({ done: true });
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
              return complete(async ({ finish }) => finish({ output: null }));
            },
          },
          main: {
            attemptHandler: async ({ complete }) =>
              complete(async ({ finish }) => finish({ output: null })),
          },
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
