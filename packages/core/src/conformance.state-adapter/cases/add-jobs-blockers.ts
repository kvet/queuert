import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers/sleep";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateChain } from "../../state-adapter/state-adapter.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const addJobsBlockersGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "addJobsBlockers",
  cases: [
    {
      name: "adds blockers and reports the blocker chain as incomplete",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        assert.equal(result.completedAt, null);
        assert.equal(result.attemptAt, null);
        assert.equal(result.status, "blocked");
        assert.equal(result.blockers.length, 1);
        assert.equal(result.blockers[0]!.id, blockerChain.head.chainId);
        assert.equal(result.blockers[0]!.completedAt, null);
      },
    },
    {
      name: "reports a completed blocker chain and leaves the job unblocked",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        assert.equal(result.completedAt, null);
        assert.equal(result.attemptAt, null);
        assert.equal(result.status, "pending");
        assert.equal(result.blockers.length, 1);
        assert.ok(result.blockers[0]!.completedAt instanceof Date);
      },
    },
    {
      name: "reports an undefined blocker for an unknown blocker chain",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
          }),
        );

        const missingChainId =
          mainChain.head.chainId.slice(0, -1) + (mainChain.head.chainId.endsWith("0") ? "1" : "0");

        await assert.rejects(
          stateAdapter.withTransaction(async (txCtx) => {
            const [result] = await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [missingChainId] }],
            });
            assert.equal(result.blockers.length, 1);
            assert.equal(result.blockers[0], undefined);
            throw new Error("caller aborts");
          }),
          /caller aborts/,
        );

        const [unchanged] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        assert.equal(unchanged!.status, "pending");
        assert.equal((await stateAdapter.getJobBlockers({ jobId: mainChain.head.id })).length, 0);
      },
    },
    {
      name: "adds blockers to multiple jobs in a single batch",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerChain1, blockerChain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
            ],
          }),
        );

        const [mainChain1, mainChain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
            ],
          }),
        );

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain1.head.id, blockedByChainIds: [blockerChain1.head.chainId] },
              {
                jobId: mainChain2.head.id,
                blockedByChainIds: [blockerChain1.head.chainId, blockerChain2.head.chainId],
              },
            ],
          }),
        );

        assert.equal(results.length, 2);
        assert.equal(results[0].id, mainChain1.head.id);
        assert.equal(results[0].completedAt, null);
        assert.equal(results[0].attemptAt, null);
        assert.equal(results[0].status, "blocked");
        assert.deepEqual(
          results[0].blockers.map((blocker) => blocker!.id),
          [blockerChain1.head.chainId],
        );

        assert.equal(results[1].id, mainChain2.head.id);
        assert.equal(results[1].completedAt, null);
        assert.equal(results[1].attemptAt, null);
        assert.equal(results[1].status, "blocked");
        assert.deepEqual(
          results[1].blockers.map((blocker) => blocker!.id),
          [blockerChain1.head.chainId, blockerChain2.head.chainId],
        );
      },
    },
    {
      name: "batch handles mix of blocked and unblocked jobs",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [completedBlockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: completedBlockerChain.head.id, output: null }],
          }),
        );

        const [incompleteBlockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain1, mainChain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
            ],
          }),
        );

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: mainChain1.head.id,
                blockedByChainIds: [completedBlockerChain.head.chainId],
              },
              {
                jobId: mainChain2.head.id,
                blockedByChainIds: [incompleteBlockerChain.head.chainId],
              },
            ],
          }),
        );

        assert.equal(results.length, 2);
        assert.equal(results[0].id, mainChain1.head.id);
        assert.equal(results[0].completedAt, null);
        assert.equal(results[0].attemptAt, null);
        assert.equal(results[0].status, "pending");
        assert.ok(results[0].blockers[0]!.completedAt instanceof Date);

        assert.equal(results[1].id, mainChain2.head.id);
        assert.equal(results[1].completedAt, null);
        assert.equal(results[1].attemptAt, null);
        assert.equal(results[1].status, "blocked");
        assert.equal(results[1].blockers[0]!.id, incompleteBlockerChain.head.chainId);
        assert.equal(results[1].blockers[0]!.completedAt, null);
      },
    },
    {
      name: "returns the blocker chain's own trace context",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const blockerChainTraceContext = "00-test123-chain456-01";
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "blocker",
                input: null,
                chainTraceContext: blockerChainTraceContext,
              },
            ],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        assert.equal(result.blockers.length, 1);
        assert.deepEqual(result.blockers[0]!.traceContext, blockerChainTraceContext);
      },
    },
    {
      name: "returns blockers in the same order as blockedByChainIds",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const chainTraceA = "00-aaa111-chain-aaa-01";
        const chainTraceB = "00-bbb222-chain-bbb-01";

        const [blockerChainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "blockerA",
                input: null,
                chainTraceContext: chainTraceA,
              },
            ],
          }),
        );

        const [blockerChainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "blockerB",
                input: null,
                chainTraceContext: chainTraceB,
              },
            ],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: mainChain.head.id,
                blockedByChainIds: [blockerChainA.head.chainId, blockerChainB.head.chainId],
              },
            ],
          }),
        );

        assert.equal(result.blockers.length, 2);
        assert.deepEqual(result.blockers[0]!.traceContext, chainTraceA);
        assert.deepEqual(result.blockers[1]!.traceContext, chainTraceB);
      },
    },
    {
      name: "reports an undefined blocker for a continuation job id",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );
        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "blocker",
                input: null,
                continueFromId: headChain.head.id,
              },
            ],
          }),
        );
        const { continuation } = continued!;

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
          }),
        );

        await assert.rejects(
          stateAdapter.withTransaction(async (txCtx) => {
            const [result] = await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [continuation.id] }],
            });
            assert.equal(result.blockers[0], undefined);
            throw new Error("caller aborts");
          }),
          /caller aborts/,
        );

        const [after] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        assert.equal(after!.status, "pending");
        assert.equal((await stateAdapter.getJobBlockers({ jobId: mainChain.head.id })).length, 0);
      },
    },
    {
      name: "duplicate blocker chain ids do not break addJobsBlockers",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: mainChain.head.id,
                blockedByChainIds: [
                  blockerChain.head.chainId,
                  blockerChain.head.chainId,
                  blockerChain.head.chainId,
                ],
              },
            ],
          }),
        );

        assert.equal(result.status, "blocked");
        assert.deepEqual(
          result.blockers.map((blocker) => blocker!.id),
          [blockerChain.head.chainId, blockerChain.head.chainId, blockerChain.head.chainId],
        );
      },
    },
  ],
};

