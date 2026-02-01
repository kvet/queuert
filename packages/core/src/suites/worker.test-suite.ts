import { type TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import {
  type JobChain,
  createQueuertClient,
  createQueuertInProcessWorker,
  defineJobTypes,
} from "../index.js";
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
    expectGauges,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
      test: {
        entry: true;
        input: { test: boolean };
        output: { result: boolean };
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
      concurrency: { maxSlots: 1 },
      jobTypeProcessors: {
        test: {
          process: async ({ job, complete }) => {
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

    await expectGauges({
      jobTypeIdleChange: [],
      jobTypeProcessingChange: [],
    });
    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, completionOptions);

      await expectGauges({
        jobTypeIdleChange: [
          { delta: 1, typeName: "test" },
          { delta: -1, typeName: "test" },
          { delta: 1, typeName: "test" },
        ],
        jobTypeProcessingChange: [
          { delta: 1, typeName: "test" },
          { delta: -1, typeName: "test" },
        ],
      });
    });

    await expectGauges({
      jobTypeIdleChange: [{ delta: -1, typeName: "test" }],
      jobTypeProcessingChange: [],
    });
  });

  it("processes multiple job types with proper gauge attribution", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expectGauges,
    expect,
  }) => {
    const processedTypes: string[] = [];

    const jobTypeRegistry = defineJobTypes<{
      email: { entry: true; input: { to: string }; output: { sent: boolean } };
      sms: { entry: true; input: { phone: string }; output: { sent: boolean } };
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
      concurrency: { maxSlots: 1 },
      jobTypeProcessors: {
        email: {
          process: async ({ complete }) => {
            processedTypes.push("email");
            return complete(async () => ({ sent: true }));
          },
        },
        sms: {
          process: async ({ complete }) => {
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

      // Verify gauges: worker start emits +1 idle for each type,
      // each job processing emits gauge changes for its specific type
      await expectGauges({
        jobTypeIdleChange: [
          // worker start: +1 for each type
          { delta: 1, typeName: processedTypes[0] },
          { delta: 1, typeName: processedTypes[1] },
          // first job processed (order depends on which runs first)
          { delta: -1, typeName: processedTypes[0] },
          { delta: -1, typeName: processedTypes[1] },
          { delta: 1, typeName: processedTypes[0] },
          { delta: 1, typeName: processedTypes[1] },
          // second job processed
          { delta: -1, typeName: processedTypes[0] },
          { delta: -1, typeName: processedTypes[1] },
          { delta: 1, typeName: processedTypes[0] },
          { delta: 1, typeName: processedTypes[1] },
        ],
        jobTypeProcessingChange: [
          { delta: 1, typeName: processedTypes[0] },
          { delta: -1, typeName: processedTypes[0] },
          { delta: 1, typeName: processedTypes[1] },
          { delta: -1, typeName: processedTypes[1] },
        ],
      });
    });

    // Worker stop: -1 idle for each type
    await expectGauges({
      jobTypeIdleChange: [
        { delta: -1, typeName: "email" },
        { delta: -1, typeName: "sms" },
      ],
      jobTypeProcessingChange: [],
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
    const jobTypeRegistry = defineJobTypes<{
      test: {
        entry: true;
        input: { test: boolean };
        output: { result: boolean };
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
      concurrency: { maxSlots: 1 },
      jobTypeProcessing: {
        pollIntervalMs: 100,
      },
      jobTypeProcessors: {
        test: {
          process: async ({ job, complete }) => {
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

    const jobTypeRegistry = defineJobTypes<{
      test: {
        entry: true;
        input: { jobNumber: number };
        output: { success: boolean };
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
      concurrency: { maxSlots: 1 },
      jobTypeProcessors: {
        test: {
          process: async ({ job, complete }) => {
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

  it("processes jobs in order with multiple slots", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const processedJobs: number[] = [];

    const jobTypeRegistry = defineJobTypes<{
      test: {
        entry: true;
        input: { jobNumber: number };
        output: { success: boolean };
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
      concurrency: { maxSlots: 5 },
      jobTypeProcessors: {
        test: {
          process: async ({ job, complete }) => {
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

  it("processes jobs in order with multiple workers", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const processedJobs: number[] = [];

    const jobTypeRegistry = defineJobTypes<{
      test: {
        entry: true;
        input: { jobNumber: number };
        output: { success: boolean };
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
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

    const worker1 = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      workerId: "w1",
      concurrency: { maxSlots: 1 },
      jobTypeProcessors: {
        test: {
          process: async ({ job, complete }) => {
            processedJobs.push(job.input.jobNumber);
            await sleep(10);

            return complete(async () => ({ success: true }));
          },
        },
      },
    });

    const worker2 = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      workerId: "w2",
      concurrency: { maxSlots: 1 },
      jobTypeProcessors: {
        test: {
          process: async ({ job, complete }) => {
            processedJobs.push(job.input.jobNumber);
            await sleep(10);

            return complete(async () => ({ success: true }));
          },
        },
      },
    });

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      await Promise.all(
        jobChains.map(async (jobChain) =>
          client.waitForJobChainCompletion(jobChain, completionOptions),
        ),
      );
    });

    expect(processedJobs.indexOf(0) < processedJobs.indexOf(4)).toBeTruthy();
  });

  it("calls jobAttemptMiddlewares with job context and composes them correctly", async ({
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

    const jobTypeRegistry = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: null;
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
      concurrency: { maxSlots: 1 },
      jobTypeProcessing: {
        jobAttemptMiddlewares: [
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
      jobTypeProcessors: {
        test: {
          process: async ({ complete }) => {
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
