import { type ConformanceGroup } from "../runner.js";
import { forEachIsolationPair } from "./isolation-pairs.js";
import { type StateConformanceFixture } from "./types.js";

export const withTransactionGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "withTransaction",
  cases: [
    {
      name: "maintains transaction isolation",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
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
        );

        let rolledBackJobId: string | undefined;
        try {
          await stateAdapter.withTransaction(async (txCtx) => {
            const [innerChain] = await stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "rollback-test",
                  input: { value: "should-rollback" },
                },
              ],
            });
            rolledBackJobId = innerChain.head.id;
            throw new Error("Intentional rollback");
          });
        } catch {
          // Expected
        }

        const [original] = await stateAdapter.getJobs({ jobIds: [stateChain.head.id] });
        expect(original).toBeDefined();

        if (rolledBackJobId) {
          expect(await stateAdapter.getJobs({ jobIds: [rolledBackJobId] })).toEqual([undefined]);
        }
      },
    },
    {
      name: "a transaction whose snapshot predates a committed write to a row it then writes still commits its write",
      run: async (fixture, expect) => {
        const { stateAdapter, transactionConcurrency } = fixture;
        if (transactionConcurrency !== "concurrent") {
          expect.skip("requires concurrent transactions");
          return;
        }

        await forEachIsolationPair(fixture, async ({ first, second }) => {
          const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "write-conflict",
                  input: null,
                },
              ],
            }),
          );
          const earlierAt = new Date(Date.now() + 60_000);
          const laterAt = new Date(Date.now() + 120_000);

          const snapshotTaken = Promise.withResolvers<void>();
          const earlierCommitted = Promise.withResolvers<void>();

          const laterTx = second.withTransaction(async (txCtx) => {
            await stateAdapter.getJobs({ txCtx, jobIds: [stateChain.head.id] });
            snapshotTaken.resolve();
            await earlierCommitted.promise;
            return stateAdapter.rescheduleJobs({
              txCtx,
              jobs: [{ jobId: stateChain.head.id, schedule: { at: laterAt } }],
            });
          });

          await snapshotTaken.promise;
          await first.withTransaction(async (txCtx) =>
            stateAdapter.rescheduleJobs({
              txCtx,
              jobs: [{ jobId: stateChain.head.id, schedule: { at: earlierAt } }],
            }),
          );
          earlierCommitted.resolve();

          const [rescheduled] = await laterTx;
          expect(rescheduled!.scheduledAt.getTime()).toBe(laterAt.getTime());
          const [stored] = await stateAdapter.getJobs({ jobIds: [stateChain.head.id] });
          expect(stored!.scheduledAt.getTime()).toBe(laterAt.getTime());
        });
      },
    },
    {
      name: "restores updated job state when rolled back",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["update-rollback"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "update-rollback", input: null },
            ],
          }),
        );

        try {
          await stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.startJobAttempts({
              txCtx,
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["update-rollback"],
              limit: 1,
            });
            throw new Error("rollback after acquire");
          });
        } catch {
          // Expected
        }

        const [after] = await stateAdapter.getJobs({ jobIds: [stateChain.head.id] });
        expect(after?.completedAt).toBeNull();
        expect(after?.attemptAt).toBeNull();
        expect(after?.attempt).toBe(0);

        const [reacquired] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["update-rollback"],
            limit: 1,
          }),
        );
        expect(reacquired.id).toBe(stateChain.head.id);
        expect(reacquired.attempt).toBe(1);
      },
    },
    {
      name: "revives deleted chains when rolled back",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["delete-rollback"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "delete-rollback", input: null },
            ],
          }),
        );

        try {
          await stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.deleteChains({ txCtx, chainIds: [stateChain.head.chainId] });
            throw new Error("rollback after delete");
          });
        } catch {
          // Expected
        }

        const [after] = await stateAdapter.getJobs({ jobIds: [stateChain.head.id] });
        expect(after?.id).toBe(stateChain.head.id);

        const [reacquired] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["delete-rollback"],
            limit: 1,
          }),
        );
        expect(reacquired.id).toBe(stateChain.head.id);
      },
    },
    {
      name: "restores blocker state when rolled back",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
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
        );
        const [targetChain] = await stateAdapter.withTransaction(async (txCtx) =>
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
        );

        await expect(
          stateAdapter.withTransaction(async (txCtx) => {
            const [blockedTarget] = await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: targetChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            });
            expect(blockedTarget.status).toBe("blocked");
            throw new Error("rollback after addJobsBlockers");
          }),
        ).rejects.toThrow("rollback after addJobsBlockers");

        const [after] = await stateAdapter.getJobs({ jobIds: [targetChain.head.id] });
        expect(after?.status).toBe("pending");
        expect(after?.completedAt).toBeNull();
        expect(after?.attemptAt).toBeNull();

        const blockers = await stateAdapter.getJobBlockers({ jobId: targetChain.head.id });
        expect(blockers).toHaveLength(0);

        const blocked = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.head.chainId,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(blocked.items).toHaveLength(0);
      },
    },
    {
      name: "an independent transaction's writes are not swept into a concurrent transaction's rollback",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        if (transactionConcurrency !== "concurrent") {
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

        const outsidePromise = stateAdapter.withTransaction(async (outsideTxCtx) =>
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
        expect(survived?.id).toBe(outsideChain.head.id);
        expect(survived?.input).toEqual({ side: "outside" });
      },
    },
    {
      name: "rolls back mixed mutations atomically with consistent indexes",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["mixed-rollback"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const otherWorker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["mixed-rollback"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [aChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "mixed-rollback", input: null },
            ],
          }),
        );
        const [bChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "mixed-rollback", input: null },
            ],
          }),
        );

        await expect(
          stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.startJobAttempts({
              txCtx,
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["mixed-rollback"],
              limit: 1,
            });
            await stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: aChain.head.id, output: { ok: true } }],
            });
            await stateAdapter.deleteChains({ txCtx, chainIds: [bChain.head.chainId] });
            throw new Error("rollback after mixed mutations");
          }),
        ).rejects.toThrow("rollback after mixed mutations");

        const [aAfter, bAfter] = await stateAdapter.getJobs({
          jobIds: [aChain.head.id, bChain.head.id],
        });
        expect(aAfter?.status).toBe("pending");
        expect(aAfter?.completedAt).toBeNull();
        expect(aAfter?.output).toBeNull();
        expect(aAfter?.attemptAt).toBeNull();
        expect(aAfter?.chain.status).toBe("running");
        expect(aAfter?.chain.completedAt).toBeNull();
        expect(bAfter?.status).toBe("pending");
        expect(bAfter?.completedAt).toBeNull();
        expect(bAfter?.attemptAt).toBeNull();
        expect(bAfter?.chain.status).toBe("running");

        const runningChains = await stateAdapter.listChains({
          typeName: "mixed-rollback",
          status: "running",
          orderBy: "createdAt",
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(runningChains.items.map((chain) => chain.id).toSorted()).toEqual(
          [aChain.id, bChain.id].toSorted(),
        );

        const [reacquired] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            typeNames: ["mixed-rollback"],
            workerId: otherWorker.id,
            workerToken: otherWorker.token,
            limit: 1,
          }),
        );
        expect(reacquired).toBeDefined();
      },
    },
    {
      name: "rolls back completing a tail job together with its chain's head row",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "tail-rollback", input: null },
            ],
          }),
        );
        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
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
        );
        const tailId = continued!.continuation.id;

        await expect(
          stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.getJobs({ txCtx, jobIds: [tailId], lock: "exclusive" });
            const [completed] = await stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: tailId, output: { ok: true } }],
            });
            expect(completed?.chain.status).toBe("completed");
            throw new Error("rollback after completing the tail");
          }),
        ).rejects.toThrow("rollback after completing the tail");

        const [headAfter, tailAfter] = await stateAdapter.getJobs({
          jobIds: [stateChain.id, tailId],
        });
        expect(headAfter?.status).toBe("completed");
        expect(headAfter?.continuedToId).toBe(tailId);
        expect(tailAfter?.status).toBe("pending");
        expect(tailAfter?.completedAt).toBeNull();
        expect(tailAfter?.output).toBeNull();
        expect(tailAfter?.chain.status).toBe("running");
        expect(tailAfter?.chain.completedAt).toBeNull();

        const [chainAfter] = await stateAdapter.getChains({ chainIds: [stateChain.id] });
        expect(chainAfter?.status).toBe("running");
        expect(chainAfter?.completedAt).toBeNull();
        expect(chainAfter?.tail?.id).toBe(tailId);
        expect(chainAfter?.tail?.status).toBe("pending");

        const counts = await stateAdapter.countChainsByTypeName({ typeNames: ["tail-rollback"] });
        expect(counts).toEqual([
          { running: { count: 1, hasMore: false }, completed: { count: 0, hasMore: false } },
        ]);
      },
    },
    {
      name: "parallel withTransaction calls all commit successfully",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        if (transactionConcurrency !== "concurrent") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const count = 5;
        const results = await Promise.all(
          Array.from({ length: count }, async (_, i) =>
            stateAdapter.withTransaction(async (txCtx) =>
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
        expect(ids.size).toBe(count);

        for (const [stateChain] of results) {
          const [fetched] = await stateAdapter.getJobs({ jobIds: [stateChain.head.id] });
          expect(fetched).toBeDefined();
        }
      },
    },
    {
      name: "parallel withTransaction and non-transactional reads do not deadlock",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        if (transactionConcurrency !== "concurrent") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const [seedChain] = await stateAdapter.withTransaction(async (txCtx) =>
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
            stateAdapter.withTransaction(async (txCtx) =>
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
        expect(txResults).toHaveLength(3);
        expect(readResults.every(([job]) => job?.id === seedChain.head.id)).toBe(true);
      },
    },
  ],
};
