import { TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createQueuert, defineJobTypes } from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

export const deduplicationTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("deduplicates job sequences with same deduplication key", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    const [sequence1, sequence2, sequence3] = await queuert.withNotify(async () =>
      runInTransaction(async (context) => [
        await queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { value: 1 },
          deduplication: { key: "same-key" },
        }),
        await queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { value: 2 },
          deduplication: { key: "same-key" },
        }),
        await queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { value: 3 },
          deduplication: { key: "different-key" },
        }),
      ]),
    );

    expect(sequence1.deduplicated).toBe(false);
    expect(sequence2.deduplicated).toBe(true);
    expect(sequence2.id).toBe(sequence1.id);
    expect(sequence3.deduplicated).toBe(false);
    expect(sequence3.id).not.toBe(sequence1.id);

    const completed1 = await runInTransaction(async (context) =>
      queuert.completeJobSequence({
        ...context,
        ...sequence1,
        complete: async ({ job, complete }) => {
          return complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );

    const completed3 = await runInTransaction(async (context) =>
      queuert.completeJobSequence({
        ...context,
        ...sequence3,
        complete: async ({ job, complete }) => {
          return complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );

    expect(completed1.output).toEqual({ result: 1 });
    expect(completed3.output).toEqual({ result: 3 });

    // sequence2 was deduplicated to sequence1, so it should have the same output
    const fetched2 = await runInTransaction(async (context) =>
      queuert.getJobSequence({ ...context, ...sequence2 }),
    );
    expect("output" in fetched2! && fetched2.output).toEqual({ result: 1 });
  });

  it("deduplication strategies: 'all' vs 'completed'", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    log,
    observabilityAdapter,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    // Test 'all' strategy - deduplicates against completed jobs
    const allSequence1 = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { value: 1 },
          deduplication: { key: "all-key", strategy: "all" },
        }),
      ),
    );

    await runInTransaction(async (context) =>
      queuert.completeJobSequence({
        ...context,
        ...allSequence1,
        complete: async ({ job, complete }) => {
          await complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );

    const allSequence2 = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { value: 2 },
          deduplication: { key: "all-key", strategy: "all" },
        }),
      ),
    );

    expect(allSequence2.deduplicated).toBe(true);
    expect(allSequence2.id).toBe(allSequence1.id);

    // Test 'completed' strategy - does NOT deduplicate against completed jobs
    const completedSequence1 = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { value: 3 },
          deduplication: { key: "completed-key", strategy: "completed" },
        }),
      ),
    );

    await runInTransaction(async (context) =>
      queuert.completeJobSequence({
        ...context,
        ...completedSequence1,
        complete: async ({ job, complete }) => {
          await complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );

    const completedSequence2 = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { value: 4 },
          deduplication: { key: "completed-key", strategy: "completed" },
        }),
      ),
    );

    expect(completedSequence2.deduplicated).toBe(false);
    expect(completedSequence2.id).not.toBe(completedSequence1.id);

    const completed2 = await runInTransaction(async (context) =>
      queuert.completeJobSequence({
        ...context,
        ...completedSequence2,
        complete: async ({ job, complete }) => {
          return complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );
    expect(completed2.output).toEqual({ result: 4 });
  });

  it("deduplication with windowMs respects time window", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const queuert = await createQueuert({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry: defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>(),
    });

    // Test 'all' strategy with windowMs
    const allSequence1 = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { value: 1 },
          deduplication: { key: "all-key", strategy: "all", windowMs: 50 },
        }),
      ),
    );

    expect(allSequence1.deduplicated).toBe(false);

    await sleep(100);

    const allSequence2 = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { value: 2 },
          deduplication: { key: "all-key", strategy: "all", windowMs: 50 },
        }),
      ),
    );

    expect(allSequence2.deduplicated).toBe(false);
    expect(allSequence2.id).not.toBe(allSequence1.id);

    // Test 'completed' strategy with windowMs
    const completedSequence1 = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { value: 3 },
          deduplication: { key: "completed-key", strategy: "completed", windowMs: 50 },
        }),
      ),
    );

    await runInTransaction(async (context) =>
      queuert.completeJobSequence({
        ...context,
        ...completedSequence1,
        complete: async ({ job, complete }) => {
          await complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );

    await sleep(100);

    const completedSequence2 = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({
          ...context,
          typeName: "test",
          input: { value: 4 },
          deduplication: { key: "completed-key", strategy: "completed", windowMs: 50 },
        }),
      ),
    );

    expect(completedSequence2.deduplicated).toBe(false);
    expect(completedSequence2.id).not.toBe(completedSequence1.id);
  });
};