export const addJobsBlockersConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "addJobsBlockers",
    cases: [
      {
        name: "reports a blocker chain deleted while it waited on the head lock as missing",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "deleted-blocker",
                  input: null,
                },
                { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
              ],
            }),
          );

          let signalDeleted: (() => void) | undefined;
          const deleted = new Promise<void>((r) => {
            signalDeleted = r;
          });
          let releaseDeleter: (() => void) | undefined;
          const deleterGate = new Promise<void>((r) => {
            releaseDeleter = r;
          });

          const deleteTx = stateAdapter.withTransaction(async (txCtx) => {
            const result = await stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.id] });
            signalDeleted!();
            await deleterGate;
            return result;
          });

          await deleted;

          let addSettled = false;
          const addTx = stateAdapter
            .withTransaction(async (txCtx) =>
              stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
              }),
            )
            .finally(() => {
              addSettled = true;
            });

          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          assert.equal(addSettled, false);

          releaseDeleter!();
          const [deletedChain] = await deleteTx;
          assert.equal((deletedChain as StateChain).id, blockerChain.id);

          const [added] = await addTx;
          assert.deepEqual(added.blockers, [undefined]);
          assert.equal(added.status, "pending");
          const blockedJobs = await stateAdapter.listBlockedJobs({
            chainId: blockerChain.id,
            orderDirection: "asc",
            page: { limit: 10 },
          });
          assert.deepEqual(blockedJobs.items, []);
        },
      },
      {
        name: "reports a blocker chain continued while it waited on the head lock as incomplete",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "continued-blocker",
                  input: null,
                },
                { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
              ],
            }),
          );

          let signalContinued: (() => void) | undefined;
          const continued = new Promise<void>((r) => {
            signalContinued = r;
          });
          let releaseContinuer: (() => void) | undefined;
          const continuerGate = new Promise<void>((r) => {
            releaseContinuer = r;
          });

          const continuerTx = stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.getJobs({
              txCtx,
              jobIds: [blockerChain.head.id],
              lock: "exclusive",
            });
            await stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "continued-blocker:step",
                  input: null,
                  continueFromId: blockerChain.head.id,
                },
              ],
            });
            signalContinued!();
            await continuerGate;
          });

          await continued;

          let addSettled = false;
          const addTx = stateAdapter
            .withTransaction(async (txCtx) =>
              stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
              }),
            )
            .finally(() => {
              addSettled = true;
            });

          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          assert.equal(addSettled, false);

          releaseContinuer!();
          await continuerTx;

          const [added] = await addTx;
          assert.equal(added.status, "blocked");
          assert.deepEqual(
            added.blockers.map((blocker) => blocker?.status),
            ["running"],
          );
        },
      },
      {
        name: "reports a blocker chain completed while it waited on the head lock as complete",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "completed-blocker",
                  input: null,
                },
                { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
              ],
            }),
          );

          let signalCompleted: (() => void) | undefined;
          const completed = new Promise<void>((r) => {
            signalCompleted = r;
          });
          let releaseCompleter: (() => void) | undefined;
          const completerGate = new Promise<void>((r) => {
            releaseCompleter = r;
          });

          const completerTx = stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.getJobs({
              txCtx,
              jobIds: [blockerChain.head.id],
              lock: "exclusive",
            });
            await stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: blockerChain.head.id, output: null }],
            });
            signalCompleted!();
            await completerGate;
          });

          await completed;

          let addSettled = false;
          const addTx = stateAdapter
            .withTransaction(async (txCtx) =>
              stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
              }),
            )
            .finally(() => {
              addSettled = true;
            });

          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          assert.equal(addSettled, false);

          releaseCompleter!();
          await completerTx;

          const [added] = await addTx;
          assert.equal(added.status, "pending");
          assert.deepEqual(
            added.blockers.map((blocker) => blocker?.status),
            ["completed"],
          );
        },
      },
      {
        name: "reports a blocker chain completed after the transaction's first read as complete",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "late-completed-blocker",
                  input: null,
                },
                { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
              ],
            }),
          );

          const firstRead = Promise.withResolvers<void>();
          const completerDone = Promise.withResolvers<void>();
          const addTx = stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.getChains({ txCtx, chainIds: [blockerChain.id] });
            firstRead.resolve();
            await completerDone.promise;
            return stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
            });
          });
          await firstRead.promise;

          try {
            await stateAdapter.withTransaction(async (txCtx) => {
              await stateAdapter.completeJobs({
                txCtx,
                jobs: [{ jobId: blockerChain.head.id, output: null }],
              });
              await stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id });
            });
          } finally {
            completerDone.resolve();
          }

          const [added] = await addTx;
          assert.equal(added.status, "pending");
          assert.deepEqual(
            added.blockers.map((blocker) => blocker?.status),
            ["completed"],
          );
          const [stored] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
          assert.equal(stored!.status, "pending");
        },
      },
      {
        name: "concurrent attaches and completions of shared blocker chains leave no dependent blocked",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const blockerChains = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: 4 }, () => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "fan-in-blocker",
                input: null,
              })),
            }),
          );
          const dependentIds = Array.from({ length: 12 }, () =>
            stateAdapter.config.generateJobId(),
          );

          await Promise.all([
            ...dependentIds.map(async (dependentId, index) =>
              stateAdapter.withTransaction(async (txCtx) => {
                await stateAdapter.createJobs({
                  txCtx,
                  jobs: [{ id: dependentId, typeName: "fan-in-dependent", input: null }],
                });
                const blockedByChainIds = [0, 1, 2].map(
                  (offset) => blockerChains[(index + offset) % blockerChains.length].id,
                );
                await stateAdapter.addJobsBlockers({
                  txCtx,
                  jobBlockers: [
                    {
                      jobId: dependentId,
                      blockedByChainIds:
                        index % 2 === 0 ? blockedByChainIds : blockedByChainIds.toReversed(),
                    },
                  ],
                });
              }),
            ),
            ...blockerChains.map(async (blockerChain) =>
              stateAdapter.withTransaction(async (txCtx) => {
                await stateAdapter.completeJobs({
                  txCtx,
                  jobs: [{ jobId: blockerChain.head.id, output: null }],
                });
                await stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id });
              }),
            ),
          ]);

          const dependents = await stateAdapter.getJobs({ jobIds: dependentIds });
          assert.deepEqual(
            dependents.map((dependent) => dependent!.status),
            dependentIds.map(() => "pending"),
          );
        },
      },
    ],
  };
