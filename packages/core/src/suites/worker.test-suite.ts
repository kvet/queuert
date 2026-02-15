import { type TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { type JobChain, createClient, createInProcessWorker, defineJobTypes } from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

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
    observabilityAdapter,
    log,
  }) => {
    const registry = defineJobTypes<{
      test: {
        entry: true;
        input: { test: boolean };
        output: { result: boolean };
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
        test: {
          attemptHandler: async ({ job, complete }) => {
            return complete(async () => ({ result: job.input.test }));
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { test: true },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);
    });
  });

  it("processes multiple job types with proper gauge attribution", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const processedTypes: string[] = [];

    const registry = defineJobTypes<{
      email: { entry: true; input: { to: string }; output: { sent: boolean } };
      sms: { entry: true; input: { phone: string }; output: { sent: boolean } };
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
        email: {
          attemptHandler: async ({ complete }) => {
            processedTypes.push("email");
            return complete(async () => ({ sent: true }));
          },
        },
        sms: {
          attemptHandler: async ({ complete }) => {
            processedTypes.push("sms");
            return complete(async () => ({ sent: true }));
          },
        },
      },
    });

    const emailJob = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "email",
          input: { to: "test@example.com" },
        }),
      ),
    );
    const smsJob = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({ ...txContext, typeName: "sms", input: { phone: "+1234567890" } }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await Promise.all([
        client.waitForJobChainCompletion(emailJob, completionOptions),
        client.waitForJobChainCompletion(smsJob, completionOptions),
      ]);

      expect(processedTypes).toContain("email");
      expect(processedTypes).toContain("sms");
      expect(processedTypes).toHaveLength(2);
    });
  });

  it("picks up job that is added while it is online", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const registry = defineJobTypes<{
      test: {
        entry: true;
        input: { test: boolean };
        output: { result: boolean };
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
      processDefaults: {
        pollIntervalMs: 100,
      },
      processors: {
        test: {
          attemptHandler: async ({ job, complete }) => {
            return complete(async () => ({ result: job.input.test }));
          },
        },
      },
    });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.startJobChain({
            ...txContext,
            typeName: "test",
            input: { test: true },
          }),
        ),
      );

      await client.waitForJobChainCompletion(jobChain, completionOptions);
    });
  });

  it("processes jobs in order", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const processedJobs: number[] = [];

    const registry = defineJobTypes<{
      test: {
        entry: true;
        input: { jobNumber: number };
        output: { success: boolean };
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
        test: {
          attemptHandler: async ({ job, complete }) => {
            processedJobs.push(job.input.jobNumber);
            await sleep(10);

            return complete(async () => ({ success: true }));
          },
        },
      },
    });

    const jobChains: JobChain<string, "test", { jobNumber: number }, { success: boolean }>[] = [];
    for (let i = 0; i < 5; i++) {
      jobChains.push(
        await client.withNotify(async () =>
          runInTransaction(async (txContext) =>
            client.startJobChain({
              ...txContext,
              typeName: "test",
              input: { jobNumber: i },
            }),
          ),
        ),
      );
    }

    await withWorkers([await worker.start()], async () => {
      await Promise.all(
        jobChains.map(async (jobChain) =>
          client.waitForJobChainCompletion(jobChain, completionOptions),
        ),
      );
    });

    expect(processedJobs).toEqual([0, 1, 2, 3, 4]);
  });

  it("calls attemptMiddlewares with job context and composes them correctly", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const order: string[] = [];
    const capturedJobs: { id: unknown; typeName: string; input: unknown }[] = [];

    const registry = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
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
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processDefaults: {
        attemptMiddlewares: [
          async (ctx, next) => {
            order.push("mw1-before");
            capturedJobs.push({
              id: ctx.job.id,
              typeName: ctx.job.typeName,
              input: ctx.job.input,
            });
            const result = await next();
            order.push("mw1-after");
            return result;
          },
          async (ctx, next) => {
            order.push("mw2-before");
            const result = await next();
            order.push("mw2-after");
            return result;
          },
        ],
      },
      processors: {
        test: {
          attemptHandler: async ({ complete }) => {
            order.push("process");
            return complete(async () => null);
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (context) =>
        client.startJobChain({
          ...context,
          typeName: "test",
          input: { value: 42 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);
    });

    expect(order).toEqual(["mw1-before", "mw2-before", "process", "mw2-after", "mw1-after"]);
    expect(capturedJobs).toHaveLength(1);
    expect(capturedJobs[0].typeName).toBe("test");
    expect(capturedJobs[0].input).toEqual({ value: 42 });
  });
};
