import { type TestAPI, expectTypeOf } from "vitest";
import {
  type CompletedJobChain,
  createQueuertClient,
  createQueuertInProcessWorker,
  defineJobTypes,
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
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectLogs,
    expectMetrics,
    expectHistograms,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
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

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });
    const originIds: string[] = [];

    const worker = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      jobTypeProcessors: {
        linear: {
          process: async ({ job, complete }) => {
            expect(job.id).toEqual(jobChain.id);
            expect(job.chainId).toEqual(jobChain.id);
            expect(job.originId).toBeNull();
            expect(job.rootChainId).toEqual(jobChain.id);
            originIds.push(job.id);

            return complete(async ({ continueWith }) => {
              expectTypeOf<
                Parameters<typeof continueWith>[0]["typeName"]
              >().toEqualTypeOf<"linear_next">();

              const continuedJob = await continueWith({
                typeName: "linear_next",
                input: { valueNext: job.input.value + 1 },
              });
              expectTypeOf(continuedJob.typeName).toEqualTypeOf<"linear_next">();
              expectTypeOf(continuedJob.status).toEqualTypeOf<"pending" | "blocked">();
              expect(continuedJob.typeName).toBe("linear_next");
              expect(continuedJob.status).toBeOneOf(["pending", "blocked"]);
              expect(continuedJob.chainId).toEqual(jobChain.id);
              return continuedJob;
            });
          },
        },
        linear_next: {
          process: async ({ job, complete }) => {
            expect(job.id).not.toEqual(jobChain.id);
            expect(job.chainId).toEqual(jobChain.id);
            expect(job.originId).toEqual(originIds[0]);
            expect(job.rootChainId).toEqual(jobChain.id);
            originIds.push(job.id);

            return complete(async ({ continueWith }) => {
              expectTypeOf<
                Parameters<typeof continueWith>[0]["typeName"]
              >().toEqualTypeOf<"linear_next_next">();

              const continuedJob = await continueWith({
                typeName: "linear_next_next",
                input: { valueNextNext: job.input.valueNext + 1 },
              });
              expectTypeOf(continuedJob.typeName).toEqualTypeOf<"linear_next_next">();
              expectTypeOf(continuedJob.status).toEqualTypeOf<"pending" | "blocked">();
              return continuedJob;
            });
          },
        },
        linear_next_next: {
          process: async ({ job, complete }) => {
            expect(job.id).not.toEqual(jobChain.id);
            expect(job.chainId).toEqual(jobChain.id);
            expect(job.originId).toEqual(originIds[1]);
            expect(job.rootChainId).toEqual(jobChain.id);

            const result = await complete(async () => ({
              result: job.input.valueNextNext,
            }));
            expectTypeOf(result.typeName).toEqualTypeOf<"linear_next_next">();
            expectTypeOf(result.status).toEqualTypeOf<"completed">();
            return result;
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) => {
        return client.startJobChain({
          ...txContext,
          typeName: "linear",
          input: { value: 1 },
        });
      }),
    );
    expectTypeOf<CompletedJobChain<typeof jobChain>["output"]>().toEqualTypeOf<{
      result: number;
    }>();
    expectTypeOf<
      Parameters<(typeof client)["startJobChain"]>[0]["typeName"]
    >().toEqualTypeOf<"linear">();
    expectTypeOf<
      Parameters<(typeof client)["getJobChain"]>[0]["typeName"]
    >().toEqualTypeOf<"linear">();

    await withWorkers([await worker.start()], async () => {
      const finishedJobChain = await client.waitForJobChainCompletion(jobChain, completionOptions);

      expectTypeOf(finishedJobChain.output).toEqualTypeOf<{ result: number }>();
      expect(finishedJobChain.output).toEqual({ result: 3 });
    });

    expectLogs([
      { type: "job_chain_created", data: { typeName: "linear" } },
      { type: "job_created", data: { typeName: "linear" } },
      { type: "worker_started" },
      { type: "job_attempt_started", data: { typeName: "linear" } },
      {
        type: "job_created",
        data: {
          typeName: "linear_next",
          chainId: jobChain.id,
          chainTypeName: "linear",
          rootChainId: jobChain.id,
          originId: originIds[0],
        },
      },
      { type: "job_attempt_completed", data: { typeName: "linear" } },
      { type: "job_completed", data: { typeName: "linear" } },
      { type: "job_attempt_started", data: { typeName: "linear_next" } },
      {
        type: "job_created",
        data: {
          typeName: "linear_next_next",
          chainId: jobChain.id,
          chainTypeName: "linear",
          rootChainId: jobChain.id,
          originId: originIds[1],
        },
      },
      { type: "job_attempt_completed", data: { typeName: "linear_next" } },
      { type: "job_completed", data: { typeName: "linear_next" } },
      { type: "job_attempt_started", data: { typeName: "linear_next_next" } },
      { type: "job_attempt_completed", data: { typeName: "linear_next_next" } },
      { type: "job_completed", data: { typeName: "linear_next_next" } },
      { type: "job_chain_completed", data: { typeName: "linear" } },
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);

    await expectMetrics([
      { method: "jobChainCreated", args: { typeName: "linear" } },
      { method: "jobCreated", args: { typeName: "linear" } },
      { method: "workerStarted" },
      { method: "jobAttemptStarted", args: { typeName: "linear" } },
      { method: "jobCreated", args: { typeName: "linear_next", chainTypeName: "linear" } },
      { method: "jobAttemptCompleted", args: { typeName: "linear" } },
      { method: "jobCompleted", args: { typeName: "linear" } },
      { method: "jobAttemptStarted", args: { typeName: "linear_next" } },
      { method: "jobCreated", args: { typeName: "linear_next_next", chainTypeName: "linear" } },
      { method: "jobAttemptCompleted", args: { typeName: "linear_next" } },
      { method: "jobCompleted", args: { typeName: "linear_next" } },
      { method: "jobAttemptStarted", args: { typeName: "linear_next_next" } },
      { method: "jobAttemptCompleted", args: { typeName: "linear_next_next" } },
      { method: "jobCompleted", args: { typeName: "linear_next_next" } },
      { method: "jobChainCompleted", args: { typeName: "linear" } },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);

    await expectHistograms([
      { method: "jobDuration", args: { typeName: "linear" } },
      { method: "jobAttemptDuration", args: { typeName: "linear" } },
      { method: "jobDuration", args: { typeName: "linear_next" } },
      { method: "jobAttemptDuration", args: { typeName: "linear_next" } },
      { method: "jobDuration", args: { typeName: "linear_next_next" } },
      { method: "jobChainDuration", args: { typeName: "linear" } },
      { method: "jobAttemptDuration", args: { typeName: "linear_next_next" } },
    ]);
  });

  it("handles branched chains", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
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

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });
    const worker = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      jobTypeProcessors: {
        main: {
          process: async ({ job, prepare, complete }) => {
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
          process: async ({ job, prepare, complete }) => {
            await prepare({ mode: "atomic" });
            return complete(async () => ({
              result1: job.input.valueBranched,
            }));
          },
        },
        branch2: {
          process: async ({ job, prepare, complete }) => {
            await prepare({ mode: "atomic" });
            return complete(async () => ({
              result2: job.input.valueBranched,
            }));
          },
        },
      },
    });

    const evenJobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "main",
          input: { value: 2 },
        }),
      ),
    );
    const oddJobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "main",
          input: { value: 3 },
        }),
      ),
    );
    expectTypeOf<CompletedJobChain<typeof evenJobChain>["output"]>().toEqualTypeOf<
      { result1: number } | { result2: number }
    >();
    expectTypeOf<CompletedJobChain<typeof oddJobChain>["output"]>().toEqualTypeOf<
      { result1: number } | { result2: number }
    >();

    await withWorkers([await worker.start()], async () => {
      const [succeededJobEven, succeededJobOdd] = await Promise.all([
        client.waitForJobChainCompletion(evenJobChain, completionOptions),
        client.waitForJobChainCompletion(oddJobChain, completionOptions),
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

  it("handles loops", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
      loop: {
        entry: true;
        input: { counter: number };
        output: { done: true };
        continueWith: { typeName: "loop" };
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });
    const worker = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      jobTypeProcessors: {
        loop: {
          process: async ({ job, prepare, complete }) => {
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
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "loop",
          input: { counter: 0 },
        }),
      ),
    );
    expectTypeOf<CompletedJobChain<typeof jobChain>["output"]>().toEqualTypeOf<{
      done: true;
    }>();

    await withWorkers([await worker.start()], async () => {
      const succeededJobChain = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(succeededJobChain.output).toEqual({ done: true });
    });
  });

  it("handles go-to", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
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

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });
    const worker = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      jobTypeProcessors: {
        start: {
          process: async ({ job, prepare, complete }) => {
            await prepare({ mode: "atomic" });
            return complete(async ({ continueWith }) => {
              expectTypeOf<Parameters<typeof continueWith>[0]["typeName"]>().toEqualTypeOf<"end">();

              return continueWith({
                typeName: "end",
                input: { result: job.input.value + 1 },
              });
            });
          },
        },
        end: {
          process: async ({ job, prepare, complete }) => {
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
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "start",
          input: { value: 0 },
        }),
      ),
    );
    expectTypeOf<CompletedJobChain<typeof jobChain>["output"]>().toEqualTypeOf<{
      finalResult: number;
    }>();

    await withWorkers([await worker.start()], async () => {
      const succeededJobChain = await client.waitForJobChainCompletion(jobChain, completionOptions);

      expectTypeOf(succeededJobChain.output).toEqualTypeOf<{ finalResult: number }>();
      expect(succeededJobChain.output).toEqual({ finalResult: 3 });
    });
  });

  it("correctly types chainTypeName for jobs reachable from multiple chains", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
      entryA: { entry: true; input: { fromA: true }; continueWith: { typeName: "shared" } };
      entryB: { entry: true; input: { fromB: true }; continueWith: { typeName: "shared" } };
      shared: { input: { data: number }; output: { done: true } };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });
    const worker = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      jobTypeProcessors: {
        entryA: {
          process: async ({ job, complete }) => {
            // Entry job's chainTypeName should match its own typeName
            expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA">();
            expect(job.chainTypeName).toBe("entryA");
            return complete(async ({ continueWith }) =>
              continueWith({ typeName: "shared", input: { data: 1 } }),
            );
          },
        },
        entryB: {
          process: async ({ job, complete }) => {
            // Entry job's chainTypeName should match its own typeName
            expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryB">();
            expect(job.chainTypeName).toBe("entryB");
            return complete(async ({ continueWith }) =>
              continueWith({ typeName: "shared", input: { data: 2 } }),
            );
          },
        },
        shared: {
          process: async ({ job, complete }) => {
            // Shared job's chainTypeName should be union of both entry types
            expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA" | "entryB">();
            expect(["entryA", "entryB"]).toContain(job.chainTypeName);
            return complete(async () => ({ done: true }));
          },
        },
      },
    });

    const chainA = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({ ...txContext, typeName: "entryA", input: { fromA: true } }),
      ),
    );
    const chainB = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({ ...txContext, typeName: "entryB", input: { fromB: true } }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const [resultA, resultB] = await Promise.all([
        client.waitForJobChainCompletion(chainA, { pollIntervalMs: 100, timeoutMs: 5000 }),
        client.waitForJobChainCompletion(chainB, { pollIntervalMs: 100, timeoutMs: 5000 }),
      ]);
      expect(resultA.output).toEqual({ done: true });
      expect(resultB.output).toEqual({ done: true });
    });
  });

  it("independent chains created during job processing do not inherit context", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
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

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });
    let independentChainId: string | null = null;
    let independentChainRootChainId: string | null = null;
    let independentChainOriginId: string | null = null;

    const worker = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      jobTypeProcessors: {
        parent: {
          process: async ({ job, complete }) => {
            // Create an independent chain during job processing
            const independentChain = await client.withNotify(async () =>
              runInTransaction(async (txContext) =>
                client.startJobChain({
                  ...txContext,
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
          process: async ({ job, complete }) => {
            // Capture the chain context for verification
            independentChainRootChainId = job.rootChainId;
            independentChainOriginId = job.originId;

            return complete(async () => ({
              result: job.input.fromParent * 2,
            }));
          },
        },
      },
    });

    const parentChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "parent",
          input: { value: 42 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      // Wait for both chains to complete
      const [completedParent] = await Promise.all([
        client.waitForJobChainCompletion(parentChain, completionOptions),
        // Wait for independent chain using a polling approach since we don't have its reference yet
        (async () => {
          while (!independentChainId) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return client.waitForJobChainCompletion(
            { id: independentChainId, typeName: "independent" } as any,
            completionOptions,
          );
        })(),
      ]);

      expect(completedParent.output.childChainId).toBe(independentChainId);

      // The independent chain should NOT have inherited context from parent
      // rootChainId should be self-referential (its own id)
      expect(independentChainRootChainId).toBe(independentChainId);
      // originId should be null (not linked to parent job)
      expect(independentChainOriginId).toBeNull();

      // Verify they are truly independent - parent's rootChainId is different
      expect(independentChainRootChainId).not.toBe(parentChain.id);
    });
  });

  // TODO: add a test where a chain is distributed across multiple workers
};
