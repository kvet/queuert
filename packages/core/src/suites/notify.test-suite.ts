import { TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import {
  createQueuert,
  DefineBlocker,
  DefineContinuationInput,
  DefineContinuationOutput,
  defineUnionJobTypes,
} from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

export const notifyTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("schedules processing immediately", async ({
    stateAdapter,
    notifyAdapter,
    log,
    withWorkers,
    runInTransaction,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      process: async ({ job, complete }) => {
        await sleep(50);
        return complete(async () => ({ result: job.input.value }));
      },
    });

    await withWorkers([await worker.start()], async () => {
      const jobSequence = await queuert.withNotify(async () =>
        runInTransaction(async (context) =>
          queuert.startJobSequence({
            ...context,
            firstJobTypeName: "test",
            input: { value: 1 },
          }),
        ),
      );

      const signal = AbortSignal.timeout(200);
      await queuert.waitForJobSequenceCompletion({
        ...jobSequence,
        timeoutMs: 200,
      });
      if (signal.aborted) {
        expect.fail("Timed out waiting for job sequence completion");
      }
    });
  });

  it("distributes processing to multiple workers", async ({
    stateAdapter,
    notifyAdapter,
    log,
    withWorkers,
    runInTransaction,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      process: async ({ job, complete }) => {
        await sleep(50);
        return complete(async () => ({ result: job.input.value }));
      },
    });

    await withWorkers(
      await Promise.all(Array.from({ length: 5 }, async () => worker.start())),
      async () => {
        const jobSequences = await queuert.withNotify(async () =>
          runInTransaction(async (context) =>
            Promise.all(
              Array.from({ length: 5 }, async (_, i) =>
                queuert.startJobSequence({
                  ...context,
                  firstJobTypeName: "test",
                  input: { value: i },
                }),
              ),
            ),
          ),
        );

        const signal = AbortSignal.timeout(200);
        await Promise.all(
          jobSequences.map(async (sequence) =>
            queuert.waitForJobSequenceCompletion({
              ...sequence,
              timeoutMs: 200,
            }),
          ),
        );
        if (signal.aborted) {
          expect.fail("Timed out waiting for job sequence completions");
        }
      },
    );
  });

  it("handles distributed blocker jobs", async ({
    stateAdapter,
    notifyAdapter,
    log,
    withWorkers,
    runInTransaction,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        blocker: {
          input: null;
          output: { allowed: boolean };
        };
        main: {
          input: null;
          output: { done: true };
          blockers: [DefineBlocker<"blocker">];
        };
      }>(),
    });

    const worker1 = queuert.createWorker().implementJobType({
      name: "blocker",
      process: async ({ complete }) => {
        await sleep(25);
        return complete(async () => ({ allowed: true }));
      },
    });

    const worker2 = queuert.createWorker().implementJobType({
      name: "main",
      process: async ({ complete }) => {
        await sleep(25);
        return complete(async () => ({ done: true }));
      },
    });

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      const jobSequence = await queuert.withNotify(async () =>
        runInTransaction(async (context) =>
          queuert.startJobSequence({
            ...context,
            firstJobTypeName: "main",
            input: null,
            startBlockers: async () => [
              await queuert.startJobSequence({
                ...context,
                firstJobTypeName: "blocker",
                input: null,
              }),
            ],
          }),
        ),
      );

      const signal = AbortSignal.timeout(100);
      await queuert.waitForJobSequenceCompletion({
        ...jobSequence,
        timeoutMs: 200,
      });
      if (signal.aborted) {
        expect.fail("Timed out waiting for job sequence completion");
      }
    });
  });

  it("handles distributed sequence jobs", async ({
    stateAdapter,
    notifyAdapter,
    log,
    withWorkers,
    runInTransaction,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        step1: {
          input: null;
          output: DefineContinuationOutput<"step2">;
        };
        step2: {
          // TODO: fix DefineContinuationInput to allow null
          input: DefineContinuationInput<{}>;
          output: { finished: true };
        };
      }>(),
    });

    const worker1 = queuert.createWorker().implementJobType({
      name: "step1",
      process: async ({ complete }) => {
        await sleep(25);
        return complete(async ({ continueWith }) =>
          continueWith({
            typeName: "step2",
            input: {},
          }),
        );
      },
    });

    const worker2 = queuert.createWorker().implementJobType({
      name: "step2",
      process: async ({ complete }) => {
        await sleep(25);
        return complete(async () => ({ finished: true }));
      },
    });

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      const jobSequence = await queuert.withNotify(async () =>
        runInTransaction(async (context) =>
          queuert.startJobSequence({
            ...context,
            firstJobTypeName: "step1",
            input: null,
          }),
        ),
      );

      const signal = AbortSignal.timeout(100);
      await queuert.waitForJobSequenceCompletion({
        ...jobSequence,
        timeoutMs: 200,
      });
      if (signal.aborted) {
        expect.fail("Timed out waiting for job sequence completion");
      }
    });
  });

  // check that notify signals are sent when jobs are completed externally to workers
  // like there are 2 distributed workers with dedicated job handlers and first job is completed outside

  it("notifies workers about workerless completed jobs", async ({
    stateAdapter,
    notifyAdapter,
    log,
    withWorkers,
    runInTransaction,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: null;
          output: { result: string };
        };
      }>(),
    });

    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      process: async ({ signal, prepare }) => {
        await prepare({ mode: "staged" });
        jobStarted.resolve();

        await sleep(1000, { signal });
        expect(signal.aborted).toBe(true);
        expect(signal.reason).toBe("already_completed");
        jobCompleted.resolve();

        throw new Error();
      },
    });

    await withWorkers([await worker.start({ workerId: "worker" })], async () => {
      const jobSequence = await queuert.withNotify(async () =>
        runInTransaction(async (context) =>
          queuert.startJobSequence({
            ...context,
            firstJobTypeName: "test",
            input: null,
          }),
        ),
      );

      await jobStarted.promise;

      await queuert.withNotify(async () =>
        runInTransaction(async (context) =>
          queuert.completeJobSequence({
            ...context,
            firstJobTypeName: "test",
            id: jobSequence.id,
            complete: async ({ job, complete }) => {
              return complete(job, () => ({ result: "from-external" }));
            },
          }),
        ),
      );

      await jobCompleted.promise;
    });
  });

  it('notifies workers when reaper deletes "zombie" jobs', async ({
    stateAdapter,
    notifyAdapter,
    log,
    withWorkers,
    runInTransaction,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: null;
          output: { result: string };
        };
      }>(),
    });

    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      process: async ({ signal, job, prepare, complete }) => {
        if (job.attempt > 1) {
          return complete(async () => ({ result: "recovered" }));
        }

        await prepare({ mode: "staged" });
        jobStarted.resolve();

        await sleep(1000, { signal });
        expect(signal.aborted).toBe(true);
        expect(signal.reason).toBe("taken_by_another_worker");
        jobCompleted.resolve();

        throw new Error();
      },
      leaseConfig: { leaseMs: 1, renewIntervalMs: 1000 },
    });

    await withWorkers([await worker.start()], async () => {
      const jobSequence = await queuert.withNotify(async () =>
        runInTransaction(async (context) =>
          queuert.startJobSequence({
            ...context,
            firstJobTypeName: "test",
            input: null,
          }),
        ),
      );

      await jobStarted.promise;
      await sleep(5);

      await withWorkers([await worker.start()], async () => {
        await queuert.waitForJobSequenceCompletion({
          ...jobSequence,
          timeoutMs: 5000,
        });
      });

      await jobCompleted.promise;
    });
  });
};
