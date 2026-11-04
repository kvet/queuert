import { sleep } from "@queuert/helpers";
import { type TestAPI, expect, expectTypeOf } from "vitest";

import { type AttemptMiddleware } from "../attempt-middleware/attempt-middleware.js";
import { createClient } from "../client.js";
import { type Chain } from "../entities/chain.js";
import { JobAlreadyCompletedError, JobTakenByAnotherWorkerError } from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../job-type-processors/create-job-type-processors.js";
import { omitProcessors, pickProcessors } from "../job-type-processors/pick-job-type-processors.js";
import { defineJobTypes } from "../job-types/define-job-types.js";
import { createSpyStateAdapter } from "../state-adapter/state-adapter.spy.spec-helper.js";
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

  it("splits registries across workers with pickProcessors and omitProcessors", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const processed: string[] = [];

    const imageJobTypes = defineJobTypes<{
      "images.resize": { entry: true; input: null; output: null };
      "images.notify": { entry: true; input: null; output: null };
    }>();
    const billingJobTypes = defineJobTypes<{
      "billing.charge": { entry: true; input: null; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: [imageJobTypes, billingJobTypes],
    });

    const traceMiddleware: AttemptMiddleware<any, { trace: string }> = {
      wrapHandler: async ({ next }) => next({ trace: "trace-1" }),
    };
    const imageProcessors = createProcessors({
      client,
      jobTypes: imageJobTypes,
      attemptMiddleware: [traceMiddleware],
      processors: {
        "images.resize": {
          attemptHandler: async ({ job, trace, complete }) => {
            processed.push(`${job.typeName}:${trace}`);
            return withTransaction(async (txCtx, transactionHooks) =>
              complete({ ...txCtx, transactionHooks, output: null }),
            );
          },
        },
        "images.notify": {
          attemptHandler: async ({ job, trace, complete }) => {
            processed.push(`${job.typeName}:${trace}`);
            return withTransaction(async (txCtx, transactionHooks) =>
              complete({ ...txCtx, transactionHooks, output: null }),
            );
          },
        },
      },
    });
    const billingProcessors = createProcessors({
      client,
      jobTypes: billingJobTypes,
      processors: {
        "billing.charge": {
          attemptHandler: async ({ job, complete }) => {
            processed.push(job.typeName);
            return withTransaction(async (txCtx, transactionHooks) =>
              complete({ ...txCtx, transactionHooks, output: null }),
            );
          },
        },
      },
    });

    const dedicatedWorker = await createInProcessWorker({
      client,
      processors: [
        pickProcessors(imageProcessors, ["images.resize"]),
        pickProcessors(billingProcessors, ["billing.charge"]),
      ],
    });
    const restWorker = await createInProcessWorker({
      client,
      processors: omitProcessors(imageProcessors, ["images.resize"]),
    });

    const [resizeChain, chargeChain, notifyChain] = await withTransaction(
      async (txCtx, transactionHooks) =>
        Promise.all([
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "images.resize",
            input: null,
          }),
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "billing.charge",
            input: null,
          }),
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "images.notify",
            input: null,
          }),
        ]),
    );

    await withWorkers([await restWorker.start()], async () => {
      await client.awaitChain(notifyChain, completionOptions);
    });
    expect(processed).toEqual(["images.notify:trace-1"]);
    expect((await client.getChain({ id: resizeChain.id }))?.status).toBe("running");
    expect((await client.getChain({ id: chargeChain.id }))?.status).toBe("running");

    await withWorkers([await dedicatedWorker.start()], async () => {
      await Promise.all([
        client.awaitChain(resizeChain, completionOptions),
        client.awaitChain(chargeChain, completionOptions),
      ]);
    });
    expect(processed.toSorted()).toEqual([
      "billing.charge",
      "images.notify:trace-1",
      "images.resize:trace-1",
    ]);
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

  it("fills every idle slot with a single acquisition", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);
    const client = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const concurrency = 4;
    let startedCount = 0;
    const allStarted = Promise.withResolvers<void>();
    const worker = await createInProcessWorker({
      client,
      concurrency,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              if (++startedCount === concurrency) allStarted.resolve();
              await allStarted.promise;
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chains = await withTransaction(async (txCtx, transactionHooks) =>
      Promise.all(
        Array.from({ length: concurrency }, async () =>
          client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
        ),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await allStarted.promise;
      expect(spyStateAdapter.calls.filter((call) => call.name === "startJobAttempts")).toHaveLength(
        1,
      );
      await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
    });
  });

  it("completes an attempt that outlives the lease duration", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
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
    const lease = { durationMs: 300, heartbeatMs: 50 };
    const worker = await createInProcessWorker({
      client,
      lease,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ signal, complete }) => {
              await sleep(lease.durationMs * 2);
              expect(signal.aborted).toBe(false);
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(await client.getJob({ id: chain.id })).toMatchObject({
      status: "completed",
      attempt: 1,
    });
  });

  it("registers under the configured workerId", async ({
    stateAdapter,
    notifyAdapter,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
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
    const workerId = stateAdapter.config.generateWorkerId();
    const worker = await createInProcessWorker({
      client,
      workerId,
      processors: createProcessors({
        client,
        jobTypes,
        processors: { test: { attemptHandler: async () => undefined as never } },
      }),
    });

    await withWorkers([await worker.start()], async () => {
      await expect.poll(async () => client.getWorker({ id: workerId })).toBeDefined();
    });
  });

  it("registers under the state adapter's generateWorkerId by default", async ({
    stateAdapter,
    notifyAdapter,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const workerId = stateAdapter.config.generateWorkerId();
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        config: { ...stateAdapter.config, generateWorkerId: () => workerId },
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: { test: { attemptHandler: async () => undefined as never } },
      }),
    });

    await withWorkers([await worker.start()], async () => {
      await expect.poll(async () => client.getWorker({ id: workerId })).toBeDefined();
    });
  });

  it("deletes its worker row on stop", async ({
    stateAdapter,
    notifyAdapter,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
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
    const workerId = stateAdapter.config.generateWorkerId();
    const worker = await createInProcessWorker({
      client,
      workerId,
      processors: createProcessors({
        client,
        jobTypes,
        processors: { test: { attemptHandler: async () => undefined as never } },
      }),
    });

    await withWorkers([await worker.start()], async () => {
      await expect.poll(async () => client.getWorker({ id: workerId })).toBeDefined();
    });

    expect(await client.getWorker({ id: workerId })).toBeUndefined();
  });

  it("reclaims the job of an expired worker with a worker of another type and rejects its late `complete`", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
      other: { entry: true; input: null; output: null };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const leaseLosingClient = await createClient({
      stateAdapter: { ...stateAdapter, extendWorkerLease: async () => undefined },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const jobStarted = Promise.withResolvers<void>();
    const handlerReleased = Promise.withResolvers<void>();
    const lateComplete = Promise.withResolvers<unknown>();

    const leaseLosingWorker = await createInProcessWorker({
      client: leaseLosingClient,
      lease: { durationMs: 200, heartbeatMs: 50 },
      processors: createProcessors({
        client: leaseLosingClient,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) => {
              jobStarted.resolve();
              await handlerReleased.promise;
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ).catch((error: unknown) => {
                lateComplete.resolve(error);
                throw error;
              });
            },
          },
          other: { attemptHandler: async () => undefined as never },
        },
      }),
    });
    const otherTypeWorker = await createInProcessWorker({
      client,
      pollIntervalMs: 20,
      processors: pickProcessors(
        createProcessors({
          client,
          jobTypes,
          processors: {
            test: { attemptHandler: async () => undefined as never },
            other: { attemptHandler: async () => undefined as never },
          },
        }),
        ["other"],
      ),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await leaseLosingWorker.start()], async () => {
      await jobStarted.promise;
      await withWorkers([await otherTypeWorker.start()], async () => {
        await expect
          .poll(async () => client.getJob({ id: chain.id }), { interval: 20, timeout: 5000 })
          .toMatchObject({
            status: "pending",
            lastAttemptError: expect.stringContaining("JobAttemptReclaimedError"),
          });
      });
      handlerReleased.resolve();
      await expect(lateComplete.promise).resolves.toBeInstanceOf(JobTakenByAnotherWorkerError);
    });
  });

  it("aborts its attempts when it loses its lease and restarts under the same id", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const firstRenewal = new AbortController();
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        extendWorkerLease: async (params) => {
          if (firstRenewal.signal.aborted) return stateAdapter.extendWorkerLease(params);
          firstRenewal.abort();
          return undefined;
        },
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const workerId = stateAdapter.config.generateWorkerId();
    const worker = await createInProcessWorker({
      client,
      workerId,
      lease: { durationMs: 200, heartbeatMs: 50 },
      recoveryBackoffConfig: { initialDelayMs: 20, multiplier: 1, maxDelayMs: 20 },
      backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, signal, complete }) => {
              if (job.attempt === 1) {
                await new Promise((resolve) => {
                  signal.addEventListener("abort", resolve, { once: true });
                });
                throw new Error("aborted by the lost lease");
              }
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(await client.getJob({ id: chain.id })).toMatchObject({
      status: "completed",
      attempt: 2,
      completedBy: workerId,
    });
  });

  it("waits for a live worker holding its id to expire, then reclaims its job and starts", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
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
    const leaseLosingClient = await createClient({
      stateAdapter: { ...stateAdapter, extendWorkerLease: async () => undefined },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const workerId = stateAdapter.config.generateWorkerId();
    const jobStarted = Promise.withResolvers<void>();
    const handlerReleased = Promise.withResolvers<void>();

    const leaseLosingWorker = await createInProcessWorker({
      client: leaseLosingClient,
      workerId,
      lease: { durationMs: 200, heartbeatMs: 50 },
      processors: createProcessors({
        client: leaseLosingClient,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async () => {
              jobStarted.resolve();
              await handlerReleased.promise;
              throw new Error("released after the job was reclaimed");
            },
          },
        },
      }),
    });
    const sameIdWorker = await createInProcessWorker({
      client,
      workerId,
      recoveryBackoffConfig: { initialDelayMs: 20, multiplier: 1, maxDelayMs: 20 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await leaseLosingWorker.start()], async () => {
      await jobStarted.promise;
      await withWorkers([await sameIdWorker.start()], async () => {
        await client.awaitChain(chain, completionOptions);
      });
      handlerReleased.resolve();
    });

    expect(await client.getJob({ id: chain.id })).toMatchObject({
      status: "completed",
      attempt: 2,
      completedBy: workerId,
    });
  });

  it("keeps the row of the run that replaced a frozen run under the same id", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
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
    const frozenClient = await createClient({
      stateAdapter: {
        ...stateAdapter,
        extendWorkerLease: async ({ txCtx, workerId }) =>
          (await stateAdapter.getWorkers({ txCtx, workerIds: [workerId] }))[0],
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const workerId = stateAdapter.config.generateWorkerId();
    const jobStarted = Promise.withResolvers<void>();

    const frozenWorker = await createInProcessWorker({
      client: frozenClient,
      workerId,
      lease: { durationMs: 200, heartbeatMs: 50 },
      recoveryBackoffConfig: { initialDelayMs: 20, multiplier: 1, maxDelayMs: 20 },
      processors: createProcessors({
        client: frozenClient,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ signal }) => {
              jobStarted.resolve();
              await new Promise((resolve) => {
                signal.addEventListener("abort", resolve, { once: true });
              });
              throw new Error("aborted");
            },
          },
        },
      }),
    });
    const sameIdWorker = await createInProcessWorker({
      client,
      workerId,
      recoveryBackoffConfig: { initialDelayMs: 20, multiplier: 1, maxDelayMs: 20 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    const stopFrozenWorker = await frozenWorker.start();
    await withWorkers([stopFrozenWorker], async () => {
      await jobStarted.promise;
      await withWorkers([await sameIdWorker.start()], async () => {
        await client.awaitChain(chain, completionOptions);
        await stopFrozenWorker();

        expect(await client.getWorker({ id: workerId })).toMatchObject({ id: workerId });
      });
    });

    expect(await client.getJob({ id: chain.id })).toMatchObject({
      status: "completed",
      attempt: 2,
      completedBy: workerId,
    });
  });

  it("reclaims its own job left running by a failed reschedule once it is idle", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const firstReschedule = new AbortController();
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        rescheduleJobs: async (params) => {
          if (firstReschedule.signal.aborted) return stateAdapter.rescheduleJobs(params);
          firstReschedule.abort();
          throw new Error("database unreachable");
        },
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      pollIntervalMs: 20,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt === 1) throw new Error("fails before completing");
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(await client.getJob({ id: chain.id })).toMatchObject({
      status: "completed",
      attempt: 2,
    });
  });

  it("reclaims its own job claimed by a claim that committed but threw once it is idle", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    const firstClaim = new AbortController();
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        startJobAttempts: async (params) => {
          if (firstClaim.signal.aborted) return stateAdapter.startJobAttempts(params);
          firstClaim.abort();
          await stateAdapter.startJobAttempts(params);
          throw new Error("connection lost after commit");
        },
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      pollIntervalMs: 20,
      recoveryBackoffConfig: { initialDelayMs: 10, multiplier: 1, maxDelayMs: 10 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(await client.getJob({ id: chain.id })).toMatchObject({
      status: "completed",
      attempt: 2,
    });
  });

  it("keeps a sibling slot's running attempt when an idle slot reclaims its own jobs", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: { slow: boolean }; output: null };
    }>();

    const slowStarted = Promise.withResolvers<void>();
    const releaseSlow = Promise.withResolvers<void>();
    const fastCompleted = new AbortController();
    const reclaimPassed = Promise.withResolvers<void>();
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        listWorkerJobs: async (params) => {
          const page = await stateAdapter.listWorkerJobs(params);
          if (fastCompleted.signal.aborted) reclaimPassed.resolve();
          return page;
        },
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 2,
      pollIntervalMs: 20,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.input.slow) {
                slowStarted.resolve();
                await releaseSlow.promise;
              }
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const slowChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: { slow: true } }),
    );

    await withWorkers([await worker.start()], async () => {
      await slowStarted.promise;
      const fastChain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { slow: false },
        }),
      );
      await client.awaitChain(fastChain, completionOptions);
      fastCompleted.abort();
      await reclaimPassed.promise;
      releaseSlow.resolve();
      await client.awaitChain(slowChain, completionOptions);
    });

    expect(await client.getJob({ id: slowChain.id })).toMatchObject({
      status: "completed",
      attempt: 1,
    });
  });

  it("keeps the running attempt of a chain recreated under the id of a chain it deleted", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    generateJobId,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: { run: "deleted" | "recreated" }; output: null };
    }>();

    const deletedStarted = Promise.withResolvers<void>();
    const releaseDeleted = Promise.withResolvers<void>();
    const recreatedStarted = Promise.withResolvers<void>();
    const releaseRecreated = Promise.withResolvers<void>();
    const deletedFinished = new AbortController();
    const reclaimPassed = Promise.withResolvers<void>();
    const client = await createClient({
      stateAdapter: {
        ...stateAdapter,
        listWorkerJobs: async (params) => {
          const page = await stateAdapter.listWorkerJobs(params);
          if (deletedFinished.signal.aborted) reclaimPassed.resolve();
          return page;
        },
      },
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 2,
      pollIntervalMs: 20,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.input.run === "deleted") {
                deletedStarted.resolve();
                await releaseDeleted.promise;
                deletedFinished.abort();
                throw new Error("chain was deleted");
              }
              recreatedStarted.resolve();
              await releaseRecreated.promise;
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chainId = generateJobId();
    await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        id: chainId,
        input: { run: "deleted" },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await deletedStarted.promise;
      await withTransaction(async (txCtx, transactionHooks) =>
        client.deleteChain({ ...txCtx, transactionHooks, id: chainId }),
      );
      const recreatedChain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          id: chainId,
          input: { run: "recreated" },
        }),
      );
      await recreatedStarted.promise;
      releaseDeleted.resolve();
      await reclaimPassed.promise;
      releaseRecreated.resolve();
      await client.awaitChain(recreatedChain, completionOptions);
    });

    expect(await client.getJob({ id: chainId })).toMatchObject({
      status: "completed",
      attempt: 1,
    });
  });

  it("applies the worker-level backoffConfig when the processor has none", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
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
      pollIntervalMs: 20,
      backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt < 3) throw new Error("retry");
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(await client.getJob({ id: chain.id })).toMatchObject({
      status: "completed",
      attempt: 3,
    });
  });

  it("prefers the processor-level backoffConfig over the worker-level one", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
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
      pollIntervalMs: 20,
      backoffConfig: { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            attemptHandler: async ({ job, complete }) => {
              if (job.attempt < 2) throw new Error("retry");
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: null }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    expect(await client.getJob({ id: chain.id })).toMatchObject({
      status: "completed",
      attempt: 2,
    });
  });

  it("registers with a 60s lease by default", async ({
    stateAdapter,
    notifyAdapter,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
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
    const workerId = stateAdapter.config.generateWorkerId();
    const worker = await createInProcessWorker({
      client,
      workerId,
      processors: createProcessors({
        client,
        jobTypes,
        processors: { test: { attemptHandler: async () => undefined as never } },
      }),
    });

    await withWorkers([await worker.start()], async () => {
      await expect
        .poll(async () => {
          const registered = await client.getWorker({ id: workerId });
          return registered && registered.leaseUntil.getTime() - registered.startedAt.getTime();
        })
        .toBe(60_000);
    });
  });
};
