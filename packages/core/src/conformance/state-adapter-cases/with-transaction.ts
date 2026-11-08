import type { ConformanceGroup } from "../runner.ts";
import type { StateConformanceFixture } from "./types.ts";

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
        await expect(
          stateAdapter.withTransaction(async (txCtx) => {
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
          }),
        ).rejects.toThrow("Intentional rollback");

        const [original] = await stateAdapter.getJobs({ jobIds: [stateChain.head.id] });
        expect(original).toBeDefined();
        expect(await stateAdapter.getJobs({ jobIds: [rolledBackJobId!] })).toEqual([undefined]);
      },
    },
    {
      name: "a call without a transaction context is not swept into an open transaction's rollback",
      run: async ({ stateAdapter }, expect) => {
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
        await expect(transaction).rejects.toThrow("rollback");
        await autocommit;

        const [worker] = await stateAdapter.getWorkers({ workerIds: [workerId] });
        expect(worker?.id).toBe(workerId);
        expect(await stateAdapter.getJobs({ jobIds: [rolledBackJobId!] })).toEqual([undefined]);
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
  ],
};

export const withTransactionConcurrentTransactionsGroup: ConformanceGroup<StateConformanceFixture> =
  {
    name: "withTransaction",
    cases: [
      {
        name: "an independent transaction's writes are not swept into a concurrent transaction's rollback",
        run: async ({ stateAdapter }, expect) => {
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
        name: "parallel withTransaction calls all commit successfully",
        run: async ({ stateAdapter }, expect) => {
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
        run: async ({ stateAdapter }, expect) => {
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
