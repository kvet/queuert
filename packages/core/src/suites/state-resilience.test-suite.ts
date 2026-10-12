import { type TestAPI } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const stateResilienceTestSuite = ({
  it,
}: {
  it: TestAPI<TestSuiteContext & { flakyStateAdapter: StateAdapter<{ $test: true }, string> }>;
}): void => {
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
          input: { value: number; atomic: boolean };
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
          attemptConfig: {
            timeoutMs: 10,
            heartbeatMs: 5,
          },
          processors: {
            test: {
              attemptHandler: async ({ job, prepare, complete }) => {
                await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
                return complete(async ({ finish }) =>
                  finish({ output: { result: job.input.value * 2 } }),
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
          items: Array.from({ length: 20 }, (_, i) => ({
            typeName: "test",
            input: { value: i, atomic: i % 2 === 0 },
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
          input: { value: number; atomic: boolean };
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
        // When the complete phase hits a flaky-adapter error and the error handler's
        // withTransaction also fails, the job stays "acquired" with a short attempt.
        // The worker must re-poll before the expired attempt is reclaimed, so pollIntervalMs
        // needs to be low enough to beat the attempt expiry window.
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
          attemptConfig: {
            timeoutMs: 10,
            heartbeatMs: 5,
          },
          processors: {
            test: {
              attemptHandler: async ({ job, prepare, complete }) => {
                await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
                return complete(async ({ finish }) =>
                  finish({ output: { result: job.input.value * 2 } }),
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
          items: Array.from({ length: 20 }, (_, i) => ({
            typeName: "test",
            input: { value: i, atomic: i % 2 === 0 },
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
          input: { value: number; atomic: boolean };
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
        // When the complete phase hits a flaky-adapter error and the error handler's
        // withTransaction also fails, the job stays "acquired" with a short attempt.
        // The worker must re-poll before the expired attempt is reclaimed, so pollIntervalMs
        // needs to be low enough to beat the attempt expiry window.
        pollIntervalMs: 100,
      };
      const registryConfig = {
        attemptConfig: {
          timeoutMs: 10,
          heartbeatMs: 5,
        },
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
              attemptHandler: async ({ job, prepare, complete }) => {
                await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
                return complete(async ({ finish }) =>
                  finish({ output: { result: job.input.value * 2 } }),
                );
              },
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
              attemptHandler: async ({ job, prepare, complete }) => {
                await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
                return complete(async ({ finish }) =>
                  finish({ output: { result: job.input.value * 2 } }),
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
          items: Array.from({ length: 20 }, (_, i) => ({
            typeName: "test",
            input: { value: i, atomic: i % 2 === 0 },
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
          input: { value: number; atomic: boolean };
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
          attemptConfig: {
            timeoutMs: 10,
            heartbeatMs: 5,
          },
          processors: {
            test: {
              attemptHandler: async ({ job, prepare, complete }) => {
                await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
                return complete(async ({ finish }) =>
                  finish({ output: { result: job.input.value * 2 } }),
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
          items: Array.from({ length: 20 }, (_, i) => ({
            typeName: "test",
            input: { value: i, atomic: i % 2 === 0 },
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
          input: { value: number; atomic: boolean };
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
          attemptConfig: {
            timeoutMs: 10,
            heartbeatMs: 5,
          },
          processors: {
            test: {
              attemptHandler: async ({ job, prepare, complete }) => {
                await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
                return complete(async ({ finish }) =>
                  finish({ output: { result: job.input.value * 2 } }),
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
          items: Array.from({ length: 20 }, (_, i) => ({
            typeName: "test",
            input: { value: i, atomic: i % 2 === 0 },
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
          input: { value: number; atomic: boolean };
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
        attemptConfig: {
          timeoutMs: 10,
          heartbeatMs: 5,
        },
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
              attemptHandler: async ({ job, prepare, complete }) => {
                await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
                return complete(async ({ finish }) =>
                  finish({ output: { result: job.input.value * 2 } }),
                );
              },
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
              attemptHandler: async ({ job, prepare, complete }) => {
                await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
                return complete(async ({ finish }) =>
                  finish({ output: { result: job.input.value * 2 } }),
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
          items: Array.from({ length: 20 }, (_, i) => ({
            typeName: "test",
            input: { value: i, atomic: i % 2 === 0 },
          })),
        }),
      );

      await withWorkers([await flakyWorker1.start(), await flakyWorker2.start()], async () => {
        await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
      });
    },
  );

  it(
    "resets the recovery backoff once the worker loop recovers",
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
      const { promise: recovered, resolve: onRecovered } = Promise.withResolvers<void>();
      const flakyStartStateAdapter: typeof stateAdapter = {
        ...stateAdapter,
        startJobAttempt: async (params) => {
          if (failuresLeft > 0) {
            failuresLeft--;
            throw new Error("startJobAttempt failed");
          }
          const result = await stateAdapter.startJobAttempt(params);
          onRecovered();
          return result;
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
                complete(async ({ finish }) => finish({ output: null })),
            },
          },
        }),
      });

      await withWorkers([await worker.start()], async () => {
        await recovered;

        failuresLeft = 1;
        const chain = await withTransaction(async (txCtx, transactionHooks) =>
          client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
        );
        await client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 5000 });
      });
    },
  );
};
