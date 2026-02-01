import { type TestAPI } from "vitest";
import { createClient, createInProcessWorker, defineJobTypes, rescheduleJob } from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const schedulingTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("startJobChain with schedule.afterMs defers job processing", async ({
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
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      workerId: "worker",
      concurrency: 1,
      processDefaults: { pollIntervalMs: 50 },
      processors: {
        test: {
          attemptHandler: async ({ job, complete }) => {
            return complete(async () => ({ result: job.input.value * 2 }));
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
          schedule: { afterMs: 300 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await expect(
        client.waitForJobChainCompletion(jobChain, { timeoutMs: 200 }),
      ).rejects.toThrow();

      await expect(
        client.waitForJobChainCompletion(jobChain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();
    });
  });

  it("startJobChain with schedule.at defers job processing", async ({
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
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      workerId: "worker",
      concurrency: 1,
      processDefaults: { pollIntervalMs: 50 },
      processors: {
        test: {
          attemptHandler: async ({ job, complete }) => {
            return complete(async () => ({ result: job.input.value * 2 }));
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
          schedule: { at: new Date(Date.now() + 300) },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await expect(
        client.waitForJobChainCompletion(jobChain, { timeoutMs: 200 }),
      ).rejects.toThrow();

      await expect(
        client.waitForJobChainCompletion(jobChain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();
    });
  });

  it("continueWith with schedule.afterMs defers continuation job", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
      first: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "second" };
      };
      second: {
        input: { continued: boolean };
        output: { result: string };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    const firstCompleted = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      workerId: "worker",
      concurrency: 1,
      processDefaults: { pollIntervalMs: 50 },
      processors: {
        first: {
          attemptHandler: async ({ complete }) => {
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
        },
        second: {
          attemptHandler: async ({ complete }) => {
            return complete(async () => ({ result: "done" }));
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "first",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await firstCompleted.promise;

      await expect(
        client.waitForJobChainCompletion(jobChain, { timeoutMs: 200 }),
      ).rejects.toThrow();

      await expect(
        client.waitForJobChainCompletion(jobChain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();
    });
  });

  it("continueWith with schedule.at defers continuation job", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
      first: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "second" };
      };
      second: {
        input: { continued: boolean };
        output: { result: string };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    const firstCompleted = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      workerId: "worker",
      concurrency: 1,
      processDefaults: { pollIntervalMs: 50 },
      processors: {
        first: {
          attemptHandler: async ({ complete }) => {
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
        },
        second: {
          attemptHandler: async ({ complete }) => {
            return complete(async () => ({ result: "done" }));
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "first",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await firstCompleted.promise;

      await expect(
        client.waitForJobChainCompletion(jobChain, { timeoutMs: 200 }),
      ).rejects.toThrow();

      await expect(
        client.waitForJobChainCompletion(jobChain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();
    });
  });

  it("rescheduleJob with schedule.afterMs defers job retry", async ({
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

    let attemptCount = 0;
    const firstAttemptDone = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      workerId: "worker",
      concurrency: 1,
      processDefaults: { pollIntervalMs: 50 },
      processors: {
        test: {
          attemptHandler: async ({ job, complete }) => {
            attemptCount++;
            if (attemptCount === 1) {
              firstAttemptDone.resolve();
              rescheduleJob({ afterMs: 300 }, "Rescheduling for later");
            }
            return complete(async () => ({ result: job.input.value * 2 }));
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

    await withWorkers([await worker.start()], async () => {
      await firstAttemptDone.promise;

      await expect(
        client.waitForJobChainCompletion(jobChain, { timeoutMs: 200 }),
      ).rejects.toThrow();

      await expect(
        client.waitForJobChainCompletion(jobChain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();

      expect(attemptCount).toBe(2);
    });
  });

  it("rescheduleJob with schedule.at defers job retry", async ({
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

    let attemptCount = 0;
    const firstAttemptDone = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      workerId: "worker",
      concurrency: 1,
      processDefaults: { pollIntervalMs: 50 },
      processors: {
        test: {
          attemptHandler: async ({ job, complete }) => {
            attemptCount++;
            if (attemptCount === 1) {
              firstAttemptDone.resolve();
              rescheduleJob({ at: new Date(Date.now() + 300) }, "Rescheduling for later");
            }
            return complete(async () => ({ result: job.input.value * 2 }));
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

    await withWorkers([await worker.start()], async () => {
      await firstAttemptDone.promise;

      await expect(
        client.waitForJobChainCompletion(jobChain, { timeoutMs: 200 }),
      ).rejects.toThrow();

      await expect(
        client.waitForJobChainCompletion(jobChain, {
          pollIntervalMs: 100,
          timeoutMs: 400,
        }),
      ).resolves.toBeDefined();

      expect(attemptCount).toBe(2);
    });
  });
};
