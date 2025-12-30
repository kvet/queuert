import { TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createQueuert, defineUnionJobTypes, JobSequence } from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

export const workerTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("picks up job that was added while it was offline", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    log,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { test: boolean };
          output: { result: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      process: async ({ job, complete }) => {
        return complete(async () => ({ result: job.input.test }));
      },
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          firstJobTypeName: "test",
          input: { test: true },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await queuert.waitForJobSequenceCompletion({
        ...jobSequence,
        ...completionOptions,
      });
    });
  });

  it("picks up job that is added while it is online", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    log,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { test: boolean };
          output: { result: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      process: async ({ job, complete }) => {
        return complete(async () => ({ result: job.input.test }));
      },
    });

    await withWorkers(
      [
        await worker.start({
          pollIntervalMs: 100,
        }),
      ],
      async () => {
        const jobSequence = await queuert.withNotify(async () =>
          runInTransaction(async (context) =>
            queuert.startJobSequence({
              ...context,
              firstJobTypeName: "test",
              input: { test: true },
            }),
          ),
        );

        await queuert.waitForJobSequenceCompletion({
          ...jobSequence,
          ...completionOptions,
        });
      },
    );
  });

  it("processes jobs in order", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    log,
    expect,
  }) => {
    const processedJobs: number[] = [];

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { jobNumber: number };
          output: { success: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      process: async ({ job, complete }) => {
        processedJobs.push(job.input.jobNumber);
        await sleep(10);

        return complete(async () => ({ success: true }));
      },
    });

    const jobSequences: JobSequence<"test", { jobNumber: number }, { success: boolean }>[] = [];
    for (let i = 0; i < 5; i++) {
      jobSequences.push(
        await queuert.withNotify(async () =>
          runInTransaction(async (context) =>
            queuert.startJobSequence({
              ...context,
              firstJobTypeName: "test",
              input: { jobNumber: i },
            }),
          ),
        ),
      );
    }

    await withWorkers([await worker.start()], async () => {
      await Promise.all(
        jobSequences.map(async (jobSequence) =>
          queuert.waitForJobSequenceCompletion({
            ...jobSequence,
            ...completionOptions,
          }),
        ),
      );
    });

    expect(processedJobs).toEqual([0, 1, 2, 3, 4]);
  });

  it("processes jobs in order distributed across workers", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    log,
    expect,
  }) => {
    const processedJobs: number[] = [];

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        test: {
          input: { jobNumber: number };
          output: { success: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
      process: async ({ job, complete }) => {
        processedJobs.push(job.input.jobNumber);
        await sleep(10);

        return complete(async () => ({ success: true }));
      },
    });

    const jobSequences: JobSequence<"test", { jobNumber: number }, { success: boolean }>[] = [];
    for (let i = 0; i < 5; i++) {
      jobSequences.push(
        await queuert.withNotify(async () =>
          runInTransaction(async (context) =>
            queuert.startJobSequence({
              ...context,
              firstJobTypeName: "test",
              input: { jobNumber: i },
            }),
          ),
        ),
      );
    }

    await withWorkers(await Promise.all([worker.start(), worker.start()]), async () => {
      await Promise.all(
        jobSequences.map(async (jobSequence) =>
          queuert.waitForJobSequenceCompletion({
            ...jobSequence,
            ...completionOptions,
          }),
        ),
      );
    });

    expect(processedJobs.indexOf(0) < processedJobs.indexOf(4)).toBeTruthy();
  });
};
