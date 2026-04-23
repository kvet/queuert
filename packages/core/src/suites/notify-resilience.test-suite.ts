import { type TestAPI } from "vitest";

import {
  type NotifyAdapter,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const notifyResilienceTestSuite = ({
  it,
}: {
  it: TestAPI<TestSuiteContext & { flakyNotifyAdapter: NotifyAdapter }>;
}): void => {
  it("handles transient notify adapter errors gracefully", async ({
    stateAdapter,
    flakyNotifyAdapter,
    withWorkers,
    withTransaction,
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
      notifyAdapter: flakyNotifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      recoveryBackoffConfig: {
        initialDelayMs: 1,
        multiplier: 1,
        maxDelayMs: 1,
      },
      pollIntervalMs: 1_000_000, // should be processed in a single loop invocation
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

    await withWorkers([await worker.start()], async () => {
      // at least one notify pushes worker to process jobs
      const jobChains = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
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

      await Promise.all(
        jobChains.map(async (chain) =>
          // we have to rely on polling here since notify adapter is flaky
          client.awaitJobChain(chain, { pollIntervalMs: 1000, timeoutMs: 5000 }),
        ),
      );
    });
  });
};
