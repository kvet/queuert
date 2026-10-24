import { sleep } from "@queuert/helpers";
import { type TestAPI, expect, expectTypeOf } from "vitest";

import { type AttemptMiddleware } from "../attempt-middleware/attempt-middleware.js";
import { createClient } from "../client.js";
import { type Chain } from "../entities/chain.js";
import { JobAlreadyCompletedError } from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../job-type-processors/create-job-type-processors.js";
import { defineJobTypes } from "../job-types/define-job-types.js";
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
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.test } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { test: true },
      }),
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
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { sent: true } }),
              );
            },
          },
          sms: {
            attemptHandler: async ({ complete }) => {
              processedTypes.push("sms");
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { sent: true } }),
              );
            },
          },
        },
      }),
    });

    const emailChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "email",
        input: { to: "test@example.com" },
      }),
    );
    const smsChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "sms",
        input: { phone: "+1234567890" },
      }),
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
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: job.input.test } }),
              );
            },
          },
        },
      }),
    });

    await withWorkers([await worker.start()], async () => {
      const chain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { test: true },
        }),
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

              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { success: true } }),
              );
            },
          },
        },
      }),
    });

    const chains: Chain<string, "test", { jobNumber: number }, { success: boolean }>[] = [];
    for (let i = 0; i < 5; i++) {
      chains.push(
        await withTransaction(async (txCtx, transactionHooks) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { jobNumber: i },
          }),
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
              expectTypeOf(trace).toEqualTypeOf<string>();
              expectTypeOf(audit).toEqualTypeOf<string>();
              order.push("process");
              observed.push({ trace, audit });
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 42 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(order).toEqual(["mw1-before", "mw2-before", "process", "mw2-after", "mw1-after"]);
    expect(observed).toEqual([{ jobTypeName: "test" }, { trace: "trace-1", audit: "audit-1" }]);
  });

  it("surfaces handler failures to wrapHandler", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const order: string[] = [];

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

    const failureMiddleware: AttemptMiddleware<any> = {
      wrapHandler: async ({ next }) => {
        try {
          const result = await next({});
          order.push("handler-resolved");
          return result;
        } catch (error) {
          order.push(`handler-caught:${(error as Error).message}`);
          throw error;
        }
      },
    };
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        attemptMiddleware: [failureMiddleware],
        processors: {
          test: {
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt === 1) throw new Error("handler-failure");

              return withTransaction(async (txCtx, transactionHooks) => {
                if (job.attempt === 2) throw new Error("transaction-failure");
                return complete({ ...txCtx, transactionHooks, output: null });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 1 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(order).toEqual([
      "handler-caught:handler-failure",
      "handler-caught:transaction-failure",
      "handler-resolved",
    ]);
  });

  it("aborts in-flight job signal when worker stops and still allows complete", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const { promise: handlerStarted, resolve: onHandlerStarted } = Promise.withResolvers<void>();

    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
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
            attemptHandler: async ({ signal, complete }) => {
              onHandlerStarted();
              await new Promise<void>((resolve) => {
                if (signal.aborted) {
                  resolve();
                  return;
                }
                signal.addEventListener(
                  "abort",
                  () => {
                    resolve();
                  },
                  { once: true },
                );
              });
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      }),
    );

    const stop = await worker.start();
    await handlerStarted;
    await stop();

    const completedChain = await client.awaitChain(chain, completionOptions);
    expect(completedChain.status).toBe("completed");
  });

  it("throws from complete when the attempt is lost after the worker stops", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const handlerStarted = Promise.withResolvers<void>();
    const handlerAborted = Promise.withResolvers<void>();
    const chainCompletedExternally = Promise.withResolvers<void>();

    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { source: string } };
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
            attemptHandler: async ({ signal, complete }) => {
              handlerStarted.resolve();
              await new Promise<void>((resolve) => {
                signal.addEventListener(
                  "abort",
                  () => {
                    resolve();
                  },
                  { once: true },
                );
              });
              handlerAborted.resolve();
              await chainCompletedExternally.promise;

              await expect(
                withTransaction(async (txCtx, transactionHooks) =>
                  complete({ ...txCtx, transactionHooks, output: { source: "worker" } }),
                ),
              ).rejects.toThrow(JobAlreadyCompletedError);
              throw new Error("attempt lost");
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: null,
      }),
    );

    const stop = await worker.start();
    await handlerStarted.promise;
    const stopped = stop();
    await handlerAborted.promise;

    await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) => {
          await completeJob(job, async ({ complete }) =>
            complete({ output: { source: "external" } }),
          );
        },
      }),
    );
    chainCompletedExternally.resolve();
    await stopped;

    const completedChain = await client.awaitChain(chain, completionOptions);
    expect(completedChain.output).toEqual({ source: "external" });
  });

  it("does not poll for a start delay while every slot is busy", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      slow: {
        entry: true;
        input: null;
        output: null;
      };
    }>();

    let startAttemptDelayCalls = 0;
    const countingStateAdapter: typeof stateAdapter = {
      ...stateAdapter,
      getStartAttemptDelayMs: async (params) => {
        startAttemptDelayCalls++;
        return stateAdapter.getStartAttemptDelayMs(params);
      },
    };

    const client = await createClient({
      stateAdapter: countingStateAdapter,
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
          slow: {
            attemptHandler: async ({ complete }) => {
              await sleep(200);
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chains = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: Array.from({ length: 3 }, () => ({ typeName: "slow" as const, input: null })),
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
    });

    // The single slot is busy for ~600ms with two jobs waiting. A delay of 0 for work the
    // worker has nowhere to put would re-query on every loop pass for that whole window.
    expect(startAttemptDelayCalls).toBeLessThanOrEqual(10);
  });
};
