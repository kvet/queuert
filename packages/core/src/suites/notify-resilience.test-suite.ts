import { TestAPI } from "vitest";
import { createQueuert, defineJobTypes, NotifyAdapter } from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

export const notifyResilienceTestSuite = ({
  it,
}: {
  it: TestAPI<TestSuiteContext & { flakyNotifyAdapter: NotifyAdapter }>;
}): void => {
  it("handles transient notify adapter errors gracefully", async ({
    stateAdapter,
    flakyNotifyAdapter,
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

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter: flakyNotifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });

    const worker = queuert.createWorker().implementJobType({
      typeName: "test",
      process: async ({ job, prepare, complete }) => {
        await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
        return complete(async () => ({ result: job.input.value * 2 }));
      },
    });

    await withWorkers(
      [
        await worker.start({
          pollIntervalMs: 1_000_000, // should be processed in a single loop invocations
          nextJobDelayMs: 0,
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
        }),
      ],
      async () => {
        // at least one notify pushes worker to process jobs
        const jobChains = await queuert.withNotify(async () =>
          runInTransaction(async (context) =>
            Promise.all(
              Array.from({ length: 20 }, async (_, i) =>
                queuert.startJobChain({
                  ...context,
                  typeName: "test",
                  input: { value: i, atomic: i % 2 === 0 },
                }),
              ),
            ),
          ),
        );

        await Promise.all(
          jobChains.map(async (chain) =>
            // we have to rely on polling here since notify adapter is flaky
            queuert.waitForJobChainCompletion(chain, { pollIntervalMs: 1000, timeoutMs: 5000 }),
          ),
        );
      },
    );
  });
};
