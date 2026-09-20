import { type ConformanceGroup } from "../runner.js";
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
            jobs: [{ typeName: "isolation-test", input: { value: "original" } }],
          }),
        );

        let rolledBackJobId: string | undefined;
        try {
          await stateAdapter.withTransaction(async (txCtx) => {
            const [innerChain] = await stateAdapter.createJobs({
              txCtx,
              jobs: [{ typeName: "rollback-test", input: { value: "should-rollback" } }],
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
      name: "restores updated job state when rolled back",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "update-rollback", input: null }],
          }),
        );

        try {
          await stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.startJobAttempt({
              txCtx,
              workerId: "worker-1",
              typeNames: ["update-rollback"],
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

        const reacquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["update-rollback"],
          }),
        );
        expect(reacquired!.id).toBe(stateChain.head.id);
        expect(reacquired!.attempt).toBe(1);
      },
    },
    {
      name: "revives deleted chains when rolled back",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "delete-rollback", input: null }],
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

        const reacquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["delete-rollback"],
          }),
        );
        expect(reacquired!.id).toBe(stateChain.head.id);
      },
    },
    {
      name: "restores blocker state when rolled back",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker-rollback-a", input: null }],
          }),
        );
        const [targetChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker-rollback-b", input: null }],
          }),
        );

        try {
          await stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: targetChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            });
            throw new Error("rollback after addJobsBlockers");
          });
        } catch {
          // Expected
        }

        const [after] = await stateAdapter.getJobs({ jobIds: [targetChain.head.id] });
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

        const txPromise = stateAdapter
          .withTransaction(async (txCtx) => {
            await stateAdapter.createJobs({
              txCtx,
              jobs: [{ typeName: "independent-vs-tx", input: { side: "tx" } }],
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
            jobs: [{ typeName: "independent-vs-tx", input: { side: "outside" } }],
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
        const [aChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "mixed-rollback", input: null }],
          }),
        );
        const [bChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "mixed-rollback", input: null }],
          }),
        );

        try {
          await stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.startJobAttempt({
              txCtx,
              workerId: "worker-1",
              typeNames: ["mixed-rollback"],
            });
            await stateAdapter.completeJobs({
              txCtx,
              completedBy: "worker-1",
              jobs: [{ jobId: aChain.head.id, output: { ok: true } }],
            });
            await stateAdapter.deleteChains({ txCtx, chainIds: [bChain.head.chainId] });
            throw new Error("rollback after mixed mutations");
          });
        } catch {
          // Expected
        }

        const [aAfter] = await stateAdapter.getJobs({ jobIds: [aChain.head.id] });
        const [bAfter] = await stateAdapter.getJobs({ jobIds: [bChain.head.id] });
        expect(aAfter?.completedAt).toBeNull();
        expect(aAfter?.attemptAt).toBeNull();
        expect(aAfter?.completedAt).toBeNull();
        expect(bAfter?.completedAt).toBeNull();
        expect(bAfter?.attemptAt).toBeNull();

        const reacquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            typeNames: ["mixed-rollback"],
            workerId: "rollback-probe",
          }),
        );
        expect(reacquired).toBeDefined();
      },
    },
    {
      name: "parallel withTransaction calls all commit successfully",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const count = 5;
        const results = await Promise.all(
          Array.from({ length: count }, async (_, i) =>
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [{ typeName: "parallel-tx", input: { index: i } }],
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
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const [seedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "mixed-concurrency", input: null }],
          }),
        );

        const txWork = Promise.all(
          Array.from({ length: 3 }, async (_, i) =>
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [{ typeName: "mixed-tx", input: { index: i } }],
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
