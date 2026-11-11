import assert from "node:assert/strict";

import { createClient } from "../../client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { ChainTypeMismatchError, WaitChainTimeoutError } from "../../errors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndStateAdapter } from "../types.ts";

export const awaitChainGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "await-chain",
  cases: [
    {
      name: "handles already completed chains",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "test", input: null }),
        );

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...chain,
            handler: async ({ job, completeJob }) =>
              completeJob(job, async ({ complete }) => complete({ output: { result: "done" } })),
          }),
        );

        const signal = AbortSignal.timeout(100);
        const completedChain = await client.awaitChain(chain, { signal, timeoutMs: 5000 });
        assert.equal(signal.aborted, false);

        assert.equal(completedChain.status, "completed");
        assert.deepEqual(completedChain.output, { result: "done" });
      },
    },
    {
      name: "releases the timeout timer when chain completes before timeoutMs",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "test", input: null }),
        );

        const countTimeouts = (): number =>
          process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;

        const before = countTimeouts();
        const awaitPromise = client.awaitChain(chain, { timeoutMs: 60_000, pollIntervalMs: 50 });

        await new Promise((resolve) => setImmediate(resolve));
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...chain,
            handler: async ({ job, completeJob }) =>
              completeJob(job, async ({ complete }) => complete({ output: { result: "done" } })),
          }),
        );

        await awaitPromise;
        assert.ok(countTimeouts() <= before);
      },
    },
    {
      name: "throws timeout error when chain does not complete in time with abort signal",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "test", input: null }),
        );

        const fastSignal = AbortSignal.timeout(1);
        const slowSignal = AbortSignal.timeout(100);
        await assert.rejects(
          async () => client.awaitChain(chain, { signal: fastSignal, timeoutMs: 5000 }),
          WaitChainTimeoutError,
        );
        assert.equal(fastSignal.aborted, true);
        assert.equal(slowSignal.aborted, false);
      },
    },
    {
      name: "throws timeout error when chain does not complete in time",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "test", input: null }),
        );

        await assert.rejects(
          async () => client.awaitChain(chain, { timeoutMs: 1 }),
          WaitChainTimeoutError,
        );
      },
    },
    {
      name: "throws error when chain does not exist",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const nonExistentId = crypto.randomUUID();
        await assert.rejects(
          async () =>
            client.awaitChain({ typeName: "test", id: nonExistentId }, { timeoutMs: 5000 }),
          { message: `Chain with id ${nonExistentId} not found` },
        );
      },
    },
    {
      name: "throws on typeName mismatch",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          order: { entry: true; input: { amount: number }; output: { receipt: string } };
          notification: { entry: true; input: { message: string }; output: { sent: boolean } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({ ...txCtx, txHooks, typeName: "order", input: { amount: 42 } }),
        );

        await assert.rejects(
          async () =>
            client.awaitChain({ typeName: "notification", id: chain.id }, { timeoutMs: 1000 }),
          ChainTypeMismatchError,
        );
      },
    },
  ],
};
