import { TestAPI } from "vitest";
import {
  createQueuert,
  defineJobTypes,
  WaitForJobChainCompletionTimeoutError,
} from "../index.js";
import { TestSuiteContext } from "./spec-context.spec-helper.js";

export const waitChainCompletionTestSuite = ({
  it,
}: {
  it: TestAPI<TestSuiteContext>;
}): void => {
  // check completion scenario with workers completing jobs

  it("handles already completed chains", async ({
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

    const jobChain = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobChain({ ...context, typeName: "test", input: null }),
      ),
    );

    await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.completeJobChain({
          ...context,
          ...jobChain,
          complete: async ({ job, complete }) => {
            return complete(job, async () => ({ result: "done" }));
          },
        }),
      ),
    );

    const signal = AbortSignal.timeout(100);
    const completedChain = await queuert.waitForJobChainCompletion(jobChain, {
      signal,
      timeoutMs: 5000,
    });
    expect(signal.aborted).toBe(false);

    expect(completedChain.status).toBe("completed");
    expect(completedChain.output).toEqual({ result: "done" });
  });

  it("throws timeout error when chain does not complete in time with abort signal", async ({
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

    const jobChain = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobChain({ ...context, typeName: "test", input: null }),
      ),
    );

    const fastSignal = AbortSignal.timeout(1);
    const slowSignal = AbortSignal.timeout(100);
    await expect(
      queuert.waitForJobChainCompletion(jobChain, {
        signal: fastSignal,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(WaitForJobChainCompletionTimeoutError);
    expect(fastSignal.aborted).toBe(true);
    expect(slowSignal.aborted).toBe(false);
  });

  it("throws timeout error when chain does not complete in time", async ({
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

    const jobChain = await queuert.withNotify(async () =>
      runInTransaction(async (context) =>
        queuert.startJobChain({ ...context, typeName: "test", input: null }),
      ),
    );

    await expect(
      queuert.waitForJobChainCompletion(jobChain, {
        timeoutMs: 1,
      }),
    ).rejects.toThrow(WaitForJobChainCompletionTimeoutError);
  });

  it("throws error when chain does not exist", async ({
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
      queuert.waitForJobChainCompletion(
        { typeName: "test", id: nonExistentId },
        { timeoutMs: 5000 },
      ),
    ).rejects.toThrow(`Job chain with id ${nonExistentId} not found`);
  });
};
