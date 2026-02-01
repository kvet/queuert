import { type TestAPI } from "vitest";
import {
  type StateAdapter,
  createQueuertClient,
  createQueuertInProcessWorker,
  defineJobTypes,
} from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const stateResilienceTestSuite = ({
  it,
  skipConcurrencyTests = false,
}: {
  it: TestAPI<TestSuiteContext & { flakyStateAdapter: StateAdapter<{ $test: true }, string> }>;
  skipConcurrencyTests?: boolean;
}): void => {
  it("handles transient database errors gracefully", async ({
    flakyStateAdapter,
    stateAdapter,
    notifyAdapter,
    withWorkers,
    runInTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number; atomic: boolean };
        output: { result: number };
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });
    const flakyWorker = await createQueuertInProcessWorker({
      stateAdapter: flakyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      concurrency: { maxSlots: 1 },
      jobTypeProcessing: {
        pollIntervalMs: 1_000_000, // should be processed in a single loop invocations
        defaultLeaseConfig: {
          leaseMs: 10,
          renewIntervalMs: 5,
        },
        defaultRetryConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
        workerLoopRetryConfig: {
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1,
        },
      },
      jobTypeProcessors: {
        test: {
          process: async ({ job, prepare, complete }) => {
            await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
            return complete(async () => ({ result: job.input.value * 2 }));
          },
        },
      },
    });

    const jobChains = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        Promise.all(
          Array.from({ length: 20 }, async (_, i) =>
            client.startJobChain({
              ...txContext,
              typeName: "test",
              input: { value: i, atomic: i % 2 === 0 },
            }),
          ),
        ),
      ),
    );

    await withWorkers([await flakyWorker.start()], async () => {
      await Promise.all(
        jobChains.map(async (chain) =>
          client.waitForJobChainCompletion(chain, { timeoutMs: 1000 }),
        ),
      );
    });
  });

  it.skipIf(skipConcurrencyTests)(
    "handles transient database errors gracefully with multiple slots",
    async ({
      flakyStateAdapter,
      stateAdapter,
      notifyAdapter,
      withWorkers,
      runInTransaction,
      observabilityAdapter,
      log,
    }) => {
      const jobTypeRegistry = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number; atomic: boolean };
          output: { result: number };
        };
      }>();

      const client = await createQueuertClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypeRegistry,
      });
      const flakyWorker = await createQueuertInProcessWorker({
        stateAdapter: flakyStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypeRegistry,
        concurrency: { maxSlots: 5 },
        jobTypeProcessing: {
          pollIntervalMs: 1_000_000, // should be processed in a single loop invocations
          defaultLeaseConfig: {
            leaseMs: 10,
            renewIntervalMs: 5,
          },
          defaultRetryConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
          workerLoopRetryConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
        },
        jobTypeProcessors: {
          test: {
            process: async ({ job, prepare, complete }) => {
              await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
              return complete(async () => ({ result: job.input.value * 2 }));
            },
          },
        },
      });

      const jobChains = await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          Promise.all(
            Array.from({ length: 20 }, async (_, i) =>
              client.startJobChain({
                ...txContext,
                typeName: "test",
                input: { value: i, atomic: i % 2 === 0 },
              }),
            ),
          ),
        ),
      );

      await withWorkers([await flakyWorker.start()], async () => {
        await Promise.all(
          jobChains.map(async (chain) =>
            client.waitForJobChainCompletion(chain, { timeoutMs: 1000 }),
          ),
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
      withWorkers,
      runInTransaction,
      observabilityAdapter,
      log,
    }) => {
      const jobTypeRegistry = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number; atomic: boolean };
          output: { result: number };
        };
      }>();

      const client = await createQueuertClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypeRegistry,
      });
      const workerConfig = {
        stateAdapter: flakyStateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypeRegistry,
        concurrency: { maxSlots: 5 },
        jobTypeProcessing: {
          pollIntervalMs: 1_000_000, // should be processed in a single loop invocations
          defaultLeaseConfig: {
            leaseMs: 10,
            renewIntervalMs: 5,
          },
          defaultRetryConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
          workerLoopRetryConfig: {
            initialDelayMs: 1,
            multiplier: 1,
            maxDelayMs: 1,
          },
        },
      } as const;
      const flakyWorker1 = await createQueuertInProcessWorker({
        ...workerConfig,
        jobTypeProcessors: {
          test: {
            process: async ({ job, prepare, complete }) => {
              await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
              return complete(async () => ({ result: job.input.value * 2 }));
            },
          },
        },
      });
      const flakyWorker2 = await createQueuertInProcessWorker({
        ...workerConfig,
        jobTypeProcessors: {
          test: {
            process: async ({ job, prepare, complete }) => {
              await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
              return complete(async () => ({ result: job.input.value * 2 }));
            },
          },
        },
      });

      const jobChains = await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          Promise.all(
            Array.from({ length: 20 }, async (_, i) =>
              client.startJobChain({
                ...txContext,
                typeName: "test",
                input: { value: i, atomic: i % 2 === 0 },
              }),
            ),
          ),
        ),
      );

      await withWorkers([await flakyWorker1.start(), await flakyWorker2.start()], async () => {
        await Promise.all(
          jobChains.map(async (chain) =>
            client.waitForJobChainCompletion(chain, { timeoutMs: 1000 }),
          ),
        );
      });
    },
  );
};
