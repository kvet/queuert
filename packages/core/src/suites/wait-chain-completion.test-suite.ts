import { type TestAPI } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { WaitChainTimeoutError } from "../errors.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const waitChainCompletionTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  // check completion scenario with workers completing jobs

  it("handles already completed chains", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          complete: async ({ job, complete }) => {
            return complete(job, async () => ({ result: "done" }));
          },
        }),
      ),
    );

    const signal = AbortSignal.timeout(100);
    const completedChain = await client.awaitChain(chain, {
      signal,
      timeoutMs: 5000,
    });
    expect(signal.aborted).toBe(false);

    expect(completedChain.status).toBe("completed");
    expect(completedChain.output).toEqual({ result: "done" });
  });

  it("releases the timeout timer when chain completes before timeoutMs", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    const countTimeouts = (): number =>
      process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;

    const before = countTimeouts();
    // Small pollIntervalMs so the noop notify spec also discovers completion quickly.
    const awaitPromise = client.awaitChain(chain, {
      timeoutMs: 60_000,
      pollIntervalMs: 50,
    });

    // Complete the chain after the awaiter has installed its timer.
    await new Promise((resolve) => setImmediate(resolve));
    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          complete: async ({ job, complete }) => complete(job, async () => ({ result: "done" })),
        }),
      ),
    );

    await awaitPromise;
    // Without the fix, the inner timeout (timeoutMs: 60_000) leaves a Timeout
    // pending for 60 seconds even after the chain resolves.
    expect(countTimeouts()).toBeLessThanOrEqual(before);
  });

  it("throws timeout error when chain does not complete in time with abort signal", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    const fastSignal = AbortSignal.timeout(1);
    const slowSignal = AbortSignal.timeout(100);
    await expect(
      client.awaitChain(chain, {
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
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
      ),
    );

    await expect(
      client.awaitChain(chain, {
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
    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });

    const nonExistentId = crypto.randomUUID();
    await expect(
      client.awaitChain({ typeName: "test", id: nonExistentId }, { timeoutMs: 5000 }),
    ).rejects.toThrow(`Chain with id ${nonExistentId} not found`);
  });
};
