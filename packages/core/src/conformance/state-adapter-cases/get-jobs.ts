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
        const [{ job: real }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "lookup-test",
                chainTypeName: "lookup-test",
                input: null,
              },
            ],
          }),
        );
        const nonexistentId = real.id.slice(0, -1) + (real.id.endsWith("0") ? "1" : "0");
        const result = await stateAdapter.getJobs({ jobIds: [nonexistentId] });
        expect(result).toEqual([undefined]);
      },
    },
    {
      name: "lock: exclusive blocks a concurrent locked read until the holding tx commits",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: seed }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "lock-blocking-job",
                chainTypeName: "lock-blocking-job",
                input: { value: 1 },
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

        // Tx A: acquire the exclusive lock on `seed`, then wait on the gate.
        const holderTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getJobs({ txCtx, jobIds: [seed.id], lock: "exclusive" });
          signalLockHeld!();
          await holderGate;
        });

        await lockHeld;

        // Tx B: also try to lock the same row. Should not resolve while A holds.
        let waiterResolved = false;
        const waiterTx = stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.getJobs({ txCtx, jobIds: [seed.id], lock: "exclusive" }),
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
        expect(observed!.id).toBe(seed.id);
        expect(observed!.input).toEqual({ value: 1 });
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
          stateAdapter.createChains({
            txCtx,
            jobs: Array.from({ length: count }, (_, i) => ({
              typeName: "parallel-read",
              chainTypeName: "parallel-read",
              input: { index: i },
            })),
          }),
        );

        const jobIds = created.map((r) => r.job.id);
        const fetched = await Promise.all(
          jobIds.map(async (id) => stateAdapter.getJobs({ jobIds: [id] })),
        );

        expect(fetched.every((rows) => rows.length === 1)).toBe(true);
        expect(new Set(fetched.map(([job]) => job!.id)).size).toBe(count);
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
            const [{ job }] = await stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "iso-insert",
                  chainTypeName: "iso-insert",
                  input: null,
                },
              ],
            });
            insertedId = job.id;
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
        const [{ job: seed }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "iso-update",
                chainTypeName: "iso-update",
                input: null,
              },
            ],
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
            expect(acquired.job?.id).toBe(seed.id);
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const readPromise = stateAdapter.getJobs({ jobIds: [seed.id] });
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
        const [{ job: seed }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "iso-delete",
                chainTypeName: "iso-delete",
                input: null,
              },
            ],
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
            await stateAdapter.deleteChains({ txCtx, chainIds: [seed.chainId] });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const readPromise = stateAdapter.getJobs({ jobIds: [seed.id] });
        release!();
        await txPromise;

        const [observed] = await readPromise;
        expect(observed?.id).toBe(seed.id);
      },
    },
    {
      name: "locked getJob in a separate transaction does not observe an uncommitted status update",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const [{ job: seed }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "iso-locked-job",
                chainTypeName: "iso-locked-job",
                input: null,
              },
            ],
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
          stateAdapter.getJobs({ txCtx: readTxCtx, jobIds: [seed.id], lock: "exclusive" }),
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
