import { TestAPI } from "vitest";
import {
  createQueuert,
  defineJobTypes,
  WaitForJobSequenceCompletionTimeoutError,
} from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

export const waitSequenceCompletionTestSuite = ({
  it,
}: {
  it: TestAPI<TestSuiteContext>;
}): void => {
  // check completion scenario with workers completing jobs

  it("handles already completed sequences", async ({
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
          input: null;
          output: { result: string };
        };
      }>(),
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({ ...context, typeName: "test", input: null }),
      ),
    );

    await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.completeJobSequence({
          ...context,
          ...jobSequence,
          complete: async ({ job, complete }) => {
            return complete(job, async () => ({ result: "done" }));
          },
        }),
      ),
    );

    const signal = AbortSignal.timeout(100);
    const completedSequence = await queuert.waitForJobSequenceCompletion(jobSequence, {
      signal,
      timeoutMs: 5000,
    });
    expect(signal.aborted).toBe(false);

    expect(completedSequence.status).toBe("completed");
    expect(completedSequence.output).toEqual({ result: "done" });
  });

  it("throws timeout error when sequence does not complete in time with abort signal", async ({
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
          input: null;
          output: { result: string };
        };
      }>(),
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({ ...context, typeName: "test", input: null }),
      ),
    );

    const fastSignal = AbortSignal.timeout(1);
    const slowSignal = AbortSignal.timeout(100);
    await expect(
      queuert.waitForJobSequenceCompletion(jobSequence, {
        signal: fastSignal,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(WaitForJobSequenceCompletionTimeoutError);
    expect(fastSignal.aborted).toBe(true);
    expect(slowSignal.aborted).toBe(false);
  });

  it("throws timeout error when sequence does not complete in time", async ({
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
          input: null;
          output: { result: string };
        };
      }>(),
    });

    const jobSequence = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobSequence({ ...context, typeName: "test", input: null }),
      ),
    );

    await expect(
      queuert.waitForJobSequenceCompletion(jobSequence, {
        timeoutMs: 1,
      }),
    ).rejects.toThrow(WaitForJobSequenceCompletionTimeoutError);
  });

  it("throws error when sequence does not exist", async ({
    stateAdapter,
    notifyAdapter,
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
          input: null;
          output: { result: string };
        };
      }>(),
    });

    const nonExistentId = crypto.randomUUID();
    await expect(
      queuert.waitForJobSequenceCompletion(
        { typeName: "test", id: nonExistentId },
        { timeoutMs: 5000 },
      ),
    ).rejects.toThrow(`Job sequence with id ${nonExistentId} not found`);
  });
};
