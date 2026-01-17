import { expectTypeOf, TestAPI } from "vitest";
import { createQueuert, defineJobTypes, JobSequence } from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

export const blockerSequencesTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("handles long blocker sequences", async ({
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
          continuesTo: { typeName: "blocker" };
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
      Parameters<typeof queuert.startJobSequence<"main">>[0]["startBlockers"]
    >().not.toBeUndefined();

    let mainSequenceId: string;
    let blockerSequenceId: string;
    let originId: string;

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "blocker",
        process: async ({ job, complete }) => {
          expect(job.sequenceId).toEqual(blockerSequenceId);
          expect(job.rootSequenceId).toEqual(mainSequenceId);
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

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) => {
        const jobSequence = await queuert.startJobSequence({
          ...context,
          typeName: "main",
          input: { start: true },
          startBlockers: async () => {
            const dependencyJobSequence = await queuert.startJobSequence({
              ...context,
              typeName: "blocker",
              input: { value: 0 },
            });
            blockerSequenceId = dependencyJobSequence.id;
            return [dependencyJobSequence];
          },
        });

        mainSequenceId = jobSequence.id;
        originId = jobSequence.id;

        return jobSequence;
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededJobSequence = await queuert.waitForJobSequenceCompletion(
        jobSequence,
        completionOptions,
      );

      expect(succeededJobSequence.output).toEqual({ finalResult: 2 });
    });

    expectLogs([
      // blocker sequence created
      {
        type: "job_sequence_created",
        data: {
          typeName: "blocker",
          rootSequenceId: mainSequenceId!,
          originId: mainSequenceId!,
        },
      },
      { type: "job_created", data: { typeName: "blocker" } },
      // main sequence created
      { type: "job_sequence_created", data: { typeName: "main" } },
      {
        type: "job_created",
        data: {
          typeName: "main",
          blockers: [
            {
              id: blockerSequenceId!,
              typeName: "blocker",
              originId: mainSequenceId!,
              rootSequenceId: mainSequenceId!,
            },
          ],
        },
      },
      // main job is blocked by the incomplete blocker sequence
      {
        type: "job_blocked",
        data: {
          typeName: "main",
          blockedBySequences: [
            {
              id: blockerSequenceId!,
              typeName: "blocker",
              originId: mainSequenceId!,
              rootSequenceId: mainSequenceId!,
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
      // second blocker job processed, sequence completes
      { type: "job_attempt_started", data: { typeName: "blocker" } },
      { type: "job_attempt_completed", data: { typeName: "blocker" } },
      { type: "job_completed", data: { typeName: "blocker" } },
      { type: "job_sequence_completed", data: { typeName: "blocker" } },
      // main job unblocked and completed
      {
        type: "job_unblocked",
        data: {
          typeName: "main",
          unblockedBySequence: {
            id: blockerSequenceId!,
            typeName: "blocker",
            originId: mainSequenceId!,
            rootSequenceId: mainSequenceId!,
          },
        },
      },
      { type: "job_attempt_started", data: { typeName: "main" } },
      { type: "job_attempt_completed", data: { typeName: "main" } },
      { type: "job_completed", data: { typeName: "main" } },
      { type: "job_sequence_completed", data: { typeName: "main" } },
      // worker stopping
      { type: "worker_stopping" },
      { type: "worker_stopped" },
    ]);

    await expectMetrics([
      // blocker sequence created
      { method: "jobSequenceCreated", args: { typeName: "blocker" } },
      { method: "jobCreated", args: { typeName: "blocker" } },
      // main sequence created
      { method: "jobSequenceCreated", args: { typeName: "main" } },
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
      // second blocker job processed, sequence completes
      { method: "jobAttemptStarted", args: { typeName: "blocker" } },
      { method: "jobAttemptCompleted", args: { typeName: "blocker" } },
      { method: "jobCompleted", args: { typeName: "blocker" } },
      { method: "jobSequenceCompleted", args: { typeName: "blocker" } },
      // main job unblocked and completed
      { method: "jobUnblocked", args: { typeName: "main" } },
      { method: "jobAttemptStarted", args: { typeName: "main" } },
      { method: "jobAttemptCompleted", args: { typeName: "main" } },
      { method: "jobCompleted", args: { typeName: "main" } },
      { method: "jobSequenceCompleted", args: { typeName: "main" } },
      { method: "workerStopping" },
      { method: "workerStopped" },
    ]);
  });

  it("handles completed blocker sequences", async ({
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

    const blockerJobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "blocker",
          input: { value: 1 },
        }),
      ),
    );
    const completedBlockerJobSequence = await runInTransaction(async (context) =>
      queuert.completeJobSequence({
        ...context,
        ...blockerJobSequence,
        complete: async ({ job, complete }) => {
          return complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "main",
          input: null,
          startBlockers: async () => [completedBlockerJobSequence],
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededJobSequence = await queuert.waitForJobSequenceCompletion(
        jobSequence,
        completionOptions,
      );

      expect(succeededJobSequence.output).toEqual({
        finalResult: completedBlockerJobSequence.output.result,
      });
    });
  });

  it("handles blocker sequences spawned during processing", async ({
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

    const childJobSequences: JobSequence<string, "inner", null, null>[] = [];
    let originId: string;

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "inner",
        process: async ({ job, complete }) => {
          return complete(async () => {
            expect(job.originId).toEqual(originId);
            return null;
          });
        },
      })
      .implementJobType({
        typeName: "outer",
        process: async ({ job, prepare, complete }) => {
          expect(job.originId).toBeNull();
          originId = job.id;

          await prepare({ mode: "staged" }, async (context) => {
            childJobSequences.push(
              await queuert.withNotify(async () =>
                queuert.startJobSequence({
                  ...context,
                  typeName: "inner",
                  input: null,
                }),
              ),
            );
          });

          childJobSequences.push(
            await queuert.withNotify(async () =>
              runInTransaction(async (context) =>
                queuert.startJobSequence({
                  ...context,
                  typeName: "inner",
                  input: null,
                }),
              ),
            ),
          );

          return complete(async (context) => {
            childJobSequences.push(
              await queuert.withNotify(async () =>
                queuert.startJobSequence({
                  ...context,
                  typeName: "inner",
                  input: null,
                }),
              ),
            );

            return null;
          });
        },
      });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "outer",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await queuert.waitForJobSequenceCompletion(jobSequence, completionOptions);

      const succeededChildJobSequences = await Promise.all(
        childJobSequences.map(async (seq) =>
          queuert.waitForJobSequenceCompletion(seq, completionOptions),
        ),
      );

      expect(succeededChildJobSequences).toHaveLength(3);
    });
  });

  it("handles sequences that are distributed across workers", async ({
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
          continuesTo: { typeName: "finish" };
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

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
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
        const finishedJobSequence = await queuert.waitForJobSequenceCompletion(
          jobSequence,
          completionOptions,
        );

        expect(finishedJobSequence.output).toEqual({ result: 3 });
      },
    );
  });

  it("handles multiple blocker sequences", async ({
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

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "main",
          input: null,
          startBlockers: async () => {
            const blockers = await Promise.all(
              Array.from({ length: 5 }, async (_, i) =>
                queuert.startJobSequence({
                  ...context,
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
      const succeededJobSequence = await queuert.waitForJobSequenceCompletion(
        jobSequence,
        completionOptions,
      );

      expect(succeededJobSequence.output).toEqual({
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
          continuesTo: { typeName: "second" };
        };
        second: {
          input: { fromFirst: string };
          output: { finalResult: number };
          blockers: [{ typeName: "blocker" }];
        };
      }>(),
    });

    let blockerRootSequenceId: string;
    let blockerOriginId: string | null;
    let secondJobId: string;

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "blocker",
        process: async ({ job, prepare, complete }) => {
          blockerRootSequenceId = job.rootSequenceId;
          blockerOriginId = job.originId;
          await prepare({ mode: "atomic" });
          return complete(async () => ({ result: job.input.value * 10 }));
        },
      })
      .implementJobType({
        typeName: "first",
        process: async ({ job, prepare, complete }) => {
          await prepare({ mode: "atomic" });
          return complete(async (context) => {
            const { continueWith } = context;
            const continuedJob = await continueWith({
              typeName: "second",
              input: { fromFirst: job.input.id },
              startBlockers: async () => [
                await queuert.startJobSequence({
                  ...context,
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

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "first",
          input: { id: "test-123" },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const succeededJobSequence = await queuert.waitForJobSequenceCompletion(
        jobSequence,
        completionOptions,
      );

      expect(succeededJobSequence.output).toEqual({ finalResult: 50 });

      // Blocker should have the second job as originId (created in continueWith context)
      // and the first job's rootSequenceId (since continueWith runs in first job's sequence)
      expect(blockerOriginId).toEqual(secondJobId);
      expect(blockerRootSequenceId).toEqual(jobSequence.id);
    });
  });
};
