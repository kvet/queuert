import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const withTransactionGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "withTransaction",
  cases: [
    {
      name: "maintains transaction isolation",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "isolation-test",
                chainTypeName: "isolation-test",
                input: { value: "original" },
              },
            ],
          }),
        );

        let rolledBackJobId: string | undefined;
        try {
          await stateAdapter.withTransaction(async (txCtx) => {
            const [{ job: innerJob }] = await stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "rollback-test",
                  chainTypeName: "rollback-test",
                  input: { value: "should-rollback" },
                },
              ],
            });
            rolledBackJobId = innerJob.id;
            throw new Error("Intentional rollback");
          });
        } catch {
          // Expected
        }

        const [original] = await stateAdapter.getJobs({ jobIds: [job.id] });
        expect(original).toBeDefined();

        if (rolledBackJobId) {
          expect(await stateAdapter.getJobs({ jobIds: [rolledBackJobId] })).toEqual([undefined]);
        }
      },
    },
    {
      name: "restores updated job state when rolled back",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "update-rollback",
                chainTypeName: "update-rollback",
                input: null,
              },
            ],
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

        const [after] = await stateAdapter.getJobs({ jobIds: [job.id] });
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
        expect(reacquired.job?.id).toBe(job.id);
        expect(reacquired.job?.attempt).toBe(1);
      },
    },
    {
      name: "revives deleted chains when rolled back",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "delete-rollback",
                chainTypeName: "delete-rollback",
                input: null,
              },
            ],
          }),
        );

        try {
          await stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.deleteChains({ txCtx, chainIds: [job.chainId] });
            throw new Error("rollback after delete");
          });
        } catch {
          // Expected
        }

        const [after] = await stateAdapter.getJobs({ jobIds: [job.id] });
        expect(after?.id).toBe(job.id);

        const reacquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["delete-rollback"],
          }),
        );
        expect(reacquired.job?.id).toBe(job.id);
      },
    },
    {
      name: "restores blocker state when rolled back",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blocker }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "blocker-rollback-a",
                chainTypeName: "blocker-rollback-a",
                input: null,
              },
            ],
          }),
        );
        const [{ job: target }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "blocker-rollback-b",
                chainTypeName: "blocker-rollback-b",
                input: null,
              },
            ],
          }),
        );

        try {
          await stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: target.id, blockedByChainIds: [blocker.chainId] }],
            });
            throw new Error("rollback after addJobsBlockers");
          });
        } catch {
          // Expected
        }

        const [after] = await stateAdapter.getJobs({ jobIds: [target.id] });
        expect(after?.completedAt).toBeNull();
        expect(after?.attemptAt).toBeNull();

        const blockers = await stateAdapter.getJobBlockers({ jobId: target.id });
        expect(blockers).toHaveLength(0);

        const blocked = await stateAdapter.listBlockedJobs({
          chainId: blocker.chainId,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(blocked.items).toHaveLength(0);
      },
    },
    {
      name: "non-transactional writes are not swept into a concurrent transaction's rollback",
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
            await stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "nontx-vs-tx",
                  chainTypeName: "nontx-vs-tx",
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

        const nonTxPromise = stateAdapter.createChains({
          jobs: [
            {
              typeName: "nontx-vs-tx",
              chainTypeName: "nontx-vs-tx",
              input: { side: "non-tx" },
            },
          ],
        });

        release!();
        await txPromise;
        const [{ job: outside }] = await nonTxPromise;

        const [survived] = await stateAdapter.getJobs({ jobIds: [outside.id] });
        expect(survived?.id).toBe(outside.id);
        expect(survived?.input).toEqual({ side: "non-tx" });
      },
    },
    {
      name: "rolls back mixed mutations atomically with consistent indexes",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: a }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "mixed-rollback",
                chainTypeName: "mixed-rollback",
                input: null,
              },
            ],
          }),
        );
        const [{ job: b }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "mixed-rollback",
                chainTypeName: "mixed-rollback",
                input: null,
              },
            ],
          }),
        );

        try {
          await stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.startJobAttempt({
              txCtx,
              workerId: "worker-1",
              typeNames: ["mixed-rollback"],
            });
            await stateAdapter.finishJobAttempt({
              txCtx,
              jobId: a.id,
              workerId: "worker-1",
              outcome: { output: { ok: true } },
            });
            await stateAdapter.deleteChains({ txCtx, chainIds: [b.chainId] });
            throw new Error("rollback after mixed mutations");
          });
        } catch {
          // Expected
        }

        const [aAfter] = await stateAdapter.getJobs({ jobIds: [a.id] });
        const [bAfter] = await stateAdapter.getJobs({ jobIds: [b.id] });
        expect(aAfter?.completedAt).toBeNull();
        expect(aAfter?.attemptAt).toBeNull();
        expect(aAfter?.completedAt).toBeNull();
        expect(bAfter?.completedAt).toBeNull();
        expect(bAfter?.attemptAt).toBeNull();

        const { job: reacquired } = await stateAdapter.withTransaction(async (txCtx) =>
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
              stateAdapter.createChains({
                txCtx,
                jobs: [
                  {
                    typeName: "parallel-tx",
                    chainTypeName: "parallel-tx",
                    input: { index: i },
                  },
                ],
              }),
            ),
          ),
        );

        const ids = new Set(results.map(([r]) => r.job.id));
        expect(ids.size).toBe(count);

        for (const [{ job }] of results) {
          const [fetched] = await stateAdapter.getJobs({ jobIds: [job.id] });
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
        const [{ job: seedJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "mixed-concurrency",
                chainTypeName: "mixed-concurrency",
                input: null,
              },
            ],
          }),
        );

        const txWork = Promise.all(
          Array.from({ length: 3 }, async (_, i) =>
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.createChains({
                txCtx,
                jobs: [
                  {
                    typeName: "mixed-tx",
                    chainTypeName: "mixed-tx",
                    input: { index: i },
                  },
                ],
              }),
            ),
          ),
        );

        const readWork = Promise.all(
          Array.from({ length: 5 }, async () => stateAdapter.getJobs({ jobIds: [seedJob.id] })),
        );

        const [txResults, readResults] = await Promise.all([txWork, readWork]);
        expect(txResults).toHaveLength(3);
        expect(readResults.every(([job]) => job?.id === seedJob.id)).toBe(true);
      },
    },
  ],
};
