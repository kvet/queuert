import { TestAPI } from "vitest";
import { createQueuert, defineUnionJobTypes, NotifyAdapter } from "../index.js";
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
    log,
  }) => {
    const jobTypeDefinitions = defineUnionJobTypes<{
      test: {
        input: { value: number; atomic: boolean };
        output: { result: number };
      };
    }>();

    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter: flakyNotifyAdapter,
      log,
      jobTypeDefinitions,
    });

    const worker = queuert.createWorker().implementJobType({
      name: "test",
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
        const jobSequences = await queuert.withNotify(async () =>
          runInTransaction(async (context) =>
            Promise.all(
              Array.from({ length: 20 }, async (_, i) =>
                queuert.startJobSequence({
                  ...context,
                  firstJobTypeName: "test",
                  input: { value: i, atomic: i % 2 === 0 },
                }),
              ),
            ),
          ),
        );

        await Promise.all(
          jobSequences.map(async (seq) =>
            // we have to rely on polling here since notify adapter is flaky
            queuert.waitForJobSequenceCompletion({ ...seq, pollIntervalMs: 1000, timeoutMs: 5000 }),
          ),
        );
      },
    );
  });
};
