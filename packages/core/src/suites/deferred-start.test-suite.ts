import { TestAPI } from "vitest";
import { createQueuert, DefineContinuationOutput, defineUnionJobTypes } from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

export const deferredStartTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("startJobSequence with schedule.afterMs defers job processing", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    log,
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
        return complete(async () => ({ result: job.input.value * 2 }));
      },
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          firstJobTypeName: "test",
          input: { value: 1 },
          schedule: { afterMs: 300 },
        }),
      ),
    );

    await withWorkers(
      [await worker.start({ workerId: "worker", pollIntervalMs: 50 })],
      async () => {
        await expect(
          queuert.waitForJobSequenceCompletion({
            ...jobSequence,
            timeoutMs: 200,
          }),
        ).rejects.toThrow();

        await expect(
          queuert.waitForJobSequenceCompletion({
            ...jobSequence,
            pollIntervalMs: 100,
            timeoutMs: 5000,
          }),
        ).resolves.toBeDefined();
      },
    );
  });

  it("startJobSequence with schedule.at defers job processing", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    log,
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
        return complete(async () => ({ result: job.input.value * 2 }));
      },
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          firstJobTypeName: "test",
          input: { value: 1 },
          schedule: { at: new Date(Date.now() + 300) },
        }),
      ),
    );

    await withWorkers(
      [await worker.start({ workerId: "worker", pollIntervalMs: 50 })],
      async () => {
        await expect(
          queuert.waitForJobSequenceCompletion({
            ...jobSequence,
            timeoutMs: 200,
          }),
        ).rejects.toThrow();

        await expect(
          queuert.waitForJobSequenceCompletion({
            ...jobSequence,
            pollIntervalMs: 100,
            timeoutMs: 5000,
          }),
        ).resolves.toBeDefined();
      },
    );
  });

  it("continueWith with schedule.afterMs defers continuation job", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        first: {
          input: { value: number };
          output: DefineContinuationOutput<"second">;
        };
        second: {
          input: { continued: boolean };
          output: { result: string };
        };
      }>(),
    });

    const firstCompleted = Promise.withResolvers<void>();

    const worker = queuert
      .createWorker()
      .implementJobType({
        name: "first",
        process: async ({ complete }) => {
          try {
            return await complete(async ({ continueWith }) =>
              continueWith({
                typeName: "second",
                input: { continued: true },
                schedule: { afterMs: 300 },
              }),
            );
          } finally {
            firstCompleted.resolve();
          }
        },
      })
      .implementJobType({
        name: "second",
        process: async ({ complete }) => {
          return complete(async () => ({ result: "done" }));
        },
      });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          firstJobTypeName: "first",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers(
      [await worker.start({ workerId: "worker", pollIntervalMs: 50 })],
      async () => {
        await firstCompleted.promise;

        await expect(
          queuert.waitForJobSequenceCompletion({
            ...jobSequence,
            timeoutMs: 200,
          }),
        ).rejects.toThrow();

        await expect(
          queuert.waitForJobSequenceCompletion({
            ...jobSequence,
            pollIntervalMs: 100,
            timeoutMs: 5000,
          }),
        ).resolves.toBeDefined();
      },
    );
  });

  it("continueWith with schedule.at defers continuation job", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions: defineUnionJobTypes<{
        first: {
          input: { value: number };
          output: DefineContinuationOutput<"second">;
        };
        second: {
          input: { continued: boolean };
          output: { result: string };
        };
      }>(),
    });

    const firstCompleted = Promise.withResolvers<void>();

    const worker = queuert
      .createWorker()
      .implementJobType({
        name: "first",
        process: async ({ complete }) => {
          try {
            return await complete(async ({ continueWith }) =>
              continueWith({
                typeName: "second",
                input: { continued: true },
                schedule: { at: new Date(Date.now() + 300) },
              }),
            );
          } finally {
            firstCompleted.resolve();
          }
        },
      })
      .implementJobType({
        name: "second",
        process: async ({ complete }) => {
          return complete(async () => ({ result: "done" }));
        },
      });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          firstJobTypeName: "first",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers(
      [await worker.start({ workerId: "worker", pollIntervalMs: 50 })],
      async () => {
        await firstCompleted.promise;

        await expect(
          queuert.waitForJobSequenceCompletion({
            ...jobSequence,
            timeoutMs: 200,
          }),
        ).rejects.toThrow();

        await expect(
          queuert.waitForJobSequenceCompletion({
            ...jobSequence,
            pollIntervalMs: 100,
            timeoutMs: 5000,
          }),
        ).resolves.toBeDefined();
      },
    );
  });
};
