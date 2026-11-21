import assert from "node:assert/strict";

import { raceWithSleep, sleep } from "@queuert/helpers/sleep";
import { dynamicSyncAsync, resource, step } from "@queuert/sync-async";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const getChainTailsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getChainTails",
  cases: [
    {
      name: "returns the head of a chain that has not continued and the tail of one that has, with its chain",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [singleChain, continuedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "tails-single", input: null },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "tails-continued",
                  input: null,
                },
              ],
            }),
          ),
        );

        const [continued] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "tails-continued-step2",
                  continueFromId: continuedChain.head.id,
                  input: null,
                },
              ],
            }),
          ),
        );
        const { continuation } = continued!;

        const [singleTail, continuedTail] = yield* step(
          stateAdapter.getChainTails({
            chainIds: [singleChain.head.chainId, continuedChain.head.chainId],
          }),
        );

        assert.equal(singleTail!.id, singleChain.head.id);
        assert.equal(singleTail!.status, "pending");
        assert.equal(singleTail!.chain.id, singleChain.head.chainId);
        assert.equal(singleTail!.chain.typeName, "tails-single");
        assert.equal(singleTail!.chain.status, "running");
        assert.equal(continuedTail!.id, continuation.id);
        assert.equal(continuedTail!.typeName, "tails-continued-step2");
        assert.equal(continuedTail!.chainId, continuedChain.head.chainId);
        assert.equal(continuedTail!.chain.id, continuedChain.head.chainId);
        assert.equal(continuedTail!.chain.typeName, "tails-continued");
        assert.equal(continuedTail!.chain.status, "running");
      }),
    },
    {
      name: "returns the same tails with lock: exclusive",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [singleChain, continuedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "tails-locked-single",
                  input: null,
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "tails-locked-continued",
                  input: null,
                },
              ],
            }),
          ),
        );

        const [continued] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "tails-locked-continued-step2",
                  continueFromId: continuedChain.head.id,
                  input: null,
                },
              ],
            }),
          ),
        );
        const { continuation } = continued!;

        const [continuedTail, singleTail] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.getChainTails({
              txCtx,
              chainIds: [continuedChain.head.chainId, singleChain.head.chainId],
              lock: "exclusive",
            }),
          ),
        );

        assert.equal(continuedTail!.id, continuation.id);
        assert.equal(continuedTail!.chain.id, continuedChain.head.chainId);
        assert.equal(singleTail!.id, singleChain.head.id);
        assert.equal(singleTail!.chain.id, singleChain.head.chainId);
      }),
    },
    {
      name: "returns undefined for a missing chain ID, in input order",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [realChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "tails-lookup", input: null },
              ],
            }),
          ),
        );
        const missingId =
          realChain.head.chainId.slice(0, -1) + (realChain.head.chainId.endsWith("0") ? "1" : "0");

        const [missingTail, realTail] = yield* step(
          stateAdapter.getChainTails({ chainIds: [missingId, realChain.head.chainId] }),
        );

        assert.equal(missingTail, undefined);
        assert.equal(realTail!.id, realChain.head.id);
      }),
    },
  ],
};

export const getChainTailsHeldTransactionLockWaitGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "getChainTails",
    cases: [
      {
        name: "lock: exclusive makes a concurrent write to the tail wait until the holding tx commits",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [headChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "tail-locked", input: null },
              ],
            }),
          );

          const [continued] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "tail-locked-step2",
                  continueFromId: headChain.head.id,
                  input: null,
                },
              ],
            }),
          );
          const { continuation } = continued!;

          const { promise: holderGate, resolve: releaseHolder } = Promise.withResolvers<void>();
          const { promise: lockHeld, resolve: signalLockHeld } = Promise.withResolvers<void>();

          const holderTx = stateAdapter.withTransaction(async (txCtx) => {
            const tails = await stateAdapter.getChainTails({
              txCtx,
              chainIds: [headChain.head.chainId],
              lock: "exclusive",
            });
            signalLockHeld();
            await holderGate;
            return tails;
          });

          await lockHeld;

          const writerTx = Promise.resolve(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.rescheduleJobs({
                txCtx,
                jobs: [{ jobId: continuation.id, schedule: { afterMs: 60_000 } }],
              }),
            ),
          );

          assert.equal(
            await Promise.race([
              writerTx.then(() => "written"),
              sleep(LOCK_BLOCK_OBSERVATION_MS).then(() => "waiting"),
            ]),
            "waiting",
          );

          releaseHolder();
          const [lockedTail] = await holderTx;
          assert.equal(lockedTail!.id, continuation.id);

          const [rescheduled] = await writerTx;
          assert.equal(rescheduled!.id, continuation.id);
        },
      },
      {
        name: "lock: exclusive makes a concurrent head lock wait until the holding tx commits",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [headChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "head-locked", input: null },
              ],
            }),
          );

          const [continued] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "head-locked-step2",
                  continueFromId: headChain.head.id,
                  input: null,
                },
              ],
            }),
          );
          const { continuation } = continued!;

          const { promise: holderGate, resolve: releaseHolder } = Promise.withResolvers<void>();
          const { promise: lockHeld, resolve: signalLockHeld } = Promise.withResolvers<void>();

          const holderTx = stateAdapter.withTransaction(async (txCtx) => {
            const tails = await stateAdapter.getChainTails({
              txCtx,
              chainIds: [headChain.head.chainId],
              lock: "exclusive",
            });
            signalLockHeld();
            await holderGate;
            return tails;
          });

          await lockHeld;

          const waiterTx = Promise.resolve(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.getChains({
                txCtx,
                chainIds: [headChain.head.chainId],
                lock: "exclusive",
              }),
            ),
          );

          assert.equal(
            await Promise.race([
              waiterTx.then(() => "locked"),
              sleep(LOCK_BLOCK_OBSERVATION_MS).then(() => "waiting"),
            ]),
            "waiting",
          );

          releaseHolder();
          const [lockedTail] = await holderTx;
          assert.equal(lockedTail!.id, continuation.id);

          const [observed] = await waiterTx;
          assert.equal(observed!.head.id, headChain.head.id);
          assert.equal(observed!.tail!.id, continuation.id);
        },
      },
    ],
  };

export const getChainTailsConcurrentTransactionsLockWaitGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "getChainTails",
    cases: [
      {
        name: "lock: exclusive returns the continuation committed while it waited on the tail",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [chain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "continued-while-waiting",
                  input: null,
                },
              ],
            }),
          );

          const continued = Promise.withResolvers<void>();
          const continuerGate = Promise.withResolvers<void>();
          const continuation = stateAdapter.withTransaction(async (txCtx) => {
            const [written] = await stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "continued-while-waiting-step2",
                  continueFromId: chain.head.id,
                  input: null,
                },
              ],
            });
            continued.resolve();
            await continuerGate.promise;
            return written!.continuation;
          });
          await continued.promise;

          const tailRead = Promise.resolve(
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.getChainTails({
                txCtx,
                chainIds: [chain.head.chainId],
                lock: "exclusive",
              }),
            ),
          );
          assert.equal(
            await raceWithSleep(
              tailRead.then(() => "settled"),
              LOCK_BLOCK_OBSERVATION_MS,
            ),
            undefined,
          );

          continuerGate.resolve();
          const { id: continuationId } = await continuation;
          const [tail] = await tailRead;
          assert.equal(tail!.id, continuationId);
          assert.equal(tail!.continuedToId, null);
        },
      },
    ],
  };
