import { type TestAPI, expectTypeOf } from "vitest";
import { type JobChain, createClient, createInProcessWorker, defineJobTypes } from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const blockerChainsTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("handles long blocker chains", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });
    let blockerChainId: string;

    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
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
    });

    expectTypeOf<
      Parameters<typeof client.startJobChain<"main">>[0]["blockers"]
    >().not.toBeUndefined();

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) => {
        const dependencyJobChain = await client.startJobChain({
          ...txContext,
          typeName: "blocker",
          input: { value: 0 },
        });
        blockerChainId = dependencyJobChain.id;

        const jobChain = await client.startJobChain({
          ...txContext,
          typeName: "main",
          input: { start: true },
          blockers: [dependencyJobChain],
        });

        return jobChain;
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededJobChain = await client.waitForJobChainCompletion(jobChain, completionOptions);

      expect(succeededJobChain.output).toEqual({ finalResult: 2 });
    });
  });

  it("handles completed blocker chains", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
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
    });

    const blockerJobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "blocker",
          input: { value: 1 },
        }),
      ),
    );
    const completedBlockerJobChain = await runInTransaction(async (txContext) =>
      client.completeJobChain({
        ...txContext,
        ...blockerJobChain,
        complete: async ({ job, complete }) => {
          return complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "main",
          input: null,
          blockers: [completedBlockerJobChain],
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededJobChain = await client.waitForJobChainCompletion(jobChain, completionOptions);

      expect(succeededJobChain.output).toEqual({
        finalResult: completedBlockerJobChain.output.result,
      });
    });
  });

  it("independent chains spawned during processing do not inherit context", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });
    const childJobChains: JobChain<string, "inner", null, null>[] = [];

    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
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
            await prepare({ mode: "staged" }, async (txContext) => {
              childJobChains.push(
                await client.withNotify(async () =>
                  client.startJobChain({
                    ...txContext,
                    typeName: "inner",
                    input: null,
                  }),
                ),
              );
            });

            childJobChains.push(
              await client.withNotify(async () =>
                runInTransaction(async (txContext) =>
                  client.startJobChain({
                    ...txContext,
                    typeName: "inner",
                    input: null,
                  }),
                ),
              ),
            );

            return complete(async (txContext) => {
              childJobChains.push(
                await client.withNotify(async () =>
                  client.startJobChain({
                    ...txContext,
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
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "outer",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);

      const succeededChildJobChains = await Promise.all(
        childJobChains.map(async (chain) =>
          client.waitForJobChainCompletion(chain, completionOptions),
        ),
      );

      expect(succeededChildJobChains).toHaveLength(3);
    });
  });

  it("handles chains that are distributed across workers", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });
    const worker1 = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processDefaults: {
        pollIntervalMs: 100,
      },
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
    });
    const worker2 = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processDefaults: {
        pollIntervalMs: 100,
      },
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
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      const finishedJobChain = await client.waitForJobChainCompletion(jobChain, completionOptions);

      expect(finishedJobChain.output).toEqual({ result: 3 });
    });
  });

  it("handles multiple blocker chains", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
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
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) => {
        const blockerChains = await Promise.all(
          Array.from({ length: 5 }, async (_, i) =>
            client.startJobChain({
              ...txContext,
              typeName: "blocker",
              input: { value: i + 1 },
            }),
          ),
        );
        return client.startJobChain({
          ...txContext,
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
      const succeededJobChain = await client.waitForJobChainCompletion(jobChain, completionOptions);

      expect(succeededJobChain.output).toEqual({
        finalResult: Array.from({ length: 5 }, (_, i) => i + 1),
      });
    });
  });

  it("continueWith supports blockers", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
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
            return complete(async ({ continueWith, ...txContext }) => {
              const blockerChain = await client.startJobChain({
                ...txContext,
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
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "first",
          input: { id: "test-123" },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededJobChain = await client.waitForJobChainCompletion(jobChain, completionOptions);

      expect(succeededJobChain.output).toEqual({ finalResult: 50 });
    });
  });
};
