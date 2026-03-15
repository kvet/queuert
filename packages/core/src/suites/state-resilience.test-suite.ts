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
    const registry = defineJobTypeRegistry<{
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
      registry,
    });
    const flakyWorkerClient = await createClient({
      stateAdapter: flakyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const flakyWorker = await createInProcessWorker({
      client: flakyWorkerClient,
      concurrency: 1,
      backoffConfig: {
        initialDelayMs: 1,
        multiplier: 1,
        maxDelayMs: 1,
      },
      processDefaults: {
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
      processorRegistry: createJobTypeProcessorRegistry(client, registry, {
        test: {
          attemptHandler: async ({ job, prepare, complete }) => {
            await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
            return complete(async () => ({ result: job.input.value * 2 }));
          },
        },
      }),
    });

    const jobChains = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        Promise.all(
          Array.from({ length: 20 }, async (_, i) =>
            client.startJobChain({
              ...txCtx,
              transactionHooks,
              typeName: "test",
              input: { value: i, atomic: i % 2 === 0 },
            }),
          ),
        ),
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
      const registry = defineJobTypeRegistry<{
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
        registry,
      });
      const flakyWorkerClient = await createClient({
        stateAdapter: flakyStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });
      const flakyWorker = await createInProcessWorker({
        client: flakyWorkerClient,
        concurrency: 5,
        backoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        processDefaults: {
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
        processorRegistry: createJobTypeProcessorRegistry(client, registry, {
          test: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
              return complete(async () => ({ result: job.input.value * 2 }));
            },
          },
        }),
      });

      const jobChains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          Promise.all(
            Array.from({ length: 20 }, async (_, i) =>
              client.startJobChain({
                ...txCtx,
                transactionHooks,
                typeName: "test",
                input: { value: i, atomic: i % 2 === 0 },
              }),
            ),
          ),
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
      const registry = defineJobTypeRegistry<{
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
        registry,
      });
      const flakyWorkerClient = await createClient({
        stateAdapter: flakyStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });
      const workerConfig = {
        client: flakyWorkerClient,
        concurrency: 5,
        backoffConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        processDefaults: {
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
      } as const;
      const flakyWorker1 = await createInProcessWorker({
        ...workerConfig,
        processorRegistry: createJobTypeProcessorRegistry(client, registry, {
          test: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
              return complete(async () => ({ result: job.input.value * 2 }));
            },
          },
        }),
      });
      const flakyWorker2 = await createInProcessWorker({
        ...workerConfig,
        processorRegistry: createJobTypeProcessorRegistry(client, registry, {
          test: {
            attemptHandler: async ({ job, prepare, complete }) => {
              await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
              return complete(async () => ({ result: job.input.value * 2 }));
            },
          },
        }),
      });

      const jobChains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          Promise.all(
            Array.from({ length: 20 }, async (_, i) =>
              client.startJobChain({
                ...txCtx,
                transactionHooks,
                typeName: "test",
                input: { value: i, atomic: i % 2 === 0 },
              }),
            ),
          ),
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
