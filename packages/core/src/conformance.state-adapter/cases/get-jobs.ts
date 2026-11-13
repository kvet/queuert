import assert from "node:assert/strict";

import { caseBody, resource } from "@queuert/helpers/case-body";
import { sleep } from "@queuert/helpers/sleep";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const getJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getJobs",
  cases: [
    {
      name: "returns undefined for nonexistent job ID",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        // Create a real job to get a valid ID format, then look up a derived nonexistent one
        const [realChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "lookup-test", input: null },
              ],
            }),
          ),
        );
        const nonexistentId =
          realChain.head.id.slice(0, -1) + (realChain.head.id.endsWith("0") ? "1" : "0");
        const result = yield* step(stateAdapter.getJobs({ jobIds: [nonexistentId] }));
        assert.deepEqual(result, [undefined]);
      }),
    },
  ],
};

export const getJobsHeldTransactionGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getJobs",
  cases: [
    {
      name: "lock: exclusive blocks a concurrent locked read until the holding tx commits",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [seedChain] = await stateAdapter.withTransaction((txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "lock-blocking-job",
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
          await stateAdapter.getJobs({ txCtx, jobIds: [seedChain.head.id], lock: "exclusive" });
          signalLockHeld!();
          await holderGate;
        });

        await lockHeld;

        // Tx B: also try to lock the same row. Should not resolve while A holds.
        let waiterResolved = false;
        const waiterTx = Promise.resolve(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.getJobs({ txCtx, jobIds: [seedChain.head.id], lock: "exclusive" }),
          ),
        ).then((job) => {
          waiterResolved = true;
          return job;
        });

        await sleep(LOCK_BLOCK_OBSERVATION_MS);
        assert.equal(waiterResolved, false);

        releaseHolder!();
        await holderTx;

        const [observed] = await waiterTx;
        assert.notEqual(observed, undefined);
        assert.equal(observed!.id, seedChain.head.id);
        assert.deepEqual(observed!.input, { value: 1 });
      },
    },
  ],
};

export const getJobsConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "getJobs",
    cases: [
      {
        name: "lock: exclusive on a continuation also locks its chain head",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [headChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "lock-head-chain",
                  input: null,
                },
              ],
            }),
          );
          const [continued] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "lock-head-chain-step",
                  input: null,
                  continueFromId: headChain.head.id,
                },
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

          const holderTx = stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.getJobs({ txCtx, jobIds: [continuation.id], lock: "exclusive" });
            signalLockHeld!();
            await holderGate;
          });

          await lockHeld;

          let waiterResolved = false;
          const waiterTx = Promise.resolve(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.getChains({ txCtx, chainIds: [headChain.head.id], lock: "exclusive" }),
            ),
          ).then((chains) => {
            waiterResolved = true;
            return chains;
          });

          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          assert.equal(waiterResolved, false);

          releaseHolder!();
          await holderTx;

          const [observed] = await waiterTx;
          assert.notEqual(observed, undefined);
          assert.equal(observed!.id, headChain.head.id);
        },
      },
      {
        name: "parallel non-transactional reads all return correct results",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const count = 10;
          const created = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: count }, (_, i) => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "parallel-read",
                input: { index: i },
              })),
            }),
          );

          const jobIds = created.map((r) => r.head.id);
          const fetched = await Promise.all(
            jobIds.map(async (id) => stateAdapter.getJobs({ jobIds: [id] })),
          );

          assert.equal(
            fetched.every((rows) => rows.length === 1),
            true,
          );
          assert.equal(new Set(fetched.map(([view]) => view!.id)).size, count);
        },
      },
      {
        name: "non-transactional getJob does not observe an uncommitted insert",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

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
                jobs: [
                  { id: stateAdapter.config.generateJobId(), typeName: "iso-insert", input: null },
                ],
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

          assert.deepEqual(await readPromise, [undefined]);
        },
      },
      {
        name: "non-transactional getJob does not observe an uncommitted status update",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const worker = await stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["iso-update"],
            concurrency: 1,
            leaseMs: 60_000,
          });
          const [seedChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "iso-update", input: null },
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
              const [acquired] = await stateAdapter.startJobAttempts({
                txCtx,
                workerId: worker.id,
                workerToken: worker.token,
                typeNames: ["iso-update"],
                limit: 1,
              });
              assert.equal(acquired?.id, seedChain.head.id);
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
          assert.equal(observed?.completedAt, null);
          assert.equal(observed?.attemptAt, null);
          assert.equal(observed?.attempt, 0);
        },
      },
      {
        name: "non-transactional getJob does not observe an uncommitted delete",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [seedChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "iso-delete", input: null },
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
          assert.equal(observed?.id, seedChain.head.id);
        },
      },
      {
        name: "locked getJob in a separate transaction does not observe an uncommitted status update",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const worker = await stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["iso-locked-job"],
            concurrency: 1,
            leaseMs: 60_000,
          });
          const [seedChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "iso-locked-job",
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
              await stateAdapter.startJobAttempts({
                txCtx,
                workerId: worker.id,
                workerToken: worker.token,
                typeNames: ["iso-locked-job"],
                limit: 1,
              });
              signalTxReady!();
              await gate;
              throw new Error("rollback");
            })
            .catch(() => {});

          await txReady;
          const readPromise = stateAdapter.withTransaction((readTxCtx) =>
            stateAdapter.getJobs({
              txCtx: readTxCtx,
              jobIds: [seedChain.head.id],
              lock: "exclusive",
            }),
          );
          release!();
          await txPromise;

          const [observed] = await readPromise;
          assert.equal(observed?.completedAt, null);
          assert.equal(observed?.attemptAt, null);
          assert.equal(observed?.attempt, 0);
        },
      },
    ],
  };
