import { type TestAPI } from "vitest";

import {
  type StateAdapter,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const stateResilienceTestSuite = ({
  it,
  skipConcurrencyTests = false,
}: {
  it: TestAPI<TestSuiteContext & { flakyStateAdapter: StateAdapter<{ $test: true }, string> }>;
  skipConcurrencyTests?: boolean;
}): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };
  it("handles transient database errors gracefully", async ({
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
        leaseConfig: {
          leaseMs: 10,
          renewIntervalMs: 5,
        },
        processors: {
          test: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
              return complete(async () => ({ result: job.input.value * 2 }));
            },
          },
        },
      }),
    });

    const chains = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChains({
          ...txCtx,
          transactionHooks,
          items: Array.from({ length: 20 }, (_, i) => ({
            typeName: "test",
            input: { value: i, atomic: i % 2 === 0 },
          })),
        }),
      ),
    );

    await withWorkers([await flakyWorker.start()], async () => {
      await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
    });
  });

  it.skipIf(skipConcurrencyTests)(
    "handles transient database errors gracefully with multiple slots",
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
        concurrency: 5,
        // Short poll interval so the worker retries promptly after a transient error.
        // When the complete phase hits a flaky-adapter error and the error handler's
        // withTransaction also fails, the job stays "acquired" with a short lease.
        // The worker must re-poll before the reaper reclaims it, so pollIntervalMs
        // needs to be low enough to beat the lease expiry window.
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
          leaseConfig: {
            leaseMs: 10,
            renewIntervalMs: 5,
          },
          processors: {
            test: {
              attemptHandler: async ({ job, prepare, complete }) => {
                await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
                return complete(async () => ({ result: job.input.value * 2 }));
              },
            },
          },
        }),
      });

      const chains = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.startChains({
            ...txCtx,
            transactionHooks,
            items: Array.from({ length: 20 }, (_, i) => ({
              typeName: "test",
              input: { value: i, atomic: i % 2 === 0 },
            })),
          }),
        ),
      );

      await withWorkers([await flakyWorker.start()], async () => {
        await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
      });
    },
  );

  it.skipIf(skipConcurrencyTests)(
    "handles transient database errors gracefully with multiple workers",
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
        // withTransaction also fails, the job stays "acquired" with a short lease.
        // The worker must re-poll before the reaper reclaims it, so pollIntervalMs
        // needs to be low enough to beat the lease expiry window.
        pollIntervalMs: 100,
      };
      const registryConfig = {
        leaseConfig: {
          leaseMs: 10,
          renewIntervalMs: 5,
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
                return complete(async () => ({ result: job.input.value * 2 }));
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
                return complete(async () => ({ result: job.input.value * 2 }));
              },
            },
          },
        }),
      });

      const chains = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.startChains({
            ...txCtx,
            transactionHooks,
            items: Array.from({ length: 20 }, (_, i) => ({
              typeName: "test",
              input: { value: i, atomic: i % 2 === 0 },
            })),
          }),
        ),
      );

      await withWorkers([await flakyWorker1.start(), await flakyWorker2.start()], async () => {
        await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
      });
    },
  );

  it("handles real database errors gracefully", async ({
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
        leaseConfig: {
          leaseMs: 10,
          renewIntervalMs: 5,
        },
        processors: {
          test: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
              return complete(async () => ({ result: job.input.value * 2 }));
            },
          },
        },
      }),
    });

    const chains = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChains({
          ...txCtx,
          transactionHooks,
          items: Array.from({ length: 20 }, (_, i) => ({
            typeName: "test",
            input: { value: i, atomic: i % 2 === 0 },
          })),
        }),
      ),
    );

    await withWorkers([await flakyWorker.start()], async () => {
      await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
    });
  });

  it.skipIf(skipConcurrencyTests)(
    "handles real database errors gracefully with multiple slots",
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
          leaseConfig: {
            leaseMs: 10,
            renewIntervalMs: 5,
          },
          processors: {
            test: {
              attemptHandler: async ({ job, prepare, complete }) => {
                await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
                return complete(async () => ({ result: job.input.value * 2 }));
              },
            },
          },
        }),
      });

      const chains = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.startChains({
            ...txCtx,
            transactionHooks,
            items: Array.from({ length: 20 }, (_, i) => ({
              typeName: "test",
              input: { value: i, atomic: i % 2 === 0 },
            })),
          }),
        ),
      );

      await withWorkers([await flakyWorker.start()], async () => {
        await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
      });
    },
  );

  it.skipIf(skipConcurrencyTests)(
    "handles real database errors gracefully with multiple workers",
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
        leaseConfig: {
          leaseMs: 10,
          renewIntervalMs: 5,
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
                return complete(async () => ({ result: job.input.value * 2 }));
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
                return complete(async () => ({ result: job.input.value * 2 }));
              },
            },
          },
        }),
      });

      const chains = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.startChains({
            ...txCtx,
            transactionHooks,
            items: Array.from({ length: 20 }, (_, i) => ({
              typeName: "test",
              input: { value: i, atomic: i % 2 === 0 },
            })),
          }),
        ),
      );

      await withWorkers([await flakyWorker1.start(), await flakyWorker2.start()], async () => {
        await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
      });
    },
  );
};
