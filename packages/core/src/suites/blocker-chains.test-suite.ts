import { unwrap, sleep } from "@queuert/helpers";
import { type TestAPI, expect, expectTypeOf } from "vitest";

import { createClient } from "../client.js";
import { type Chain } from "../entities/chain.js";
import { BlockerLimitExceededError, ChainTypeMismatchError } from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../job-type-processors/create-job-type-processors.js";
import { defineJobTypes } from "../job-types/define-job-types.js";
import { type TestSuiteContext, expectFailure } from "./spec-context.spec-helper.js";

export const blockerChainsTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("handles long blocker chains", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    let blockerChainId: string;

    const worker = createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) => {
              expect(job.chainId).toEqual(blockerChainId);

              return withTransaction((txCtx, transactionHooks) =>
                job.input.value < 1
                  ? complete({
                      ...txCtx,
                      transactionHooks,
                      continueWith: {
                        typeName: "blocker",
                        input: { value: job.input.value + 1 },
                      },
                    })
                  : complete({ ...txCtx, transactionHooks, output: { done: true } }),
              );
            },
          },
          main: {
            attemptHandler: async ({
              job: {
                input,
                blockers: [blocker],
              },
              complete,
            }) => {
              expectTypeOf<(typeof blocker)["output"]>().toEqualTypeOf<{
                done: true;
              }>();

              return withTransaction((txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
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

    const chain = await withTransactionOperation(function* (txCtx, transactionHooks) {
      const dependencyChain = yield* unwrap(
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 0 },
        }),
      );
      blockerChainId = dependencyChain.id;

      const chain = yield* unwrap(
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: { start: true },
          blockers: [dependencyChain],
        }),
      );

      return chain;
    });

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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value } }),
              );
            },
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              const [blocker] = job.blockers;

              return withTransaction((txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
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

    const blockerChain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "blocker",
        input: { value: 1 },
      }),
    );
    const completedBlockerChain = await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...blockerChain,
        handler: ({ job, completeJob }) => {
          return completeJob(job, ({ complete }) =>
            complete({ output: { result: job.input.value } }),
          );
        },
      }),
    );

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: null,
        blockers: [completedBlockerChain],
      }),
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const blockerChain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "blocker",
        input: null,
      }),
    );

    try {
      await withTransaction((txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: null,
          blockers: Array.from(
            { length: stateAdapter.config.maxBlockersPerJob + 1 },
            () => blockerChain,
          ),
        }),
      );
      expect.fail("Expected createChain to throw an error due to exceeding blocker limit");
    } catch (error) {
      expect(error).toBeInstanceOf(BlockerLimitExceededError);
      expect((error as BlockerLimitExceededError).count).toBe(
        stateAdapter.config.maxBlockersPerJob + 1,
      );
      expect((error as BlockerLimitExceededError).limit).toBe(
        stateAdapter.config.maxBlockersPerJob,
      );
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const blockerChain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "blocker",
        input: null,
      }),
    );

    const worker = createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ complete }) =>
              withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ),
          },
          starter: {
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt === 1) {
                return withTransaction((txCtx, transactionHooks) =>
                  complete({
                    ...txCtx,
                    transactionHooks,
                    continueWith: {
                      typeName: "next",
                      input: null,
                      blockers: Array.from(
                        { length: stateAdapter.config.maxBlockersPerJob + 1 },
                        () => blockerChain,
                      ),
                    },
                  }),
                );
              }

              expect(job.lastAttemptError).toContain("BlockerLimitExceededError");
              expect(job.lastAttemptError).toContain(
                `exceeding the limit of ${stateAdapter.config.maxBlockersPerJob}`,
              );
              return withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
          next: {
            attemptHandler: async ({ complete }) =>
              withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "starter",
        input: null,
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });
  });

  it("independent chains spawned during processing do not inherit context", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const childChains: Chain<string, "inner", null, null>[] = [];

    const worker = createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          inner: {
            attemptHandler: async ({ complete }) =>
              withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ),
          },
          outer: {
            attemptHandler: async ({ complete }) => {
              await withTransactionOperation(function* (txCtx, transactionHooks) {
                childChains.push(
                  yield* unwrap(
                    client.createChain({
                      ...txCtx,
                      transactionHooks,
                      typeName: "inner",
                      input: null,
                    }),
                  ),
                );
              });

              return withTransactionOperation(function* (txCtx, transactionHooks) {
                childChains.push(
                  yield* unwrap(
                    client.createChain({
                      ...txCtx,
                      transactionHooks,
                      typeName: "inner",
                      input: null,
                    }),
                  ),
                );

                return complete({ ...txCtx, transactionHooks, output: null });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "outer",
        input: null,
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);

      const succeededChildChains = await Promise.all(
        childChains.map(async (chain) => client.awaitChain(chain, completionOptions)),
      );

      expect(succeededChildChains).toHaveLength(2);
    });
  });

  it("handles chains that are distributed across workers", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker1 = createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 100,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction((txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
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
    const worker2 = createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 100,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          finish: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction((txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  output: { result: job.input.valueNext + 1 },
                }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 1 },
      }),
    );

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      const finishedChain = await client.awaitChain(chain, completionOptions);

      expect(finishedChain.output).toEqual({ result: 3 });
    });
  });

  it("handles multiple blocker chains", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value } }),
              );
            },
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction((txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
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

    const chain = await withTransactionOperation(function* (txCtx, transactionHooks) {
      const blockerChains = yield* unwrap(
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: Array.from({ length: 5 }, (_, i) => ({
            typeName: "blocker",
            input: { value: i + 1 },
          })),
        }),
      );
      return client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: null,
        blockers: blockerChains,
      });
    });

    await withWorkers([await worker.start()], async () => {
      const succeededChain = await client.awaitChain(chain, completionOptions);

      expect(succeededChain.output).toEqual({
        finalResult: Array.from({ length: 5 }, (_, i) => i + 1),
      });
    });
  });

  it("continueWith supports blockers", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value * 10 } }),
              );
            },
          },
          first: {
            attemptHandler: async ({ job, complete }) => {
              return withTransactionOperation(function* (txCtx, transactionHooks) {
                const blockerChain = yield* unwrap(
                  client.createChain({
                    ...txCtx,
                    transactionHooks,
                    typeName: "blocker",
                    input: { value: 5 },
                  }),
                );
                return complete({
                  ...txCtx,
                  transactionHooks,
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
            attemptHandler: async ({ job, complete }) => {
              const [blocker] = job.blockers;
              return withTransaction((txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  output: { finalResult: blocker.output.result },
                }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "first",
        input: { id: "test-123" },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededChain = await client.awaitChain(chain, completionOptions);

      expect(succeededChain.output).toEqual({ finalResult: 50 });
    });
  });

  it("continueWith accepts blockers by id and resolves them from the stored chain", async ({
    runInMode,
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      other: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      first: {
        entry: true;
        input: { blockerId: string; otherId: string };
        continueWith: { typeName: "second" };
      };
      second: {
        input: null;
        output: { sum: number };
        blockers: [{ typeName: "blocker" }, ...{ typeName: "blocker" | "other" }[]];
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value } }),
              ),
          },
          other: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value } }),
              ),
          },
          first: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction((txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  continueWith: {
                    typeName: "second",
                    input: null,
                    blockers: [{ id: job.input.blockerId }, { id: job.input.otherId }],
                  },
                }),
              ),
          },
          second: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction((txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  output: {
                    sum: job.blockers.reduce((sum, blocker) => sum + blocker.output.result, 0),
                  },
                }),
              );
            },
          },
        },
      }),
    });

    const { blockerChain, otherChain } = await withTransactionOperation(
      function* (txCtx, transactionHooks) {
        return {
          blockerChain: yield* unwrap(
            client.createChain({
              ...txCtx,
              transactionHooks,
              typeName: "blocker",
              input: { value: 1 },
            }),
          ),
          otherChain: yield* unwrap(
            client.createChain({
              ...txCtx,
              transactionHooks,
              typeName: "other",
              input: { value: 10 },
            }),
          ),
        };
      },
    );

    const mismatchChain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "first",
        input: { blockerId: blockerChain.id, otherId: otherChain.id },
      }),
    );
    await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...mismatchChain,
        handler: ({ job, completeJob }) =>
          runInMode(function* () {
            if (job.typeName !== "first") return;
            yield* expectFailure(
              () =>
                completeJob(job, ({ complete }) => {
                  const _rejectsWrongSlotType = async () =>
                    complete({
                      continueWith: {
                        typeName: "second",
                        input: null,
                        // @ts-expect-error the first blocker slot only accepts "blocker"
                        blockers: [{ id: otherChain.id, typeName: "other" }],
                      },
                    });

                  return complete({
                    continueWith: {
                      typeName: "second",
                      input: null,
                      blockers: [{ id: otherChain.id, typeName: "blocker" }],
                    },
                  });
                }),
              ChainTypeMismatchError,
            );
          }),
      }),
    );

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "first",
        input: { blockerId: blockerChain.id, otherId: otherChain.id },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededChain = await client.awaitChain(chain, completionOptions);

      expect(succeededChain.output).toEqual({ sum: 11 });
    });
  });

  it("accepts blockers by id and resolves them from the stored chain", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      other: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      main: {
        entry: true;
        input: null;
        output: { sum: number };
        blockers: [{ typeName: "blocker" }, ...{ typeName: "blocker" | "other" }[]];
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value } }),
              ),
          },
          other: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value } }),
              ),
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction((txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  output: {
                    sum: job.blockers.reduce((sum, blocker) => sum + blocker.output.result, 0),
                  },
                }),
              );
            },
          },
        },
      }),
    });

    const { blockerChain, otherChain } = await withTransactionOperation(
      function* (txCtx, transactionHooks) {
        return {
          blockerChain: yield* unwrap(
            client.createChain({
              ...txCtx,
              transactionHooks,
              typeName: "blocker",
              input: { value: 1 },
            }),
          ),
          otherChain: yield* unwrap(
            client.createChain({
              ...txCtx,
              transactionHooks,
              typeName: "other",
              input: { value: 10 },
            }),
          ),
        };
      },
    );

    const chain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: null,
        blockers: [{ id: blockerChain.id }, { id: otherChain.id, typeName: "other" }, blockerChain],
      }),
    );

    type MainBlockers = Parameters<typeof client.createChain<"main">>[0]["blockers"];
    expectTypeOf<[{ id: string }]>().toExtend<MainBlockers>();
    expectTypeOf<[typeof blockerChain, typeof otherChain]>().toExtend<MainBlockers>();
    expectTypeOf<[{ id: string; typeName: "other" }]>().not.toExtend<MainBlockers>();

    await expect(
      withTransaction((txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: null,
          blockers: [{ id: otherChain.id, typeName: "blocker" }],
        }),
      ),
    ).rejects.toThrow(ChainTypeMismatchError);

    await expect(
      withTransaction((txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: null,
          blockers: [{ ...otherChain, typeName: "blocker" as const }],
        }),
      ),
    ).rejects.toThrow(ChainTypeMismatchError);

    await withWorkers([await worker.start()], async () => {
      const succeededChain = await client.awaitChain(chain, completionOptions);

      expect(succeededChain.output).toEqual({ sum: 12 });
    });
  });

  it("batch-creates multiple blocker chains", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value } }),
              );
            },
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction((txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
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

    const chain = await withTransactionOperation(function* (txCtx, transactionHooks) {
      const blockerChains = yield* unwrap(
        client.createChains({
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
        }),
      );
      return client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: null,
        blockers: blockerChains,
      });
    });

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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = createInProcessWorker({
      client,
      concurrency: 2,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value } }),
              );
            },
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction((txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
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

    const blocker = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "blocker",
        input: { value: 99 },
      }),
    );

    const [mainA, mainB] = await withTransaction((txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "main", input: { label: "A" }, blockers: [blocker] },
          { typeName: "main", input: { label: "B" }, blockers: [blocker] },
        ],
      }),
    );

    expect(mainA.status).toBe("running");
    expect(mainB.status).toBe("running");

    const jobA = await client.getJob({ id: mainA.id });
    const jobB = await client.getJob({ id: mainB.id });
    expect(jobA!.status).toBe("blocked");
    expect(jobB!.status).toBe("blocked");

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
    withTransactionOperation,
    transactionConcurrency,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    skip,
  }) => {
    if (transactionConcurrency === "serialized") return skip();
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    let readyBlockers = 0;
    const allBlockersReady = Promise.withResolvers<void>();
    const releaseBlockers = Promise.withResolvers<void>();

    const worker = createInProcessWorker({
      client,
      concurrency: blockerCount + mainCount,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ complete }) => {
              return withTransactionOperation(function* (txCtx, transactionHooks) {
                readyBlockers++;
                if (readyBlockers === blockerCount) allBlockersReady.resolve();
                yield* unwrap(releaseBlockers.promise);
                return complete({ ...txCtx, transactionHooks, output: null });
              });
            },
          },
          main: {
            attemptHandler: async ({ job, complete }) => {
              return withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.index } }),
              );
            },
          },
        },
      }),
    });

    const blockerChains = await withTransaction((txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: Array.from({ length: blockerCount }, () => ({
          typeName: "blocker",
          input: null,
        })),
      }),
    );

    const mainChains = await withTransaction((txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: Array.from({ length: mainCount }, (_, i) => ({
          typeName: "main",
          input: { index: i },
          blockers: blockerChains,
        })),
      }),
    );

    for (const chain of mainChains) {
      const job = await client.getJob({ id: chain.id });
      expect(job).toBeDefined();
      expect(job!.status).toBe("blocked");
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const worker = createInProcessWorker({
      client,
      concurrency: 2,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ complete }) =>
              withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ),
          },
          main: {
            attemptHandler: async ({ complete }) =>
              withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { done: true as const } }),
              ),
          },
        },
      }),
    });

    const blockerChain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "blocker",
        input: null,
      }),
    );

    const mainChain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: null,
        blockers: [blockerChain, blockerChain, blockerChain],
      }),
    );

    const mainJob = await client.getJob({ id: mainChain.id });
    expect(mainJob).toBeDefined();
    expect(mainJob!.status).toBe("blocked");

    await withWorkers([await worker.start()], async () => {
      const result = await client.awaitChain(mainChain, completionOptions);
      expect(result.output).toEqual({ done: true });
    });
  });

  it("batch-creates chains that repeat blocker ids in different positions", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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
        output: { results: number[] };
        blockers: { typeName: "blocker" }[];
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const worker = createInProcessWorker({
      client,
      concurrency: 2,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.value } }),
              ),
          },
          main: {
            attemptHandler: async ({ job, complete }) =>
              withTransaction((txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  output: { results: job.blockers.map((blocker) => blocker.output.result) },
                }),
              ),
          },
        },
      }),
    });

    const [first, second] = await withTransaction((txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "blocker", input: { value: 1 } },
          { typeName: "blocker", input: { value: 2 } },
        ],
      }),
    );

    const [mainA, mainB] = await withTransaction((txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "main", input: null, blockers: [first, second] },
          { typeName: "main", input: null, blockers: [second, first, second] },
        ],
      }),
    );

    expect((await client.getJob({ id: mainA.id }))!.status).toBe("blocked");
    expect((await client.getJob({ id: mainB.id }))!.status).toBe("blocked");

    await withWorkers([await worker.start()], async () => {
      const [resultA, resultB] = await Promise.all([
        client.awaitChain(mainA, completionOptions),
        client.awaitChain(mainB, completionOptions),
      ]);
      expect(resultA.output).toEqual({ results: [1, 2] });
      expect(resultB.output).toEqual({ results: [2, 1, 2] });
    });
  });

  it("raises scheduledAt to unblock time so blocked-since-creation jobs don't jump the queue", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const blockerHeld = Promise.withResolvers<void>();
    const releaseBlocker = Promise.withResolvers<void>();

    const mainChain = await withTransactionOperation(function* (txCtx, transactionHooks) {
      const blockerChain = yield* unwrap(
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: null,
        }),
      );
      return client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: null,
        blockers: [blockerChain],
      });
    });

    const mainAtCreation = await client.getJob({ id: mainChain.id });
    expect(mainAtCreation).toBeDefined();
    const creationScheduledAt = mainAtCreation!.scheduledAt.getTime();

    const worker = createInProcessWorker({
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
              return withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
          main: {
            attemptHandler: async ({ complete }) =>
              withTransaction((txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ),
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
