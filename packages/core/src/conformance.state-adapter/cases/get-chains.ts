import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers/sleep";
import { dynamicSyncAsync, resource, step } from "@queuert/sync-async";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const getChainsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getChains",
  cases: [
    {
      name: "handles chain relationships correctly",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "chain-head",
                  input: { step: 1 },
                },
              ],
            }),
          ),
        );

        const [chain] = yield* step(stateAdapter.getChains({ chainIds: [headChain.head.id] }));

        assert.notEqual(chain, undefined);
        assert.equal(chain!.head.id, headChain.head.id);
        assert.equal(chain!.head.chainId, headChain.head.id);
      }),
    },
    {
      name: "returns head and tail for a multi-job chain",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "chain-head", input: null },
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
                  typeName: "chain-step2",
                  continueFromId: headChain.head.id,
                  input: null,
                },
              ],
            }),
          ),
        );
        const { continuation } = continued!;

        const [chain] = yield* step(stateAdapter.getChains({ chainIds: [headChain.head.id] }));
        assert.notEqual(chain, undefined);
        assert.equal(chain!.head.id, headChain.head.id);
        assert.notEqual(chain!.tail, undefined);
        assert.equal(chain!.tail!.id, continuation.id);
        assert.equal(chain!.status, "running");
        assert.equal(chain!.completedAt, null);
      }),
    },
    {
      name: "returns an undefined tail for a single-job chain",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "single-head", input: null },
              ],
            }),
          ),
        );

        const [chain] = yield* step(stateAdapter.getChains({ chainIds: [headChain.head.id] }));

        assert.notEqual(chain, undefined);
        assert.equal(chain!.head.id, headChain.head.id);
        assert.equal(chain!.tail, undefined);
      }),
    },
    {
      name: "returns an undefined tail for a single-job chain with lock: exclusive",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "single-head-locked",
                  input: null,
                },
              ],
            }),
          ),
        );

        const [chain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.getChains({ txCtx, chainIds: [headChain.head.id], lock: "exclusive" }),
          ),
        );

        assert.notEqual(chain, undefined);
        assert.equal(chain!.head.id, headChain.head.id);
        assert.equal(chain!.tail, undefined);
      }),
    },
    {
      name: "returns undefined for nonexistent chain ID",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [realChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "chain-lookup-test",
                  input: null,
                },
              ],
            }),
          ),
        );
        const nonexistentId =
          realChain.head.chainId.slice(0, -1) + (realChain.head.chainId.endsWith("0") ? "1" : "0");
        const result = yield* step(stateAdapter.getChains({ chainIds: [nonexistentId] }));
        assert.deepEqual(result, [undefined]);
      }),
    },
  ],
};

export const getChainsHeldTransactionLockWaitGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "getChains",
    cases: [
      {
        name: "lock: exclusive blocks a concurrent locked read until the holding tx commits",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [headChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "chain-locked", input: null },
              ],
            }),
          );

          const [continued] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "chain-locked-step2",
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
            await stateAdapter.getChains({
              txCtx,
              chainIds: [headChain.head.chainId],
              lock: "exclusive",
            });
            signalLockHeld();
            await holderGate;
          });

          await lockHeld;

          let waiterResolved = false;
          const waiterTx = Promise.resolve(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.getChains({
                txCtx,
                chainIds: [headChain.head.chainId],
                lock: "exclusive",
              }),
            ),
          ).then((chain) => {
            waiterResolved = true;
            return chain;
          });

          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          assert.equal(waiterResolved, false);

          releaseHolder();
          await holderTx;

          const [observed] = await waiterTx;
          assert.notEqual(observed, undefined);
          assert.equal(observed!.head.id, headChain.head.id);
          assert.notEqual(observed!.tail, undefined);
          assert.equal(observed!.tail!.id, continuation.id);
        },
      },
    ],
  };

export const getChainsConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "getChains",
    cases: [
      {
        name: "non-transactional getChain does not observe an uncommitted chain creation",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const { promise: gate, resolve: release } = Promise.withResolvers<void>();
          const { promise: txReady, resolve: signalTxReady } = Promise.withResolvers<void>();
          let newChainId: string | undefined;

          const txPromise = stateAdapter
            .withTransaction(async (txCtx) => {
              const [stateChain] = await stateAdapter.createJobs({
                txCtx,
                jobs: [
                  {
                    id: stateAdapter.config.generateJobId(),
                    typeName: "iso-chain-create",
                    input: null,
                  },
                ],
              });
              newChainId = stateChain.head.chainId;
              signalTxReady();
              await gate;
              throw new Error("rollback");
            })
            .catch(() => {});

          await txReady;
          const readPromise = stateAdapter.getChains({ chainIds: [newChainId!] });
          release();
          await txPromise;

          assert.deepEqual(await readPromise, [undefined]);
        },
      },
      {
        name: "locked getChain in a separate transaction does not observe an uncommitted continuation",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [seedChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "iso-latest-head",
                  input: null,
                },
              ],
            }),
          );

          const { promise: gate, resolve: release } = Promise.withResolvers<void>();
          const { promise: txReady, resolve: signalTxReady } = Promise.withResolvers<void>();

          const txPromise = stateAdapter
            .withTransaction(async (txCtx) => {
              await stateAdapter.continueJobs({
                txCtx,
                jobs: [
                  {
                    id: stateAdapter.config.generateJobId(),
                    typeName: "iso-latest-cont",
                    continueFromId: seedChain.head.id,
                    input: null,
                  },
                ],
              });
              signalTxReady();
              await gate;
              throw new Error("rollback");
            })
            .catch(() => {});

          await txReady;
          const readPromise = stateAdapter.withTransaction((readTxCtx) =>
            stateAdapter.getChains({
              txCtx: readTxCtx,
              chainIds: [seedChain.head.chainId],
              lock: "exclusive",
            }),
          );
          release();
          await txPromise;

          const [observed] = await readPromise;
          assert.notEqual(observed, undefined);
          const { head: headJob, tail: tailJob } = observed!;
          assert.equal(headJob.id, seedChain.head.id);
          assert.equal(headJob.id, headJob.chainId);
          assert.equal(tailJob, undefined);
        },
      },
    ],
  };
