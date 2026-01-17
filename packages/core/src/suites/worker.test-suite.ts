import { TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createQueuert, defineJobTypes, JobChain } from "../index.js";
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
    observabilityAdapter,
    log,
    expectGauges,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        test: {
          entry: true;
          input: { test: boolean };
          output: { result: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
      process: async ({ job, complete }) => {
        return complete(async () => ({ result: job.input.test }));
      },
    });

    const jobChain = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobChain({
          ...context,
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
      await queuert.waitForJobChainCompletion(jobChain, completionOptions);

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

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        email: { entry: true; input: { to: string }; output: { sent: boolean } };
        sms: { entry: true; input: { phone: string }; output: { sent: boolean } };
      }>(),
    });

    const worker = queuert
      .createWorker()
      .implementJobType({
        typeName: "email",
        process: async ({ complete }) => {
          processedTypes.push("email");
          return complete(async () => ({ sent: true }));
        },
      })
      .implementJobType({
        typeName: "sms",
        process: async ({ complete }) => {
          processedTypes.push("sms");
          return complete(async () => ({ sent: true }));
        },
      });

    const emailJob = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobChain({
          ...context,
          typeName: "email",
          input: { to: "test@example.com" },
        }),
      ),
    );
    const smsJob = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobChain({ ...context, typeName: "sms", input: { phone: "+1234567890" } }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await Promise.all([
        queuert.waitForJobChainCompletion(emailJob, completionOptions),
        queuert.waitForJobChainCompletion(smsJob, completionOptions),
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
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        test: {
          entry: true;
          input: { test: boolean };
          output: { result: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
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
        const jobChain = await queuert.withNotify(async () =>
          runInTransaction(async (context) =>
            queuert.startJobChain({
              ...context,
              typeName: "test",
              input: { test: true },
            }),
          ),
        );

        await queuert.waitForJobChainCompletion(jobChain, completionOptions);
      },
    );
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

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        test: {
          entry: true;
          input: { jobNumber: number };
          output: { success: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
      process: async ({ job, complete }) => {
        processedJobs.push(job.input.jobNumber);
        await sleep(10);

        return complete(async () => ({ success: true }));
      },
    });

    const jobChains: JobChain<string, "test", { jobNumber: number }, { success: boolean }>[] =
      [];
    for (let i = 0; i < 5; i++) {
      jobChains.push(
        await queuert.withNotify(async () =>
          runInTransaction(async (context) =>
            queuert.startJobChain({
              ...context,
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
          queuert.waitForJobChainCompletion(jobChain, completionOptions),
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
    observabilityAdapter,
    log,
    expect,
  }) => {
    const processedJobs: number[] = [];

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        test: {
          entry: true;
          input: { jobNumber: number };
          output: { success: boolean };
        };
      }>(),
    });

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
      process: async ({ job, complete }) => {
        processedJobs.push(job.input.jobNumber);
        await sleep(10);

        return complete(async () => ({ success: true }));
      },
    });

    const jobChains: JobChain<string, "test", { jobNumber: number }, { success: boolean }>[] =
      [];
    for (let i = 0; i < 5; i++) {
      jobChains.push(
        await queuert.withNotify(async () =>
          runInTransaction(async (context) =>
            queuert.startJobChain({
              ...context,
              typeName: "test",
              input: { jobNumber: i },
            }),
          ),
        ),
      );
    }

    await withWorkers(await Promise.all([worker.start(), worker.start()]), async () => {
      await Promise.all(
        jobChains.map(async (jobChain) =>
          queuert.waitForJobChainCompletion(jobChain, completionOptions),
        ),
      );
    });

    expect(processedJobs.indexOf(0) < processedJobs.indexOf(4)).toBeTruthy();
  });
};
