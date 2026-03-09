import { type TestAPI } from "vitest";
import {
  WaitChainTimeoutError,
  createClient,
  defineJobTypeRegistry,
  withTransactionHooks,
} from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const waitChainCompletionTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  // check completion scenario with workers completing jobs

  it("handles already completed chains", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypeRegistry<{
      test: {
        entry: true;
        input: null;
        output: { result: string };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.completeJobChain({
          ...txCtx,
          transactionHooks,
          ...jobChain,
          complete: async ({ job, complete }) => {
            return complete(job, async () => ({ result: "done" }));
          },
        }),
      ),
    );

    const signal = AbortSignal.timeout(100);
    const completedChain = await client.awaitJobChain(jobChain, {
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
    const registry = defineJobTypeRegistry<{
      test: {
        entry: true;
        input: null;
        output: { result: string };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    const fastSignal = AbortSignal.timeout(1);
    const slowSignal = AbortSignal.timeout(100);
    await expect(
      client.awaitJobChain(jobChain, {
        signal: fastSignal,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(WaitChainTimeoutError);
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
    const registry = defineJobTypeRegistry<{
      test: {
        entry: true;
        input: null;
        output: { result: string };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await expect(
      client.awaitJobChain(jobChain, {
        timeoutMs: 1,
      }),
    ).rejects.toThrow(WaitChainTimeoutError);
  });

  it("throws error when chain does not exist", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypeRegistry<{
      test: {
        entry: true;
        input: null;
        output: { result: string };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    const nonExistentId = crypto.randomUUID();
    await expect(
      client.awaitJobChain({ typeName: "test", id: nonExistentId }, { timeoutMs: 5000 }),
    ).rejects.toThrow(`Job chain with id ${nonExistentId} not found`);
  });
};
