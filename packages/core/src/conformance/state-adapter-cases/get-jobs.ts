import { sleep } from "../../helpers/sleep.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const getJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "getJobs",
  cases: [
    {
      name: "returns undefined for nonexistent job ID",
      run: async ({ stateAdapter }, expect) => {
        // Create a real job to get a valid ID format, then look up a derived nonexistent one
        const [realChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "lookup-test", input: null }],
          }),
        );
        const nonexistentId =
          realChain.head.id.slice(0, -1) + (realChain.head.id.endsWith("0") ? "1" : "0");
        const result = await stateAdapter.getJobs({ jobIds: [nonexistentId] });
        expect(result).toEqual([undefined]);
      },
    },
    {
      name: "lock: exclusive blocks a concurrent locked read until the holding tx commits",
      run: async ({ stateAdapter }, expect) => {
        const [seedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "lock-blocking-job", input: { value: 1 } }],
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

        // Tx A: acquire the exclusive lock on `seed`, then wait on the gate.
        const holderTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getJobs({ txCtx, jobIds: [seedChain.head.id], lock: "exclusive" });
          signalLockHeld!();
          await holderGate;
        });

        await lockHeld;

        // Tx B: also try to lock the same row. Should not resolve while A holds.
        let waiterResolved = false;
        const waiterTx = stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.getJobs({ txCtx, jobIds: [seedChain.head.id], lock: "exclusive" }),
          )
          .then((job) => {
            waiterResolved = true;
            return job;
          });

        await sleep(LOCK_BLOCK_OBSERVATION_MS);
        expect(waiterResolved).toBe(false);

        releaseHolder!();
        await holderTx;

        const [observed] = await waiterTx;
        expect(observed).toBeDefined();
        expect(observed!.id).toBe(seedChain.head.id);
        expect(observed!.input).toEqual({ value: 1 });
      },
    },
    {
      name: "lock: exclusive on a continuation also locks its chain head",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "lock-head-chain", input: null }],
          }),
        );
        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              { typeName: "lock-head-chain-step", input: null, continueFromId: headChain.head.id },
            ],
          }),
        );
        const { continuation } = continued!;

        let releaseHolder: (() => void) | undefined;
        const holderGate = new Promise<void>((r) => {
          releaseHolder = r;
        });
        let signalLockHeld: (() => void) | undefined;
        const lockHeld = new Promise<void>((r) => {
          signalLockHeld = r;
        });

        // Tx A locks the continuation only. The chain head is a different row.
        const holderTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getJobs({ txCtx, jobIds: [continuation.id], lock: "exclusive" });
          signalLockHeld!();
          await holderGate;
        });

        await lockHeld;

        // Tx B locks the chain, which is the head row. It must wait: a completion that
        // reads `hasBlockedJobs` from its own statement is only correct when the head is
        // already held, so locking a job has to cover the head of its chain.
        let waiterResolved = false;
        const waiterTx = stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.getChains({ txCtx, chainIds: [headChain.head.id], lock: "exclusive" }),
          )
          .then((chains) => {
            waiterResolved = true;
            return chains;
          });

        await sleep(LOCK_BLOCK_OBSERVATION_MS);
        expect(waiterResolved).toBe(false);

        releaseHolder!();
        await holderTx;

        const [observed] = await waiterTx;
        expect(observed).toBeDefined();
        expect(observed!.id).toBe(headChain.head.id);
      },
    },
    {
      name: "parallel non-transactional reads all return correct results",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const count = 10;
        const created = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: Array.from({ length: count }, (_, i) => ({
              typeName: "parallel-read",
              input: { index: i },
            })),
          }),
        );

        const jobIds = created.map((r) => r.head.id);
        const fetched = await Promise.all(
          jobIds.map(async (id) => stateAdapter.getJobs({ jobIds: [id] })),
        );

        expect(fetched.every((rows) => rows.length === 1)).toBe(true);
        expect(new Set(fetched.map(([view]) => view!.id)).size).toBe(count);
      },
    },
    {
      name: "non-transactional getJob does not observe an uncommitted insert",
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
        let insertedId: string | undefined;

        const txPromise = stateAdapter
          .withTransaction(async (txCtx) => {
            const [stateChain] = await stateAdapter.createJobs({
              txCtx,
              jobs: [{ typeName: "iso-insert", input: null }],
            });
            insertedId = stateChain.head.id;
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const readPromise = stateAdapter.getJobs({ jobIds: [insertedId!] });
        release!();
        await txPromise;

        expect(await readPromise).toEqual([undefined]);
      },
    },
    {
      name: "non-transactional getJob does not observe an uncommitted status update",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const [seedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "iso-update", input: null }],
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
            const acquired = await stateAdapter.startJobAttempt({
              txCtx,
              workerId: "worker-1",
              typeNames: ["iso-update"],
            });
            expect(acquired?.id).toBe(seedChain.head.id);
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const readPromise = stateAdapter.getJobs({ jobIds: [seedChain.head.id] });
        release!();
        await txPromise;

        const [observed] = await readPromise;
        expect(observed?.completedAt).toBeNull();
        expect(observed?.attemptAt).toBeNull();
        expect(observed?.attempt).toBe(0);
      },
    },
    {
      name: "non-transactional getJob does not observe an uncommitted delete",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const [seedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "iso-delete", input: null }],
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
            await stateAdapter.deleteChains({ txCtx, chainIds: [seedChain.head.chainId] });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const readPromise = stateAdapter.getJobs({ jobIds: [seedChain.head.id] });
        release!();
        await txPromise;

        const [observed] = await readPromise;
        expect(observed?.id).toBe(seedChain.head.id);
      },
    },
    {
      name: "locked getJob in a separate transaction does not observe an uncommitted status update",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const [seedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "iso-locked-job", input: null }],
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
            await stateAdapter.startJobAttempt({
              txCtx,
              workerId: "worker-1",
              typeNames: ["iso-locked-job"],
            });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const readPromise = stateAdapter.withTransaction(async (readTxCtx) =>
          stateAdapter.getJobs({
            txCtx: readTxCtx,
            jobIds: [seedChain.head.id],
            lock: "exclusive",
          }),
        );
        release!();
        await txPromise;

        const [observed] = await readPromise;
        expect(observed?.completedAt).toBeNull();
        expect(observed?.attemptAt).toBeNull();
        expect(observed?.attempt).toBe(0);
      },
    },
  ],
};
