import { sleep } from "@queuert/helpers";
import { type TestAPI, expect } from "vitest";

import { createClient } from "../client.ts";
import { createInProcessWorker } from "../in-process-worker.ts";
import { createProcessors } from "../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../job-types/define-job-types.ts";
import { withTransactionHooks } from "../transaction-hooks.ts";
import type { TestSuiteContext } from "./spec-context.spec-helper.ts";

export const stateResilienceTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 15000,
  };
  it(
    "handles transient database errors gracefully",
    { timeout: 15000 },
    async ({
      flakyStateAdapter,
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
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });
      const flakyWorkerClient = await createClient({
        stateAdapter: flakyStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });
      const flakyWorker = await createInProcessWorker({
        client: flakyWorkerClient,
        concurrency: 1,
        // should be processed in a single worker loop
        pollIntervalMs: 10_000,
        recoveryBackoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        processors: createProcessors({
          client,
          jobTypes,
          backoffConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
          processors: {
            test: {
              attemptHandler: async ({ job, complete }) =>
                withTransactionHooks(async (transactionHooks) =>
                  flakyStateAdapter.withTransaction(async (txCtx) =>
                    complete({
                      ...txCtx,
                      transactionHooks,
                      output: { result: job.input.value * 2 },
                    }),
                  ),
                ),
            },
          },
        }),
      });

      const chains = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: Array.from({ length: 20 }, (_, i) => ({
            typeName: "test",
            input: { value: i },
          })),
        }),
      );

      await withWorkers([await flakyWorker.start()], async () => {
        await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
      });
    },
  );

  it(
    "handles transient database errors gracefully with multiple slots",
    { timeout: 15000 },
    async ({
      transactionConcurrency,
      flakyStateAdapter,
      stateAdapter,
      notifyAdapter,
      withTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      skip,
    }) => {
      if (transactionConcurrency === "serialized") return skip();
      const jobTypes = defineJobTypes<{
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
        jobTypes,
      });
      const flakyWorkerClient = await createClient({
        stateAdapter: flakyStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });
      const flakyWorker = await createInProcessWorker({
        client: flakyWorkerClient,
        concurrency: 5,
        // Short poll interval so the worker retries promptly after a transient error.
        // When complete hits a flaky-adapter error and the reschedule under its attempt token also fails, the job
        // stays running until its short attempt timeout expires and the worker reclaims it on a re-poll.
        pollIntervalMs: 250,
        recoveryBackoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        processors: createProcessors({
          client,
          jobTypes,
          backoffConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
          processors: {
            test: {
              attemptHandler: async ({ job, complete }) =>
                withTransactionHooks(async (transactionHooks) =>
                  flakyStateAdapter.withTransaction(async (txCtx) =>
                    complete({
                      ...txCtx,
                      transactionHooks,
                      output: { result: job.input.value * 2 },
                    }),
                  ),
                ),
            },
          },
        }),
      });

      const chains = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: Array.from({ length: 20 }, (_, i) => ({
            typeName: "test",
            input: { value: i },
          })),
        }),
      );

      await withWorkers([await flakyWorker.start()], async () => {
        await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
      });
    },
  );

  it(
    "handles transient database errors gracefully with multiple workers",
    { timeout: 15000 },
    async ({
      transactionConcurrency,
      flakyStateAdapter,
      stateAdapter,
      notifyAdapter,
      withTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      skip,
    }) => {
      if (transactionConcurrency === "serialized") return skip();
      const jobTypes = defineJobTypes<{
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
        jobTypes,
      });
      const flakyWorkerClient = await createClient({
        stateAdapter: flakyStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });
      const workerConfig = {
        client: flakyWorkerClient,
        concurrency: 5,
        recoveryBackoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        // Short poll interval so the worker retries promptly after a transient error.
        // When complete hits a flaky-adapter error and the reschedule under its attempt token also fails, the job
        // stays running until its short attempt timeout expires and the worker reclaims it on a re-poll.
        pollIntervalMs: 100,
      };
      const registryConfig = {
        backoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
      };
      const flakyWorker1 = await createInProcessWorker({
        ...workerConfig,
        processors: createProcessors({
          client,
          jobTypes,
          ...registryConfig,
          processors: {
            test: {
              attemptHandler: async ({ job, complete }) =>
                withTransactionHooks(async (transactionHooks) =>
                  flakyStateAdapter.withTransaction(async (txCtx) =>
                    complete({
                      ...txCtx,
                      transactionHooks,
                      output: { result: job.input.value * 2 },
                    }),
                  ),
                ),
            },
          },
        }),
      });
      const flakyWorker2 = await createInProcessWorker({
        ...workerConfig,
        processors: createProcessors({
          client,
          jobTypes,
          ...registryConfig,
          processors: {
            test: {
              attemptHandler: async ({ job, complete }) =>
                withTransactionHooks(async (transactionHooks) =>
                  flakyStateAdapter.withTransaction(async (txCtx) =>
                    complete({
                      ...txCtx,
                      transactionHooks,
                      output: { result: job.input.value * 2 },
                    }),
                  ),
                ),
            },
          },
        }),
      });

      const chains = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: Array.from({ length: 20 }, (_, i) => ({
            typeName: "test",
            input: { value: i },
          })),
        }),
      );

      await withWorkers([await flakyWorker1.start(), await flakyWorker2.start()], async () => {
        await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
      });
    },
  );

  it(
    "handles real database errors gracefully",
    { timeout: 15000 },
    async ({
      flakyDbStateAdapter,
      stateAdapter,
      notifyAdapter,
      withTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      skip,
    }) => {
      if (!flakyDbStateAdapter) return skip();

      const jobTypes = defineJobTypes<{
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
        jobTypes,
      });
      const flakyWorkerClient = await createClient({
        stateAdapter: flakyDbStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });
      const flakyWorker = await createInProcessWorker({
        client: flakyWorkerClient,
        concurrency: 1,
        pollIntervalMs: 10_000,
        recoveryBackoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        processors: createProcessors({
          client,
          jobTypes,
          backoffConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
          processors: {
            test: {
              attemptHandler: async ({ job, complete }) =>
                withTransactionHooks(async (transactionHooks) =>
                  flakyDbStateAdapter.withTransaction(async (txCtx) =>
                    complete({
                      ...txCtx,
                      transactionHooks,
                      output: { result: job.input.value * 2 },
                    }),
                  ),
                ),
            },
          },
        }),
      });

      const chains = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: Array.from({ length: 20 }, (_, i) => ({
            typeName: "test",
            input: { value: i },
          })),
        }),
      );

      await withWorkers([await flakyWorker.start()], async () => {
        await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
      });
    },
  );

  it(
    "handles real database errors gracefully with multiple slots",
    { timeout: 15000 },
    async ({
      transactionConcurrency,
      flakyDbStateAdapter,
      stateAdapter,
      notifyAdapter,
      withTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      skip,
    }) => {
      if (!flakyDbStateAdapter) return skip();
      if (transactionConcurrency === "serialized") return skip();

      const jobTypes = defineJobTypes<{
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
        jobTypes,
      });
      const flakyWorkerClient = await createClient({
        stateAdapter: flakyDbStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });
      const flakyWorker = await createInProcessWorker({
        client: flakyWorkerClient,
        concurrency: 5,
        pollIntervalMs: 250,
        recoveryBackoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        processors: createProcessors({
          client,
          jobTypes,
          backoffConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
          processors: {
            test: {
              attemptHandler: async ({ job, complete }) =>
                withTransactionHooks(async (transactionHooks) =>
                  flakyDbStateAdapter.withTransaction(async (txCtx) =>
                    complete({
                      ...txCtx,
                      transactionHooks,
                      output: { result: job.input.value * 2 },
                    }),
                  ),
                ),
            },
          },
        }),
      });

      const chains = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: Array.from({ length: 20 }, (_, i) => ({
            typeName: "test",
            input: { value: i },
          })),
        }),
      );

      await withWorkers([await flakyWorker.start()], async () => {
        await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
      });
    },
  );

  it(
    "handles real database errors gracefully with multiple workers",
    { timeout: 15000 },
    async ({
      transactionConcurrency,
      flakyDbStateAdapter,
      stateAdapter,
      notifyAdapter,
      withTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      skip,
    }) => {
      if (!flakyDbStateAdapter) return skip();
      if (transactionConcurrency === "serialized") return skip();

      const jobTypes = defineJobTypes<{
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
        jobTypes,
      });
      const flakyWorkerClient = await createClient({
        stateAdapter: flakyDbStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });
      const workerConfig = {
        client: flakyWorkerClient,
        concurrency: 5,
        pollIntervalMs: 100,
        recoveryBackoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
      };
      const registryConfig = {
        backoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
      };
      const flakyWorker1 = await createInProcessWorker({
        ...workerConfig,
        processors: createProcessors({
          client,
          jobTypes,
          ...registryConfig,
          processors: {
            test: {
              attemptHandler: async ({ job, complete }) =>
                withTransactionHooks(async (transactionHooks) =>
                  flakyDbStateAdapter.withTransaction(async (txCtx) =>
                    complete({
                      ...txCtx,
                      transactionHooks,
                      output: { result: job.input.value * 2 },
                    }),
                  ),
                ),
            },
          },
        }),
      });
      const flakyWorker2 = await createInProcessWorker({
        ...workerConfig,
        processors: createProcessors({
          client,
          jobTypes,
          ...registryConfig,
          processors: {
            test: {
              attemptHandler: async ({ job, complete }) =>
                withTransactionHooks(async (transactionHooks) =>
                  flakyDbStateAdapter.withTransaction(async (txCtx) =>
                    complete({
                      ...txCtx,
                      transactionHooks,
                      output: { result: job.input.value * 2 },
                    }),
                  ),
                ),
            },
          },
        }),
      });

      const chains = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: Array.from({ length: 20 }, (_, i) => ({
            typeName: "test",
            input: { value: i },
          })),
        }),
      );

      await withWorkers([await flakyWorker1.start(), await flakyWorker2.start()], async () => {
        await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
      });
    },
  );

  it(
    "resets the recovery backoff once the worker starts a job",
    { timeout: 15000 },
    async ({
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

      let failuresLeft = 2;
      const flakyStartStateAdapter: typeof stateAdapter = {
        ...stateAdapter,
        startJobAttempts: async (params) => {
          if (failuresLeft > 0) {
            failuresLeft--;
            throw new Error("startJobAttempts failed");
          }
          return stateAdapter.startJobAttempts(params);
        },
      };

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });
      const workerClient = await createClient({
        stateAdapter: flakyStartStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });
      const worker = await createInProcessWorker({
        client: workerClient,
        pollIntervalMs: 100,
        // Delays of 10ms, 1s, then 60s: only a reset keeps the third failure short.
        recoveryBackoffConfig: { initialDelayMs: 10, multiplier: 100, maxDelayMs: 60_000 },
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

      const firstChain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      );

      await withWorkers([await worker.start()], async () => {
        await client.awaitChain(firstChain, { pollIntervalMs: 100, timeoutMs: 5000 });

        failuresLeft = 1;
        const secondChain = await withTransaction(async (txCtx, transactionHooks) =>
          client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
        );
        await client.awaitChain(secondChain, { pollIntervalMs: 100, timeoutMs: 5000 });
      });
    },
  );

  it("aborts the attempts of a worker that lost its lease and completes them once it registers again under the same id", async ({
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
    const workerClient = await createClient({
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
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 2,
      pollIntervalMs: 50,
      recoveryBackoffConfig: { initialDelayMs: 10, multiplier: 1, maxDelayMs: 10 },
      leaseConfig: { durationMs: 300, heartbeatMs: 50 },
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        processors: {
          test: {
            attemptHandler: async ({ job, signal, complete }) => {
              if (job.attempt === 1) {
                await sleep(Number.POSITIVE_INFINITY, { signal });
                throw new Error("lease lost");
              }
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
        items: [
          { typeName: "test", input: null },
          { typeName: "test", input: null },
        ],
      }),
    );

    await withWorkers([await worker.start()], async () => {
      await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
    });

    expect(await client.getJobs({ ids: chains.map((chain) => chain.id) })).toEqual([
      expect.objectContaining({ status: "completed", attempt: 2 }),
      expect.objectContaining({ status: "completed", attempt: 2 }),
    ]);
  });
};
