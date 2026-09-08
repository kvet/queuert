import { sleep } from "../../helpers/sleep.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const getChainsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "getChains",
  cases: [
    {
      name: "handles chain relationships correctly",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "chain-root", input: { step: 1 } }],
          }),
        );

        const [chain] = await stateAdapter.getChains({ chainIds: [headChain.head.id] });

        expect(chain).toBeDefined();
        expect(chain!.head.id).toBe(headChain.head.id);
        expect(chain!.head.chainId).toBe(headChain.head.id);
      },
    },
    {
      name: "returns head and tail for a multi-job chain",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "chain-root", input: null }],
          }),
        );

        const [{ continuation }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-step2",
                continueFromId: headChain.head.id,
                input: null,
              },
            ],
          }),
        );

        const [chain] = await stateAdapter.getChains({ chainIds: [headChain.head.id] });
        expect(chain).toBeDefined();
        expect(chain!.head.id).toBe(headChain.head.id);
        expect(chain!.tail).toBeDefined();
        expect(chain!.tail!.id).toBe(continuation.id);
      },
    },
    {
      name: "returns an undefined tail for a single-job chain",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "single-root", input: null }],
          }),
        );

        const [chain] = await stateAdapter.getChains({ chainIds: [headChain.head.id] });

        expect(chain).toBeDefined();
        expect(chain!.head.id).toBe(headChain.head.id);
        expect(chain!.tail).toBeUndefined();
      },
    },
    {
      name: "returns an undefined tail for a single-job chain with lock: exclusive",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "single-root-locked", input: null }],
          }),
        );

        const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.getChains({ txCtx, chainIds: [headChain.head.id], lock: "exclusive" }),
        );

        expect(chain).toBeDefined();
        expect(chain!.head.id).toBe(headChain.head.id);
        expect(chain!.tail).toBeUndefined();
      },
    },
    {
      name: "returns undefined for nonexistent chain ID",
      run: async ({ stateAdapter }, expect) => {
        const [realChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "chain-lookup-test", input: null }],
          }),
        );
        const nonexistentId =
          realChain.head.chainId.slice(0, -1) + (realChain.head.chainId.endsWith("0") ? "1" : "0");
        const result = await stateAdapter.getChains({ chainIds: [nonexistentId] });
        expect(result).toEqual([undefined]);
      },
    },
    {
      name: "lock: exclusive blocks a concurrent locked read until the holding tx commits",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "chain-locked", input: null }],
          }),
        );

        const [{ continuation }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-locked-step2",
                continueFromId: headChain.head.id,
                input: null,
              },
            ],
          }),
        );

        let releaseHolder: (() => void) | undefined;
        const holderGate = new Promise<void>((r) => {
          releaseHolder = r;
        });
        let signalLockHeld: (() => void) | undefined;
        const lockHeld = new Promise<void>((r) => {
          signalLockHeld = r;
        });

        const holderTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getChains({
            txCtx,
            chainIds: [headChain.head.chainId],
            lock: "exclusive",
          });
          signalLockHeld!();
          await holderGate;
        });

        await lockHeld;

        let waiterResolved = false;
        const waiterTx = stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.getChains({
              txCtx,
              chainIds: [headChain.head.chainId],
              lock: "exclusive",
            }),
          )
          .then((chain) => {
            waiterResolved = true;
            return chain;
          });

        await sleep(LOCK_BLOCK_OBSERVATION_MS);
        expect(waiterResolved).toBe(false);

        releaseHolder!();
        await holderTx;

        const [observed] = await waiterTx;
        expect(observed).toBeDefined();
        expect(observed!.head.id).toBe(headChain.head.id);
        expect(observed!.tail).toBeDefined();
        expect(observed!.tail!.id).toBe(continuation.id);
      },
    },
    {
      name: "non-transactional getChain does not observe an uncommitted chain creation",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        let release: (() => void) | undefined;
        const gate = new Promise<void>((r) => {
          release = r;
        });
        let signalTxReady: (() => void) | undefined;
        const txReady = new Promise<void>((r) => {
          signalTxReady = r;
        });
        let newChainId: string | undefined;

        const txPromise = stateAdapter
          .withTransaction(async (txCtx) => {
            const [stateChain] = await stateAdapter.createJobs({
              txCtx,
              jobs: [{ typeName: "iso-chain-create", input: null }],
            });
            newChainId = stateChain.head.chainId;
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const readPromise = stateAdapter.getChains({ chainIds: [newChainId!] });
        release!();
        await txPromise;

        expect(await readPromise).toEqual([undefined]);
      },
    },
    {
      name: "locked getChain in a separate transaction does not observe an uncommitted continuation",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const [seedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "iso-latest-root", input: null }],
          }),
        );

        let release: (() => void) | undefined;
        const gate = new Promise<void>((r) => {
          release = r;
        });
        let signalTxReady: (() => void) | undefined;
        const txReady = new Promise<void>((r) => {
          signalTxReady = r;
        });

        const txPromise = stateAdapter
          .withTransaction(async (txCtx) => {
            await stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  typeName: "iso-latest-cont",
                  continueFromId: seedChain.head.id,
                  input: null,
                },
              ],
            });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const readPromise = stateAdapter.withTransaction(async (readTxCtx) =>
          stateAdapter.getChains({
            txCtx: readTxCtx,
            chainIds: [seedChain.head.chainId],
            lock: "exclusive",
          }),
        );
        release!();
        await txPromise;

        const [observed] = await readPromise;
        expect(observed).toBeDefined();
        const { head: headJob, tail: tailJob } = observed!;
        expect(headJob.id).toBe(seedChain.head.id);
        expect(headJob.id).toBe(headJob.chainId);
        expect(tailJob).toBeUndefined();
      },
    },
  ],
};
