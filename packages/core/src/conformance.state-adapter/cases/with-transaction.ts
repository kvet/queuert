import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { caseBody, resource } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import { inTransaction } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const withTransactionGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "withTransaction",
  cases: [
    {
      name: "maintains transaction isolation",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "isolation-test",
                  input: { value: "original" },
                },
              ],
            }),
          ),
        );

        let rolledBackJobId: string | undefined;
        yield* step(
          assertRejects(
            () =>
              inTransaction(stateAdapter, function* (txCtx) {
                const [innerChain] = yield* step(
                  stateAdapter.createJobs({
                    txCtx,
                    jobs: [
                      {
                        id: stateAdapter.config.generateJobId(),
                        typeName: "rollback-test",
                        input: { value: "should-rollback" },
                      },
                    ],
                  }),
                );
                rolledBackJobId = innerChain.head.id;
                throw new Error("Intentional rollback");
              }),
            /Intentional rollback/,
          ),
        );

        const [original] = yield* step(stateAdapter.getJobs({ jobIds: [stateChain.head.id] }));
        assert.notEqual(original, undefined);
        assert.deepEqual(yield* step(stateAdapter.getJobs({ jobIds: [rolledBackJobId!] })), [
          undefined,
        ]);
      }),
    },
    {
      name: "restores updated job state when rolled back",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["update-rollback"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "update-rollback",
                  input: null,
                },
              ],
            }),
          ),
        );

        try {
          yield* step(
            inTransaction(stateAdapter, function* (txCtx) {
              yield* step(
                stateAdapter.startJobAttempts({
                  txCtx,
                  workerId: worker.id,
                  workerToken: worker.token,
                  typeNames: ["update-rollback"],
                  limit: 1,
                }),
              );
              throw new Error("rollback after acquire");
            }),
          );
        } catch {
          // Expected
        }

        const [after] = yield* step(stateAdapter.getJobs({ jobIds: [stateChain.head.id] }));
        assert.equal(after?.completedAt, null);
        assert.equal(after?.attemptAt, null);
        assert.equal(after?.attempt, 0);

        const [reacquired] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.startJobAttempts({
              txCtx,
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["update-rollback"],
              limit: 1,
            }),
          ),
        );
        assert.equal(reacquired.id, stateChain.head.id);
        assert.equal(reacquired.attempt, 1);
      }),
    },
    {
      name: "revives deleted chains when rolled back",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["delete-rollback"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "delete-rollback",
                  input: null,
                },
              ],
            }),
          ),
        );

        try {
          yield* step(
            inTransaction(stateAdapter, function* (txCtx) {
              yield* step(
                stateAdapter.deleteChains({ txCtx, chainIds: [stateChain.head.chainId] }),
              );
              throw new Error("rollback after delete");
            }),
          );
        } catch {
          // Expected
        }

        const [after] = yield* step(stateAdapter.getJobs({ jobIds: [stateChain.head.id] }));
        assert.equal(after?.id, stateChain.head.id);

        const [reacquired] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.startJobAttempts({
              txCtx,
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["delete-rollback"],
              limit: 1,
            }),
          ),
        );
        assert.equal(reacquired.id, stateChain.head.id);
      }),
    },
    {
      name: "restores blocker state when rolled back",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "blocker-rollback-a",
                  input: null,
                },
              ],
            }),
          ),
        );
        const [targetChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "blocker-rollback-b",
                  input: null,
                },
              ],
            }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              inTransaction(stateAdapter, function* (txCtx) {
                const [blockedTarget] = yield* step(
                  stateAdapter.addJobsBlockers({
                    txCtx,
                    jobBlockers: [
                      {
                        jobId: targetChain.head.id,
                        blockedByChainIds: [blockerChain.head.chainId],
                      },
                    ],
                  }),
                );
                assert.equal(blockedTarget.status, "blocked");
                throw new Error("rollback after addJobsBlockers");
              }),
            /rollback after addJobsBlockers/,
          ),
        );

        const [after] = yield* step(stateAdapter.getJobs({ jobIds: [targetChain.head.id] }));
        assert.equal(after?.status, "pending");
        assert.equal(after?.completedAt, null);
        assert.equal(after?.attemptAt, null);

        const blockers = yield* step(stateAdapter.getJobBlockers({ jobId: targetChain.head.id }));
        assert.equal(blockers.length, 0);

        const blocked = yield* step(
          stateAdapter.listBlockedJobs({
            chainId: blockerChain.head.chainId,
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.equal(blocked.items.length, 0);
      }),
    },
    {
      name: "rolls back mixed mutations atomically with consistent indexes",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["mixed-rollback"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const otherWorker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["mixed-rollback"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [aChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "mixed-rollback",
                  input: null,
                },
              ],
            }),
          ),
        );
        const [bChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "mixed-rollback",
                  input: null,
                },
              ],
            }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              inTransaction(stateAdapter, function* (txCtx) {
                yield* step(
                  stateAdapter.startJobAttempts({
                    txCtx,
                    workerId: worker.id,
                    workerToken: worker.token,
                    typeNames: ["mixed-rollback"],
                    limit: 1,
                  }),
                );
                yield* step(
                  stateAdapter.completeJobs({
                    txCtx,
                    jobs: [{ jobId: aChain.head.id, output: { ok: true } }],
                  }),
                );
                yield* step(stateAdapter.deleteChains({ txCtx, chainIds: [bChain.head.chainId] }));
                throw new Error("rollback after mixed mutations");
              }),
            /rollback after mixed mutations/,
          ),
        );

        const [aAfter, bAfter] = yield* step(
          stateAdapter.getJobs({
            jobIds: [aChain.head.id, bChain.head.id],
          }),
        );
        assert.equal(aAfter?.status, "pending");
        assert.equal(aAfter?.completedAt, null);
        assert.equal(aAfter?.output, null);
        assert.equal(aAfter?.attemptAt, null);
        assert.equal(aAfter?.chain.status, "running");
        assert.equal(aAfter?.chain.completedAt, null);
        assert.equal(bAfter?.status, "pending");
        assert.equal(bAfter?.completedAt, null);
        assert.equal(bAfter?.attemptAt, null);
        assert.equal(bAfter?.chain.status, "running");

        const runningChains = yield* step(
          stateAdapter.listChains({
            typeName: "mixed-rollback",
            status: "running",
            orderBy: "createdAt",
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(
          runningChains.items.map((chain) => chain.id).toSorted(),
          [aChain.id, bChain.id].toSorted(),
        );

        const [reacquired] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.startJobAttempts({
              txCtx,
              typeNames: ["mixed-rollback"],
              workerId: otherWorker.id,
              workerToken: otherWorker.token,
              limit: 1,
            }),
          ),
        );
        assert.notEqual(reacquired, undefined);
      }),
    },
    {
      name: "rolls back completing a tail job together with its chain's head row",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "tail-rollback", input: null },
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
                  typeName: "tail-rollback:step",
                  continueFromId: stateChain.id,
                  input: null,
                },
              ],
            }),
          ),
        );
        const tailId = continued!.continuation.id;

        yield* step(
          assertRejects(
            () =>
              inTransaction(stateAdapter, function* (txCtx) {
                yield* step(stateAdapter.getJobs({ txCtx, jobIds: [tailId], lock: "exclusive" }));
                const [completed] = yield* step(
                  stateAdapter.completeJobs({
                    txCtx,
                    jobs: [{ jobId: tailId, output: { ok: true } }],
                  }),
                );
                assert.equal(completed?.chain.status, "completed");
                throw new Error("rollback after completing the tail");
              }),
            /rollback after completing the tail/,
          ),
        );

        const [headAfter, tailAfter] = yield* step(
          stateAdapter.getJobs({
            jobIds: [stateChain.id, tailId],
          }),
        );
        assert.equal(headAfter?.status, "completed");
        assert.equal(headAfter?.continuedToId, tailId);
        assert.equal(tailAfter?.status, "pending");
        assert.equal(tailAfter?.completedAt, null);
        assert.equal(tailAfter?.output, null);
        assert.equal(tailAfter?.chain.status, "running");
        assert.equal(tailAfter?.chain.completedAt, null);

        const [chainAfter] = yield* step(stateAdapter.getChains({ chainIds: [stateChain.id] }));
        assert.equal(chainAfter?.status, "running");
        assert.equal(chainAfter?.completedAt, null);
        assert.equal(chainAfter?.tail?.id, tailId);
        assert.equal(chainAfter?.tail?.status, "pending");

        const counts = yield* step(
          stateAdapter.countChainsByTypeName({ typeNames: ["tail-rollback"] }),
        );
        assert.deepEqual(counts, [
          { running: { count: 1, hasMore: false }, completed: { count: 0, hasMore: false } },
        ]);
      }),
    },
  ],
};

export const withTransactionHeldTransactionGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "withTransaction",
    cases: [
      {
        name: "a call without a transaction context is not swept into an open transaction's rollback",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const inTransaction = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          let rolledBackJobId: string | undefined;
          const transaction = stateAdapter.withTransaction(async (txCtx) => {
            const [chain] = await stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "autocommit-vs-tx",
                  input: null,
                },
              ],
            });
            rolledBackJobId = chain.head.id;
            inTransaction.resolve();
            await release.promise;
            throw new Error("rollback");
          });
          await inTransaction.promise;

          const workerId = stateAdapter.config.generateWorkerId();
          const autocommit = stateAdapter.startWorker({
            workerId,
            typeNames: ["autocommit-vs-tx"],
            concurrency: 1,
            leaseMs: 60_000,
          });
          release.resolve();
          await assert.rejects(transaction, /rollback/);
          await autocommit;

          const [worker] = await stateAdapter.getWorkers({ workerIds: [workerId] });
          assert.equal(worker?.id, workerId);
          assert.deepEqual(await stateAdapter.getJobs({ jobIds: [rolledBackJobId!] }), [undefined]);
        },
      },
    ],
  };

export const withTransactionConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "withTransaction",
    cases: [
      {
        name: "an independent transaction's writes are not swept into a concurrent transaction's rollback",
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

          const txPromise = stateAdapter
            .withTransaction(async (txCtx) => {
              await stateAdapter.createJobs({
                txCtx,
                jobs: [
                  {
                    id: stateAdapter.config.generateJobId(),
                    typeName: "independent-vs-tx",
                    input: { side: "tx" },
                  },
                ],
              });
              signalTxReady!();
              await gate;
              throw new Error("rollback");
            })
            .catch(() => {});

          await txReady;

          const outsidePromise = stateAdapter.withTransaction((outsideTxCtx) =>
            stateAdapter.createJobs({
              txCtx: outsideTxCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "independent-vs-tx",
                  input: { side: "outside" },
                },
              ],
            }),
          );

          release!();
          await txPromise;
          const [outsideChain] = await outsidePromise;

          const [survived] = await stateAdapter.getJobs({ jobIds: [outsideChain.head.id] });
          assert.equal(survived?.id, outsideChain.head.id);
          assert.deepEqual(survived?.input, { side: "outside" });
        },
      },
      {
        name: "parallel withTransaction calls all commit successfully",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const count = 5;
          const results = await Promise.all(
            Array.from({ length: count }, async (_, i) =>
              stateAdapter.withTransaction((txCtx) =>
                stateAdapter.createJobs({
                  txCtx,
                  jobs: [
                    {
                      id: stateAdapter.config.generateJobId(),
                      typeName: "parallel-tx",
                      input: { index: i },
                    },
                  ],
                }),
              ),
            ),
          );

          const ids = new Set(results.map(([r]) => r.head.id));
          assert.equal(ids.size, count);

          for (const [stateChain] of results) {
            const [fetched] = await stateAdapter.getJobs({ jobIds: [stateChain.head.id] });
            assert.notEqual(fetched, undefined);
          }
        },
      },
      {
        name: "parallel withTransaction and non-transactional reads do not deadlock",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [seedChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "mixed-concurrency",
                  input: null,
                },
              ],
            }),
          );

          const txWork = Promise.all(
            Array.from({ length: 3 }, async (_, i) =>
              stateAdapter.withTransaction((txCtx) =>
                stateAdapter.createJobs({
                  txCtx,
                  jobs: [
                    {
                      id: stateAdapter.config.generateJobId(),
                      typeName: "mixed-tx",
                      input: { index: i },
                    },
                  ],
                }),
              ),
            ),
          );

          const readWork = Promise.all(
            Array.from({ length: 5 }, async () =>
              stateAdapter.getJobs({ jobIds: [seedChain.head.id] }),
            ),
          );

          const [txResults, readResults] = await Promise.all([txWork, readWork]);
          assert.equal(txResults.length, 3);
          assert.equal(
            readResults.every(([job]) => job?.id === seedChain.head.id),
            true,
          );
        },
      },
    ],
  };
