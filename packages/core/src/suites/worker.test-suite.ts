import { type TestAPI } from "vitest";

import { sleep } from "../helpers/sleep.js";
import {
  type AttemptMiddleware,
  type JobChain,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
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
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({ result: job.input.test }));
            },
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { test: true },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitJobChain(jobChain, completionOptions);
    });
  });

  it("processes multiple job types with proper gauge attribution", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const processedTypes: string[] = [];

    const jobTypes = defineJobTypes<{
      email: { entry: true; input: { to: string }; output: { sent: boolean } };
      sms: { entry: true; input: { phone: string }; output: { sent: boolean } };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
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
      }),
    });

    const emailJob = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "email",
          input: { to: "test@example.com" },
        }),
      ),
    );
    const smsJob = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "sms",
          input: { phone: "+1234567890" },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await Promise.all([
        client.awaitJobChain(emailJob, completionOptions),
        client.awaitJobChain(smsJob, completionOptions),
      ]);

      expect(processedTypes).toContain("email");
      expect(processedTypes).toContain("sms");
      expect(processedTypes).toHaveLength(2);
    });
  });

  it("picks up job that is added while it is online", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      pollIntervalMs: 100,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({ result: job.input.test }));
            },
          },
        },
      }),
    });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { test: true },
          }),
        ),
      );

      await client.awaitJobChain(jobChain, completionOptions);
    });
  });

  it("processes jobs in order", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const processedJobs: number[] = [];

    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              processedJobs.push(job.input.jobNumber);
              await sleep(10);

              return complete(async () => ({ success: true }));
            },
          },
        },
      }),
    });

    const jobChains: JobChain<string, "test", { jobNumber: number }, { success: boolean }>[] = [];
    for (let i = 0; i < 5; i++) {
      jobChains.push(
        await withTransactionHooks(async (transactionHooks) =>
          withTransaction(async (txCtx) =>
            client.startJobChain({
              ...txCtx,
              transactionHooks,
              typeName: "test",
              input: { jobNumber: i },
            }),
          ),
        ),
      );
    }

    await withWorkers([await worker.start()], async () => {
      await Promise.all(
        jobChains.map(async (jobChain) => client.awaitJobChain(jobChain, completionOptions)),
      );
    });

    expect(processedJobs).toEqual([0, 1, 2, 3, 4]);
  });

  it("composes registry-level wrapHandler onion with typed ctx", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const order: string[] = [];
    const observed: { trace?: string; audit?: string; jobTypeName?: string }[] = [];

    const jobTypes = defineJobTypes<{
      test: { entry: true; input: { value: number }; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const traceMiddleware: AttemptMiddleware<any, { trace: string }> = {
      wrapHandler: async ({ job, next }) => {
        order.push("mw1-before");
        observed.push({ jobTypeName: job.typeName });
        const result = await next({ trace: "trace-1" });
        order.push("mw1-after");
        return result;
      },
    };
    const auditMiddleware: AttemptMiddleware<any, { audit: string }> = {
      wrapHandler: async ({ next }) => {
        order.push("mw2-before");
        const result = await next({ audit: "audit-1" });
        order.push("mw2-after");
        return result;
      },
    };
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        attemptMiddleware: [traceMiddleware, auditMiddleware],
        processors: {
          test: {
            attemptHandler: async ({ trace, audit, complete }) => {
              order.push("process");
              observed.push({ trace, audit });
              return complete(async () => null);
            },
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 42 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitJobChain(jobChain, completionOptions);
    });

    expect(order).toEqual(["mw1-before", "mw2-before", "process", "mw2-after", "mw1-after"]);
    expect(observed).toEqual([{ jobTypeName: "test" }, { trace: "trace-1", audit: "audit-1" }]);
  });

  it("calls wrapPrepare around the prepare callback with typed ctx", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const order: string[] = [];
    const observedPrepareCtx: { tag: string }[] = [];

    const jobTypes = defineJobTypes<{
      test: { entry: true; input: { value: number }; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const prepareMiddleware: AttemptMiddleware<any, {}, { tag: string }> = {
      wrapPrepare: async ({ next }) => {
        order.push("prepare-wrap-before");
        const result = await next({ tag: "prep" });
        order.push("prepare-wrap-after");
        return result;
      },
    };
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        attemptMiddleware: [prepareMiddleware],
        processors: {
          test: {
            attemptHandler: async ({ prepare, complete }) => {
              await prepare({ mode: "atomic" }, async ({ tag }) => {
                order.push("prepare-callback");
                observedPrepareCtx.push({ tag });
              });
              return complete(async () => null);
            },
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitJobChain(jobChain, completionOptions);
    });

    expect(order).toEqual(["prepare-wrap-before", "prepare-callback", "prepare-wrap-after"]);
    expect(observedPrepareCtx).toEqual([{ tag: "prep" }]);
  });

  it("calls wrapComplete around the complete callback with typed ctx", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const order: string[] = [];
    const observedCompleteCtx: { tag: string }[] = [];

    const jobTypes = defineJobTypes<{
      test: { entry: true; input: { value: number }; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const completeMiddleware: AttemptMiddleware<any, {}, {}, { tag: string }> = {
      wrapComplete: async ({ next }) => {
        order.push("complete-wrap-before");
        const result = await next({ tag: "complete" });
        order.push("complete-wrap-after");
        return result;
      },
    };
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        attemptMiddleware: [completeMiddleware],
        processors: {
          test: {
            attemptHandler: async ({ complete }) =>
              complete(async ({ tag }) => {
                order.push("complete-callback");
                observedCompleteCtx.push({ tag });
                return null;
              }),
          },
        },
      }),
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitJobChain(jobChain, completionOptions);
    });

    expect(order).toEqual(["complete-wrap-before", "complete-callback", "complete-wrap-after"]);
    expect(observedCompleteCtx).toEqual([{ tag: "complete" }]);
  });
};
