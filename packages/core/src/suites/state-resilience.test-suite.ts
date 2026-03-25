import { type TestAPI } from "vitest";
import {
  type StateAdapter,
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
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
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const jobTypeRegistry = defineJobTypeRegistry<{
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
      jobTypeRegistry,
    });
    const flakyWorkerClient = await createClient({
      stateAdapter: flakyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });
    const flakyWorker = await createInProcessWorker({
      client: flakyWorkerClient,
      concurrency: 1,
      backoffConfig: {
        initialDelayMs: 1,
        multiplier: 1,
        maxDelayMs: 1,
      },
      jobTypeProcessorDefaults: {
        // should be processed in a single worker loop
        pollIntervalMs: 10_000,
        leaseConfig: {
          leaseMs: 10,
          renewIntervalMs: 5,
        },
        backoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
      },
      jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
        client,
        jobTypeRegistry,
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

    const jobChains = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChains({
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
      await Promise.all(
        jobChains.map(async (chain) => client.awaitJobChain(chain, completionOptions)),
      );
    });
  });

  it.skipIf(skipConcurrencyTests)(
    "handles transient database errors gracefully with multiple slots",
    async ({
      flakyStateAdapter,
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      withWorkers,
      observabilityAdapter,
      log,
    }) => {
      const jobTypeRegistry = defineJobTypeRegistry<{
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
        jobTypeRegistry,
      });
      const flakyWorkerClient = await createClient({
        stateAdapter: flakyStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypeRegistry,
      });
      const flakyWorker = await createInProcessWorker({
        client: flakyWorkerClient,
        concurrency: 5,
        backoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        jobTypeProcessorDefaults: {
          // Short poll interval so the worker retries promptly after a transient error.
          // When the complete phase hits a flaky-adapter error and the error handler's
          // runInTransaction also fails, the job stays "acquired" with a short lease.
          // The worker must re-poll before the reaper reclaims it, so pollIntervalMs
          // needs to be low enough to beat the lease expiry window.
          pollIntervalMs: 250,
          leaseConfig: {
            leaseMs: 10,
            renewIntervalMs: 5,
          },
          backoffConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
        },
        jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
          client,
          jobTypeRegistry,
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

      const jobChains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChains({
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
        await Promise.all(
          jobChains.map(async (chain) => client.awaitJobChain(chain, completionOptions)),
        );
      });
    },
  );

  it.skipIf(skipConcurrencyTests)(
    "handles transient database errors gracefully with multiple workers",
    async ({
      flakyStateAdapter,
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      withWorkers,
      observabilityAdapter,
      log,
    }) => {
      const jobTypeRegistry = defineJobTypeRegistry<{
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
        jobTypeRegistry,
      });
      const flakyWorkerClient = await createClient({
        stateAdapter: flakyStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypeRegistry,
      });
      const workerConfig = {
        client: flakyWorkerClient,
        concurrency: 5,
        backoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        jobTypeProcessorDefaults: {
          // Short poll interval so the worker retries promptly after a transient error.
          // When the complete phase hits a flaky-adapter error and the error handler's
          // runInTransaction also fails, the job stays "acquired" with a short lease.
          // The worker must re-poll before the reaper reclaims it, so pollIntervalMs
          // needs to be low enough to beat the lease expiry window.
          pollIntervalMs: 100,
          leaseConfig: {
            leaseMs: 10,
            renewIntervalMs: 5,
          },
          backoffConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
        },
      };
      const flakyWorker1 = await createInProcessWorker({
        ...workerConfig,
        jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
          client,
          jobTypeRegistry,
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
        jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
          client,
          jobTypeRegistry,
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

      const jobChains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChains({
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
        await Promise.all(
          jobChains.map(async (chain) => client.awaitJobChain(chain, completionOptions)),
        );
      });
    },
  );

  it("handles real database errors gracefully", async ({
    flakyDbStateAdapter,
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    skip,
  }) => {
    if (!flakyDbStateAdapter) return skip();

    const jobTypeRegistry = defineJobTypeRegistry<{
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
      jobTypeRegistry,
    });
    const flakyWorkerClient = await createClient({
      stateAdapter: flakyDbStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });
    const flakyWorker = await createInProcessWorker({
      client: flakyWorkerClient,
      concurrency: 1,
      backoffConfig: {
        initialDelayMs: 1,
        multiplier: 1,
        maxDelayMs: 1,
      },
      jobTypeProcessorDefaults: {
        pollIntervalMs: 10_000,
        leaseConfig: {
          leaseMs: 10,
          renewIntervalMs: 5,
        },
        backoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
      },
      jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
        client,
        jobTypeRegistry,
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

    const jobChains = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChains({
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
      await Promise.all(
        jobChains.map(async (chain) => client.awaitJobChain(chain, completionOptions)),
      );
    });
  });

  it.skipIf(skipConcurrencyTests)(
    "handles real database errors gracefully with multiple slots",
    async ({
      flakyDbStateAdapter,
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      skip,
    }) => {
      if (!flakyDbStateAdapter) return skip();

      const jobTypeRegistry = defineJobTypeRegistry<{
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
        jobTypeRegistry,
      });
      const flakyWorkerClient = await createClient({
        stateAdapter: flakyDbStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypeRegistry,
      });
      const flakyWorker = await createInProcessWorker({
        client: flakyWorkerClient,
        concurrency: 5,
        backoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        jobTypeProcessorDefaults: {
          pollIntervalMs: 250,
          leaseConfig: {
            leaseMs: 10,
            renewIntervalMs: 5,
          },
          backoffConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
        },
        jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
          client,
          jobTypeRegistry,
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

      const jobChains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChains({
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
        await Promise.all(
          jobChains.map(async (chain) => client.awaitJobChain(chain, completionOptions)),
        );
      });
    },
  );

  it.skipIf(skipConcurrencyTests)(
    "handles real database errors gracefully with multiple workers",
    async ({
      flakyDbStateAdapter,
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      skip,
    }) => {
      if (!flakyDbStateAdapter) return skip();

      const jobTypeRegistry = defineJobTypeRegistry<{
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
        jobTypeRegistry,
      });
      const flakyWorkerClient = await createClient({
        stateAdapter: flakyDbStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypeRegistry,
      });
      const workerConfig = {
        client: flakyWorkerClient,
        concurrency: 5,
        backoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        jobTypeProcessorDefaults: {
          pollIntervalMs: 100,
          leaseConfig: {
            leaseMs: 10,
            renewIntervalMs: 5,
          },
          backoffConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
        },
      };
      const flakyWorker1 = await createInProcessWorker({
        ...workerConfig,
        jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
          client,
          jobTypeRegistry,
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
        jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
          client,
          jobTypeRegistry,
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

      const jobChains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChains({
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
        await Promise.all(
          jobChains.map(async (chain) => client.awaitJobChain(chain, completionOptions)),
        );
      });
    },
  );
};
