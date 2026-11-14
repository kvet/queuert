import assert from "node:assert/strict";

import { dynamicSyncAsync, resource, step, wait } from "@queuert/sync-async";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { ChainTypeMismatchError, WaitChainTimeoutError } from "../../errors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createCaseStateAdapter } from "../support/create-case-state-adapter.ts";

export const awaitChainGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "await-chain",
  cases: [
    {
      name: "handles already completed chains",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.completeChain({
              ...txCtx,
              ...chain,
              handler: ({ job, completeJob }) =>
                completeJob(job, ({ complete }) => complete({ output: { result: "done" } })),
            }),
          ),
        );

        const signal = AbortSignal.timeout(100);
        const completedChain = yield* wait(client.awaitChain(chain, { signal, timeoutMs: 5000 }));
        assert.equal(signal.aborted, false);

        assert.equal(completedChain.status, "completed");
        assert.deepEqual(completedChain.output, { result: "done" });
      }),
    },
    {
      name: "releases the timeout timer when chain completes before timeoutMs",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        const countTimeouts = (): number =>
          process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;

        const before = countTimeouts();
        const awaitPromise = client.awaitChain(chain, { timeoutMs: 60_000, pollIntervalMs: 50 });

        yield* wait(new Promise((resolve) => setImmediate(resolve)));
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.completeChain({
              ...txCtx,
              ...chain,
              handler: ({ job, completeJob }) =>
                completeJob(job, ({ complete }) => complete({ output: { result: "done" } })),
            }),
          ),
        );

        yield* wait(awaitPromise);
        assert.ok(countTimeouts() <= before);
      }),
    },
    {
      name: "throws timeout error when chain does not complete in time with abort signal",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        const fastSignal = AbortSignal.timeout(1);
        const slowSignal = AbortSignal.timeout(100);
        yield* wait(
          assert.rejects(
            async () => client.awaitChain(chain, { signal: fastSignal, timeoutMs: 5000 }),
            WaitChainTimeoutError,
          ),
        );
        assert.equal(fastSignal.aborted, true);
        assert.equal(slowSignal.aborted, false);
      }),
    },
    {
      name: "throws timeout error when chain does not complete in time",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(
          assert.rejects(
            async () => client.awaitChain(chain, { timeoutMs: 1 }),
            WaitChainTimeoutError,
          ),
        );
      }),
    },
    {
      name: "throws error when chain does not exist",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const nonExistentId = crypto.randomUUID();
        yield* wait(
          assert.rejects(
            async () =>
              client.awaitChain({ typeName: "test", id: nonExistentId }, { timeoutMs: 5000 }),
            { message: `Chain with id ${nonExistentId} not found` },
          ),
        );
      }),
    },
    {
      name: "throws on typeName mismatch",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          order: { entry: true; input: { amount: number }; output: { receipt: string } };
          notification: { entry: true; input: { message: string }; output: { sent: boolean } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "order", input: { amount: 42 } }),
          ),
        );

        yield* wait(
          assert.rejects(
            async () =>
              client.awaitChain({ typeName: "notification", id: chain.id }, { timeoutMs: 1000 }),
            ChainTypeMismatchError,
          ),
        );
      }),
    },
  ],
};
