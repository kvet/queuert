import { TestAPI } from "vitest";
import { createQueuert, defineUnionJobTypes, StateAdapter } from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

export const stateResilienceTestSuite = ({
  it,
}: {
  it: TestAPI<TestSuiteContext & { flakyStateAdapter: StateAdapter<{ $test: true }, string> }>;
}): void => {
  it("handles transient database errors gracefully", async ({
    flakyStateAdapter,
    stateAdapter,
    notifyAdapter,
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
      notifyAdapter,
      log,
      jobTypeDefinitions,
    });
    const flakyQueuert = await createQueuert({
      stateAdapter: flakyStateAdapter,
      notifyAdapter,
      log,
      jobTypeDefinitions,
    });

    const flakyWorker = flakyQueuert.createWorker().implementJobType({
      name: "test",
      process: async ({ job, prepare, complete }) => {
        await prepare({ mode: job.input.atomic ? "atomic" : "staged" });
        return complete(async () => ({ result: job.input.value * 2 }));
      },
    });

    const jobSequences = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        Promise.all(
          Array.from({ length: 20 }, async (_, i) =>
            queuert.startJobSequence({
              ...context,
              typeName: "test",
              input: { value: i, atomic: i % 2 === 0 },
            }),
          ),
        ),
      ),
    );

    await withWorkers(
      [
        await flakyWorker.start({
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
        await Promise.all(
          jobSequences.map(async (seq) =>
            queuert.waitForJobSequenceCompletion({ ...seq, timeoutMs: 1000 }),
          ),
        );
      },
    );
  });
};
