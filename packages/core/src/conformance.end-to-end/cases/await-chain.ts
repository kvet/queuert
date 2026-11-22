import assert from "node:assert/strict";

import { dynamicSyncAsync, resource, step, wait } from "@queuert/sync-async";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { retryUntilPasses } from "../../conformance/retry-until-passes.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { ChainTypeMismatchError, WaitChainTimeoutError } from "../../errors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createCaseStateAdapter } from "../support/create-case-state-adapter.ts";
import { createSpyStateAdapter } from "../support/spy-state-adapter.ts";

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
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "test" },
              output: { result: "done" },
            }),
          ),
        );

        const signal = AbortSignal.timeout(1000);
        const completedChain = yield* wait(client.awaitChain({ chain, signal, timeoutMs: 5000 }));
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
        const awaitPromise = client.awaitChain({ chain, timeoutMs: 60_000, pollIntervalMs: 50 });

        yield* wait(new Promise((resolve) => setImmediate(resolve)));
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "test" },
              output: { result: "done" },
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
        const slowSignal = AbortSignal.timeout(1000);
        yield* wait(
          assert.rejects(
            async () => client.awaitChain({ chain, signal: fastSignal, timeoutMs: 5000 }),
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
            async () => client.awaitChain({ chain, timeoutMs: 1 }),
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
              client.awaitChain({
                chain: { typeName: "test", id: nonExistentId },
                timeoutMs: 5000,
              }),
            { message: `Chain with id ${nonExistentId} not found` },
          ),
        );

        const existingChain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );
        const otherNonExistentId = crypto.randomUUID();
        yield* wait(
          assert.rejects(
            async () =>
              client.awaitChains({
                chains: [
                  { id: nonExistentId },
                  existingChain,
                  { id: otherNonExistentId },
                  { id: nonExistentId },
                ],
                timeoutMs: 5000,
              }),
            { name: "ChainsNotFoundError", chainIds: [nonExistentId, otherNonExistentId] },
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
              client.awaitChain({
                chain: { typeName: "notification", id: chain.id },
                timeoutMs: 1000,
              }),
            ChainTypeMismatchError,
          ),
        );

        const notificationChain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "notification", input: { message: "hi" } }),
          ),
        );
        yield* wait(
          assert.rejects(
            async () =>
              client.awaitChains({
                chains: [
                  { typeName: "notification", id: chain.id },
                  notificationChain,
                  { typeName: "order", id: notificationChain.id },
                ],
                timeoutMs: 1000,
              }),
            {
              name: "ChainsTypeMismatchError",
              chainIds: [chain.id, notificationChain.id],
              expectedTypeNames: ["notification", "order"],
              actualTypeNames: ["order", "notification"],
            },
          ),
        );
      }),
    },
    {
      name: "awaitChains returns every chain in input order once the last one completes, even one deleted after it completed",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { name: string }; output: { result: string } };
        }>();
        const spyStateAdapter = createSpyStateAdapter(stateAdapter);
        const client = createClient({ stateAdapter: spyStateAdapter, notifyAdapter, jobTypes });

        const [firstChain, secondChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "test", input: { name: "first" } },
                { typeName: "test", input: { name: "second" } },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: secondChain.id, typeName: "test" },
              output: { result: "second done" },
            }),
          ),
        );

        const chainReadsBefore = spyStateAdapter.calls.filter(
          ({ name }) => name === "getChains",
        ).length;
        const awaitPromise = client.awaitChains({
          chains: [secondChain, firstChain, secondChain],
          timeoutMs: 5000,
          pollIntervalMs: 50,
        });
        yield* wait(
          retryUntilPasses(
            async () => {
              assert.ok(
                spyStateAdapter.calls.filter(
                  ({ name, result }) => name === "getChains" && result !== undefined,
                ).length > chainReadsBefore,
              );
            },
            { timeoutMs: 5000, intervalMs: 5 },
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.deleteChain({ ...txCtx, id: secondChain.id }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: firstChain.id, typeName: "test" },
              output: { result: "first done" },
            }),
          ),
        );

        const completedChains = yield* wait(awaitPromise);
        assert.deepEqual(
          completedChains.map((chain) => [chain.id, chain.status, chain.output.result]),
          [
            [secondChain.id, "completed", "second done"],
            [firstChain.id, "completed", "first done"],
            [secondChain.id, "completed", "second done"],
          ],
        );
        assert.deepEqual(yield* wait(client.awaitChains({ chains: [], timeoutMs: 1 })), []);
      }),
    },
    {
      name: "awaitChains throws WaitChainsTimeoutError listing the chains still running",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [completedChain, firstRunningChain, secondRunningChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "test", input: null },
                { typeName: "test", input: null },
                { typeName: "test", input: null },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: completedChain.id, typeName: "test" },
              output: { result: "done" },
            }),
          ),
        );

        yield* wait(
          assert.rejects(
            async () =>
              client.awaitChains({
                chains: [firstRunningChain, completedChain, secondRunningChain],
                timeoutMs: 50,
              }),
            {
              name: "WaitChainsTimeoutError",
              chainIds: [firstRunningChain.id, secondRunningChain.id],
              timeoutMs: 50,
            },
          ),
        );

        const request = new AbortController();
        request.abort(new Error("request closed"));
        yield* wait(
          assert.rejects(
            async () =>
              client.awaitChains({
                chains: [firstRunningChain],
                timeoutMs: 5000,
                signal: request.signal,
              }),
            { name: "WaitChainsTimeoutError", cause: request.signal.reason },
          ),
        );
      }),
    },
  ],
};
