import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

export const withTransactionGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "withTransaction",
  cases: [
    {
      name: "maintains transaction isolation",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "isolation-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "isolation-test",
                input: { value: "original" },
              },
            ],
          }),
        );

        let rolledBackJobId: string | undefined;
        try {
          await stateAdapter.withTransaction(async (txCtx) => {
            const [{ job: innerJob }] = await stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "rollback-test",
                  chainId: undefined,
                  chainIndex: 0,
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

        const original = await stateAdapter.getJob({ jobId: job.id });
        expect(original).toBeDefined();

        if (rolledBackJobId) {
          const rolledBack = await stateAdapter.getJob({ jobId: rolledBackJobId });
          expect(rolledBack).toBeUndefined();
        }
      },
    },
    {
      name: "restores updated job state when rolled back",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "update-rollback",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "update-rollback",
                input: null,
              },
            ],
          }),
        );

        try {
          await stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.acquireJob({ txCtx, typeNames: ["update-rollback"] });
            throw new Error("rollback after acquire");
          });
        } catch {
          // Expected
        }

        const after = await stateAdapter.getJob({ jobId: job.id });
        expect(after?.status).toBe("pending");
        expect(after?.attempt).toBe(0);

        const reacquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["update-rollback"] }),
        );
        expect(reacquired.job?.id).toBe(job.id);
        expect(reacquired.job?.attempt).toBe(1);
      },
    },
    {
      name: "revives deleted chains when rolled back",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "delete-rollback",
                chainId: undefined,
                chainIndex: 0,
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

        const after = await stateAdapter.getJob({ jobId: job.id });
        expect(after?.id).toBe(job.id);

        const reacquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.acquireJob({ txCtx, typeNames: ["delete-rollback"] }),
        );
        expect(reacquired.job?.id).toBe(job.id);
      },
    },
    {
      name: "restores blocker state when rolled back",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blocker }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker-rollback-a",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "blocker-rollback-a",
                input: null,
              },
            ],
          }),
        );
        const [{ job: target }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker-rollback-b",
                chainId: undefined,
                chainIndex: 0,
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

        const after = await stateAdapter.getJob({ jobId: target.id });
        expect(after?.status).toBe("pending");

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
            await stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "nontx-vs-tx",
                  chainId: undefined,
                  chainIndex: 0,
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

        const nonTxPromise = stateAdapter.createJobs({
          jobs: [
            {
              typeName: "nontx-vs-tx",
              chainId: undefined,
              chainIndex: 0,
              chainTypeName: "nontx-vs-tx",
              input: { side: "non-tx" },
            },
          ],
        });

        release!();
        await txPromise;
        const [{ job: outside }] = await nonTxPromise;

        const survived = await stateAdapter.getJob({ jobId: outside.id });
        expect(survived?.id).toBe(outside.id);
        expect(survived?.input).toEqual({ side: "non-tx" });
      },
    },
    {
      name: "rolls back mixed mutations atomically with consistent indexes",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: a }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "mixed-rollback",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "mixed-rollback",
                input: null,
              },
            ],
          }),
        );
        const [{ job: b }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "mixed-rollback",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "mixed-rollback",
                input: null,
              },
            ],
          }),
        );

        try {
          await stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.acquireJob({ txCtx, typeNames: ["mixed-rollback"] });
            await stateAdapter.completeJob({
              txCtx,
              jobId: a.id,
              output: { ok: true },
              workerId: "w1",
            });
            await stateAdapter.deleteChains({ txCtx, chainIds: [b.chainId] });
            throw new Error("rollback after mixed mutations");
          });
        } catch {
          // Expected
        }

        const aAfter = await stateAdapter.getJob({ jobId: a.id });
        const bAfter = await stateAdapter.getJob({ jobId: b.id });
        expect(aAfter?.status).toBe("pending");
        expect(aAfter?.completedAt).toBeNull();
        expect(bAfter?.status).toBe("pending");

        const next = await stateAdapter.getNextJobAvailableInMs({
          typeNames: ["mixed-rollback"],
        });
        expect(next).toBe(0);
      },
    },
  ],
};
