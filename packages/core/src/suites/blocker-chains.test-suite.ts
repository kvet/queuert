import { expectTypeOf, TestAPI } from "vitest";
import { createQueuert, defineJobTypes, JobChain } from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

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
    expectLogs,
    expectMetrics,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
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
      }>(),
    });

    expectTypeOf<
      Parameters<typeof queuert.startJobChain<"main">>[0]["startBlockers"]
    >().not.toBeUndefined();

    let mainChainId: string;
    let blockerChainId: string;
    let originId: string;

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "blocker",
        process: async ({ job, complete }) => {
          expect(job.chainId).toEqual(blockerChainId);
          expect(job.rootChainId).toEqual(mainChainId);
          expect(job.originId).toEqual(originId);
          originId = job.id;

          return complete(async ({ continueWith }) =>
            job.input.value < 1
              ? continueWith({
                  typeName: "blocker",
                  input: { value: job.input.value + 1 },
                })
              : { done: true },
          );
        },
      })
      .implementJobType({
        typeName: "main",
        process: async ({
          job: {
            blockers: [blocker],
            id,
            input,
          },
          complete,
        }) => {
          expectTypeOf<(typeof blocker)["output"]>().toEqualTypeOf<{
            done: true;
          }>();

          expectTypeOf<(typeof blocker)["originId"]>().toEqualTypeOf<string | null>();
          expect(blocker.originId).toEqual(id);

          return complete(async () => ({
            finalResult: (blocker.output.done ? 1 : 0) + (input.start ? 1 : 0),
          }));
        },
      });

    const jobChain = await queuert.withNotify(async () =>
      runInTransaction(async (txContext) => {
        const jobChain = await queuert.startJobChain({
          ...txContext,
          typeName: "main",
          input: { start: true },
          startBlockers: async () => {
            const dependencyJobChain = await queuert.startJobChain({
              ...txContext,
              typeName: "blocker",
              input: { value: 0 },
            });
            blockerChainId = dependencyJobChain.id;
            return [dependencyJobChain];
          },
        });

        mainChainId = jobChain.id;
        originId = jobChain.id;

        return jobChain;
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededJobChain = await queuert.waitForJobChainCompletion(
        jobChain,
        completionOptions,
      );

      expect(succeededJobChain.output).toEqual({ finalResult: 2 });
    });

    expectLogs([
      // blocker chain created
      {
        type: "job_chain_created",
        data: {
          typeName: "blocker",
          rootChainId: mainChainId!,
          originId: mainChainId!,
        },
      },
      { type: "job_created", data: { typeName: "blocker" } },
      // main chain created
      { type: "job_chain_created", data: { typeName: "main" } },
      {
        type: "job_created",
        data: {
          typeName: "main",
          blockers: [
            {
              id: blockerChainId!,
              typeName: "blocker",
              originId: mainChainId!,
              rootChainId: mainChainId!,
            },
          ],
        },
      },
      // main job is blocked by the incomplete blocker chain
      {
        type: "job_blocked",
        data: {
          typeName: "main",
          blockedByChains: [
            {
              id: blockerChainId!,
              typeName: "blocker",
              originId: mainChainId!,
              rootChainId: mainChainId!,
            },
          ],
        },
      },
      // worker started
      { type: "worker_started" },
      // first blocker job processed
      { type: "job_attempt_started", data: { typeName: "blocker" } },
      { type: "job_created", data: { typeName: "blocker" } },
      { type: "job_attempt_completed", data: { typeName: "blocker" } },
      { type: "job_completed", data: { typeName: "blocker" } },
      // second blocker job processed, chain completes
      { type: "job_attempt_started", data: { typeName: "blocker" } },
      { type: "job_attempt_completed", data: { typeName: "blocker" } },
      { type: "job_completed", data: { typeName: "blocker" } },
      { type: "job_chain_completed", data: { typeName: "blocker" } },
      // main job unblocked and completed
      {
        type: "job_unblocked",
        data: {
          typeName: "main",
          unblockedByChain: {
            id: blockerChainId!,
            typeName: "blocker",
            originId: mainChainId!,
            rootChainId: mainChainId!,
          },
        },
      },
      { type: "job_attempt_started", data: { typeName: "main" } },
      { type: "job_attempt_completed", data: { typeName: "main" } },
      { type: "job_completed", data: { typeName: "main" } },
      { type: "job_chain_completed", data: { typeName: "main" } },
      // worker stopping
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);

    await expectMetrics([
      // blocker chain created
      { method: "jobChainCreated", args: { typeName: "blocker" } },
      { method: "jobCreated", args: { typeName: "blocker" } },
      // main chain created
      { method: "jobChainCreated", args: { typeName: "main" } },
      { method: "jobCreated", args: { typeName: "main" } },
      // main job is blocked
      { method: "jobBlocked", args: { typeName: "main" } },
      // worker started
      { method: "workerStarted" },
      // first blocker job processed
      { method: "jobAttemptStarted", args: { typeName: "blocker" } },
      { method: "jobCreated", args: { typeName: "blocker" } },
      { method: "jobAttemptCompleted", args: { typeName: "blocker" } },
      { method: "jobCompleted", args: { typeName: "blocker" } },
      // second blocker job processed, chain completes
      { method: "jobAttemptStarted", args: { typeName: "blocker" } },
      { method: "jobAttemptCompleted", args: { typeName: "blocker" } },
      { method: "jobCompleted", args: { typeName: "blocker" } },
      { method: "jobChainCompleted", args: { typeName: "blocker" } },
      // main job unblocked and completed
      { method: "jobUnblocked", args: { typeName: "main" } },
      { method: "jobAttemptStarted", args: { typeName: "main" } },
      { method: "jobAttemptCompleted", args: { typeName: "main" } },
      { method: "jobCompleted", args: { typeName: "main" } },
      { method: "jobChainCompleted", args: { typeName: "main" } },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);
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
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
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
      }>(),
    });

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "blocker",
        process: async ({ job, complete }) => {
          expect(job.originId).toBeNull();

          return complete(async () => ({ result: job.input.value }));
        },
      })
      .implementJobType({
        typeName: "main",
        process: async ({
          job: {
            blockers: [blocker],
          },
          complete,
        }) => {
          // Blocker originId is null since it was created independently
          expect(blocker.originId).toBeNull();

          return complete(async () => ({
            finalResult: blocker.output.result,
          }));
        },
      });

    const blockerJobChain = await queuert.withNotify(async () =>
      runInTransaction(async (txContext) =>
        queuert.startJobChain({
          ...txContext,
          typeName: "blocker",
          input: { value: 1 },
        }),
      ),
    );
    const completedBlockerJobChain = await runInTransaction(async (txContext) =>
      queuert.completeJobChain({
        ...txContext,
        ...blockerJobChain,
        complete: async ({ job, complete }) => {
          return complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );

    const jobChain = await queuert.withNotify(async () =>
      runInTransaction(async (txContext) =>
        queuert.startJobChain({
          ...txContext,
          typeName: "main",
          input: null,
          startBlockers: async () => [completedBlockerJobChain],
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededJobChain = await queuert.waitForJobChainCompletion(
        jobChain,
        completionOptions,
      );

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
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
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
      }>(),
    });

    const childJobChains: JobChain<string, "inner", null, null>[] = [];

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "inner",
        process: async ({ job, complete }) => {
          return complete(async () => {
            // Independent chains should NOT inherit originId from parent
            expect(job.originId).toBeNull();
            // Independent chains should have self-referential rootChainId
            expect(job.rootChainId).toEqual(job.id);
            return null;
          });
        },
      })
      .implementJobType({
        typeName: "outer",
        process: async ({ job, prepare, complete }) => {
          expect(job.originId).toBeNull();

          await prepare({ mode: "staged" }, async (txContext) => {
            childJobChains.push(
              await queuert.withNotify(async () =>
                queuert.startJobChain({
                  ...txContext,
                  typeName: "inner",
                  input: null,
                }),
              ),
            );
          });

          childJobChains.push(
            await queuert.withNotify(async () =>
              runInTransaction(async (txContext) =>
                queuert.startJobChain({
                  ...txContext,
                  typeName: "inner",
                  input: null,
                }),
              ),
            ),
          );

          return complete(async (txContext) => {
            childJobChains.push(
              await queuert.withNotify(async () =>
                queuert.startJobChain({
                  ...txContext,
                  typeName: "inner",
                  input: null,
                }),
              ),
            );

            return null;
          });
        },
      });

    const jobChain = await queuert.withNotify(async () =>
      runInTransaction(async (txContext) =>
        queuert.startJobChain({
          ...txContext,
          typeName: "outer",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await queuert.waitForJobChainCompletion(jobChain, completionOptions);

      const succeededChildJobChains = await Promise.all(
        childJobChains.map(async (chain) =>
          queuert.waitForJobChainCompletion(chain, completionOptions),
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
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          continueWith: { typeName: "finish" };
        };
        finish: {
          input: { valueNext: number };
          output: { result: number };
        };
      }>(),
    });

    const worker1 = queuert.createWorker().implementJobType({
      typeName: "test",
      process: async ({ job, prepare, complete }) => {
        await prepare({ mode: "atomic" });
        return complete(async ({ continueWith }) =>
          continueWith({
            typeName: "finish",
            input: { valueNext: job.input.value + 1 },
          }),
        );
      },
    });

    const worker2 = queuert.createWorker().implementJobType({
      typeName: "finish",
      process: async ({ job, prepare, complete }) => {
        await prepare({ mode: "atomic" });
        return complete(async () => ({
          result: job.input.valueNext + 1,
        }));
      },
    });

    const jobChain = await queuert.withNotify(async () =>
      runInTransaction(async (txContext) =>
        queuert.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers(
      [
        await worker1.start({
          pollIntervalMs: 100,
        }),
        await worker2.start({
          pollIntervalMs: 100,
        }),
      ],
      async () => {
        const finishedJobChain = await queuert.waitForJobChainCompletion(
          jobChain,
          completionOptions,
        );

        expect(finishedJobChain.output).toEqual({ result: 3 });
      },
    );
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
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
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
      }>(),
    });

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "blocker",
        process: async ({ job, complete }) => {
          return complete(async () => ({ result: job.input.value }));
        },
      })
      .implementJobType({
        typeName: "main",
        process: async ({ job, complete }) => {
          return complete(async () => ({
            finalResult: job.blockers.map((blocker) => blocker.output.result),
          }));
        },
      });

    const jobChain = await queuert.withNotify(async () =>
      runInTransaction(async (txContext) =>
        queuert.startJobChain({
          ...txContext,
          typeName: "main",
          input: null,
          startBlockers: async () => {
            const blockers = await Promise.all(
              Array.from({ length: 5 }, async (_, i) =>
                queuert.startJobChain({
                  ...txContext,
                  typeName: "blocker",
                  input: { value: i + 1 },
                }),
              ),
            );
            // Assert non-empty tuple type - length 5 is guaranteed by Array.from
            return blockers as [(typeof blockers)[number], ...(typeof blockers)[number][]];
          },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededJobChain = await queuert.waitForJobChainCompletion(
        jobChain,
        completionOptions,
      );

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
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
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
      }>(),
    });

    let blockerRootChainId: string;
    let blockerOriginId: string | null;
    let secondJobId: string;

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "blocker",
        process: async ({ job, prepare, complete }) => {
          blockerRootChainId = job.rootChainId;
          blockerOriginId = job.originId;
          await prepare({ mode: "atomic" });
          return complete(async () => ({ result: job.input.value * 10 }));
        },
      })
      .implementJobType({
        typeName: "first",
        process: async ({ job, prepare, complete }) => {
          await prepare({ mode: "atomic" });
          return complete(async ({ continueWith, ...txContext }) => {
            const continuedJob = await continueWith({
              typeName: "second",
              input: { fromFirst: job.input.id },
              startBlockers: async () => [
                await queuert.startJobChain({
                  ...txContext,
                  typeName: "blocker",
                  input: { value: 5 },
                }),
              ],
            });
            secondJobId = continuedJob.id;
            return continuedJob;
          });
        },
      })
      .implementJobType({
        typeName: "second",
        process: async ({
          job: {
            blockers: [blocker],
          },
          prepare,
          complete,
        }) => {
          await prepare({ mode: "atomic" });
          return complete(async () => ({ finalResult: blocker.output.result }));
        },
      });

    const jobChain = await queuert.withNotify(async () =>
      runInTransaction(async (txContext) =>
        queuert.startJobChain({
          ...txContext,
          typeName: "first",
          input: { id: "test-123" },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededJobChain = await queuert.waitForJobChainCompletion(
        jobChain,
        completionOptions,
      );

      expect(succeededJobChain.output).toEqual({ finalResult: 50 });

      // Blocker should have the second job as originId (created in continueWith context)
      // and the first job's rootChainId (since continueWith runs in first job's chain)
      expect(blockerOriginId).toEqual(secondJobId);
      expect(blockerRootChainId).toEqual(jobChain.id);
    });
  });
};
