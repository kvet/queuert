import { type TestAPI, expectTypeOf } from "vitest";

import {
  type CompletedChain,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const chainsTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("handles chained jobs", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      linear: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "linear_next" };
      };
      linear_next: {
        input: { valueNext: number };
        continueWith: { typeName: "linear_next_next" };
      };
      linear_next_next: {
        input: { valueNextNext: number };
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
          linear: {
            attemptHandler: async ({ job, complete }) => {
              expect(job.id).toEqual(chain.id);
              expect(job.chainId).toEqual(chain.id);

              return complete(async ({ continueWith }) => {
                expectTypeOf<
                  Parameters<typeof continueWith>[0]["typeName"]
                >().toEqualTypeOf<"linear_next">();

                const continuedJob = await continueWith({
                  typeName: "linear_next",
                  input: { valueNext: job.input.value + 1 },
                });
                expectTypeOf(continuedJob.typeName).toEqualTypeOf<"linear_next">();
                expectTypeOf(continuedJob.status).toEqualTypeOf<"pending">();
                expect(continuedJob.typeName).toBe("linear_next");
                expect(continuedJob.status).toBe("pending");
                expect(continuedJob.chainId).toEqual(chain.id);
                return continuedJob;
              });
            },
          },
          linear_next: {
            attemptHandler: async ({ job, complete }) => {
              expect(job.id).not.toEqual(chain.id);
              expect(job.chainId).toEqual(chain.id);

              return complete(async ({ continueWith }) => {
                expectTypeOf<
                  Parameters<typeof continueWith>[0]["typeName"]
                >().toEqualTypeOf<"linear_next_next">();

                const continuedJob = await continueWith({
                  typeName: "linear_next_next",
                  input: { valueNextNext: job.input.valueNext + 1 },
                });
                expectTypeOf(continuedJob.typeName).toEqualTypeOf<"linear_next_next">();
                expectTypeOf(continuedJob.status).toEqualTypeOf<"pending">();
                return continuedJob;
              });
            },
          },
          linear_next_next: {
            attemptHandler: async ({ job, complete }) => {
              expect(job.id).not.toEqual(chain.id);
              expect(job.chainId).toEqual(chain.id);

              const result = await complete(async () => ({
                result: job.input.valueNextNext,
              }));
              expectTypeOf(result.typeName).toEqualTypeOf<"linear_next_next">();
              expectTypeOf(result.status).toEqualTypeOf<"completed">();
              return result;
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => {
        return client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "linear",
          input: { value: 1 },
        });
      }),
    );
    expectTypeOf<CompletedChain<typeof chain>["output"]>().toEqualTypeOf<{
      result: number;
    }>();
    expectTypeOf<
      Parameters<(typeof client)["startChain"]>[0]["typeName"]
    >().toEqualTypeOf<"linear">();
    expectTypeOf<Parameters<(typeof client)["getChain"]>[0]["typeName"]>().toEqualTypeOf<
      "linear" | undefined
    >();

    await withWorkers([await worker.start()], async () => {
      const finishedChain = await client.awaitChain(chain, completionOptions);

      expectTypeOf(finishedChain.output).toEqualTypeOf<{ result: number }>();
      expect(finishedChain.output).toEqual({ result: 3 });
    });
  });

  it("handles branched chains", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      main: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "branch1" | "branch2" };
      };
      branch1: {
        input: { valueBranched: number };
        output: { result1: number };
      };
      branch2: {
        input: { valueBranched: number };
        output: { result2: number };
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
          main: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async ({ continueWith }) => {
                expectTypeOf<Parameters<typeof continueWith>[0]["typeName"]>().toEqualTypeOf<
                  "branch1" | "branch2"
                >();

                return continueWith({
                  typeName: job.input.value % 2 === 0 ? "branch1" : "branch2",
                  input: { valueBranched: job.input.value },
                });
              });
            },
          },
          branch1: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async () => ({
                result1: job.input.valueBranched,
              }));
            },
          },
          branch2: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async () => ({
                result2: job.input.valueBranched,
              }));
            },
          },
        },
      }),
    });

    const evenChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: { value: 2 },
        }),
      ),
    );
    const oddChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: { value: 3 },
        }),
      ),
    );
    expectTypeOf<CompletedChain<typeof evenChain>["output"]>().toEqualTypeOf<
      { result1: number } | { result2: number }
    >();
    expectTypeOf<CompletedChain<typeof oddChain>["output"]>().toEqualTypeOf<
      { result1: number } | { result2: number }
    >();

    await withWorkers([await worker.start()], async () => {
      const [succeededJobEven, succeededJobOdd] = await Promise.all([
        client.awaitChain(evenChain, completionOptions),
        client.awaitChain(oddChain, completionOptions),
      ]);

      expectTypeOf(succeededJobEven.output).toEqualTypeOf<
        { result1: number } | { result2: number }
      >();
      expectTypeOf(succeededJobOdd.output).toEqualTypeOf<
        { result1: number } | { result2: number }
      >();
      expect(succeededJobEven.output).toEqual({ result1: 2 });
      expect(succeededJobOdd.output).toEqual({ result2: 3 });
    });
  });

  it("handles branched chains with different inputs", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      main: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "branch1" | "branch2" };
      };
      branch1: {
        input: { valueBranched1: number };
        output: { result: number };
      };
      branch2: {
        input: { valueBranched2: number };
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
          main: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async ({ continueWith }) => {
                expectTypeOf<Parameters<typeof continueWith>[0]["typeName"]>().toEqualTypeOf<
                  "branch1" | "branch2"
                >();

                if (false as boolean) {
                  void continueWith({
                    typeName: "branch1",
                    // @ts-expect-error typeName/input mismatch must be rejected
                    input: { valueBranched2: job.input.value },
                  });
                }

                return continueWith(
                  job.input.value % 2 === 0
                    ? {
                        typeName: "branch1",
                        input: { valueBranched1: job.input.value },
                      }
                    : {
                        typeName: "branch2",
                        input: { valueBranched2: job.input.value },
                      },
                );
              });
            },
          },
          branch1: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async () => ({
                result: job.input.valueBranched1,
              }));
            },
          },
          branch2: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async () => ({
                result: job.input.valueBranched2,
              }));
            },
          },
        },
      }),
    });

    const evenChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: { value: 2 },
        }),
      ),
    );
    const oddChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: { value: 3 },
        }),
      ),
    );
    expectTypeOf<CompletedChain<typeof evenChain>["output"]>().toEqualTypeOf<{
      result: number;
    }>();
    expectTypeOf<CompletedChain<typeof oddChain>["output"]>().toEqualTypeOf<{
      result: number;
    }>();

    await withWorkers([await worker.start()], async () => {
      const [succeededJobEven, succeededJobOdd] = await Promise.all([
        client.awaitChain(evenChain, completionOptions),
        client.awaitChain(oddChain, completionOptions),
      ]);

      expectTypeOf(succeededJobEven.output).toEqualTypeOf<{ result: number }>();
      expectTypeOf(succeededJobOdd.output).toEqualTypeOf<{ result: number }>();
      expect(succeededJobEven.output).toEqual({ result: 2 });
      expect(succeededJobOdd.output).toEqual({ result: 3 });
    });
  });

  it("handles loops", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      loop: {
        entry: true;
        input: { counter: number };
        output: { done: true };
        continueWith: { typeName: "loop" };
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
          loop: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async ({ continueWith }) => {
                expectTypeOf<
                  Parameters<typeof continueWith>[0]["typeName"]
                >().toEqualTypeOf<"loop">();

                return job.input.counter < 3
                  ? continueWith({
                      typeName: "loop",
                      input: { counter: job.input.counter + 1 },
                    })
                  : { done: true };
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
          typeName: "loop",
          input: { counter: 0 },
        }),
      ),
    );
    expectTypeOf<CompletedChain<typeof chain>["output"]>().toEqualTypeOf<{
      done: true;
    }>();

    await withWorkers([await worker.start()], async () => {
      const succeededChain = await client.awaitChain(chain, completionOptions);
      expect(succeededChain.output).toEqual({ done: true });
    });
  });

  it("handles go-to", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      start: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "end" };
      };
      end: {
        input: { result: number };
        output: { finalResult: number };
        continueWith: { typeName: "start" };
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
          start: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async ({ continueWith }) => {
                expectTypeOf<
                  Parameters<typeof continueWith>[0]["typeName"]
                >().toEqualTypeOf<"end">();

                return continueWith({
                  typeName: "end",
                  input: { result: job.input.value + 1 },
                });
              });
            },
          },
          end: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: "atomic" });
              return complete(async ({ continueWith }) => {
                expectTypeOf<
                  Parameters<typeof continueWith>[0]["typeName"]
                >().toEqualTypeOf<"start">();

                if (job.input.result < 3) {
                  return continueWith({
                    typeName: "start",
                    input: { value: job.input.result },
                  });
                } else {
                  return { finalResult: job.input.result };
                }
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
          typeName: "start",
          input: { value: 0 },
        }),
      ),
    );
    expectTypeOf<CompletedChain<typeof chain>["output"]>().toEqualTypeOf<{
      finalResult: number;
    }>();

    await withWorkers([await worker.start()], async () => {
      const succeededChain = await client.awaitChain(chain, completionOptions);

      expectTypeOf(succeededChain.output).toEqualTypeOf<{ finalResult: number }>();
      expect(succeededChain.output).toEqual({ finalResult: 3 });
    });
  });

  it("correctly types chainTypeName for jobs reachable from multiple chains", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      entryA: { entry: true; input: { fromA: true }; continueWith: { typeName: "shared" } };
      entryB: { entry: true; input: { fromB: true }; continueWith: { typeName: "shared" } };
      shared: { input: { data: number }; output: { done: true } };
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
          entryA: {
            attemptHandler: async ({ job, complete }) => {
              // Entry job's chainTypeName should match its own typeName
              expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA">();
              expect(job.chainTypeName).toBe("entryA");
              return complete(async ({ continueWith }) =>
                continueWith({ typeName: "shared", input: { data: 1 } }),
              );
            },
          },
          entryB: {
            attemptHandler: async ({ job, complete }) => {
              // Entry job's chainTypeName should match its own typeName
              expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryB">();
              expect(job.chainTypeName).toBe("entryB");
              return complete(async ({ continueWith }) =>
                continueWith({ typeName: "shared", input: { data: 2 } }),
              );
            },
          },
          shared: {
            attemptHandler: async ({ job, complete }) => {
              // Shared job's chainTypeName should be union of both entry types
              expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA" | "entryB">();
              expect(["entryA", "entryB"]).toContain(job.chainTypeName);
              return complete(async () => ({ done: true }));
            },
          },
        },
      }),
    });

    const chainA = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "entryA",
          input: { fromA: true },
        }),
      ),
    );
    const chainB = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "entryB",
          input: { fromB: true },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const [resultA, resultB] = await Promise.all([
        client.awaitChain(chainA, { pollIntervalMs: 100, timeoutMs: 5000 }),
        client.awaitChain(chainB, { pollIntervalMs: 100, timeoutMs: 5000 }),
      ]);
      expect(resultA.output).toEqual({ done: true });
      expect(resultB.output).toEqual({ done: true });
    });
  });

  it("independent chains created during job processing do not inherit context", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      parent: {
        entry: true;
        input: { value: number };
        output: { childChainId: string };
      };
      independent: {
        entry: true;
        input: { fromParent: number };
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
    let independentChainId: string | null = null;

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          parent: {
            attemptHandler: async ({ job, complete }) => {
              // Create an independent chain during job processing
              const independentChain = await withTransactionHooks(async (transactionHooks) =>
                withTransaction(async (txCtx) =>
                  client.startChain({
                    ...txCtx,
                    transactionHooks,
                    typeName: "independent",
                    input: { fromParent: job.input.value },
                  }),
                ),
              );

              independentChainId = independentChain.id;

              return complete(async () => ({
                childChainId: independentChain.id,
              }));
            },
          },
          independent: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({
                result: job.input.fromParent * 2,
              }));
            },
          },
        },
      }),
    });

    const parentChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "parent",
          input: { value: 42 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      // Wait for both chains to complete
      const [completedParent] = await Promise.all([
        client.awaitChain(parentChain, completionOptions),
        // Wait for independent chain using a polling approach since we don't have its reference yet
        (async () => {
          // oxlint-disable-next-line no-unmodified-loop-condition -- modified asynchronously via event handler
          while (!independentChainId) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return client.awaitChain(
            { id: independentChainId, typeName: "independent" },
            completionOptions,
          );
        })(),
      ]);

      expect(completedParent.output.childChainId).toBe(independentChainId);
    });
  });

  // TODO: add a test where a chain is distributed across multiple workers
};
