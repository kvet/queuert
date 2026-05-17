import { type TestAPI } from "vitest";

import { createClient } from "../client.js";
import { type Chain } from "../entities/chain.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { sleep } from "../helpers/sleep.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { type AttemptMiddleware } from "../worker/attempt-middleware.js";
import { createProcessors } from "../worker/create-processors.js";
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { test: true },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
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

    const emailChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "email",
          input: { to: "test@example.com" },
        }),
      ),
    );
    const smsChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "sms",
          input: { phone: "+1234567890" },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await Promise.all([
        client.awaitChain(emailChain, completionOptions),
        client.awaitChain(smsChain, completionOptions),
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
      const chain = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.startChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { test: true },
          }),
        ),
      );

      await client.awaitChain(chain, completionOptions);
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

    const chains: Chain<string, "test", { jobNumber: number }, { success: boolean }>[] = [];
    for (let i = 0; i < 5; i++) {
      chains.push(
        await withTransactionHooks(async (transactionHooks) =>
          withTransaction(async (txCtx) =>
            client.startChain({
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
      await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 42 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
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

    const prepareMiddleware: AttemptMiddleware<any, Record<string, never>, { tag: string }> = {
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
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

    const completeMiddleware: AttemptMiddleware<
      any,
      Record<string, never>,
      Record<string, never>,
      { tag: string }
    > = {
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(order).toEqual(["complete-wrap-before", "complete-callback", "complete-wrap-after"]);
    expect(observedCompleteCtx).toEqual([{ tag: "complete" }]);
  });
};
