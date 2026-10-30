import { sleep } from "@queuert/helpers";

import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const reclaimExpiredJobAttemptGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "reclaimExpiredJobAttempts",
  cases: [
    {
      name: "reclaims a dead worker's job, naming the worker, and stamps the last-attempt fields",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: "reclaim-dead",
          typeNames: [],
          concurrency: 1,
          leaseMs: 1,
        });
        const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "reclaim-dead", input: null }],
          }),
        );
        await stateAdapter.startJobAttempts({ workerId, typeNames: ["reclaim-dead"], limit: 1 });
        await sleep(20);

        const before = Date.now();
        const [reclaimed] = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 1,
        });

        expect(reclaimed.id).toBe(chain.head.id);
        expect(reclaimed.status).toBe("pending");
        expect(reclaimed.attempt).toBe(1);
        expect(reclaimed.completedAt).toBeNull();
        expect(reclaimed.attemptAt).toBeNull();
        expect(reclaimed.attemptBy).toBeNull();
        expect(reclaimed.lastAttemptError).toBe("JobAttemptReclaimedError: test");
        expect(reclaimed.lastAttemptAt).toBeInstanceOf(Date);
        expect(reclaimed.lastAttemptAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
        expect(reclaimed.chain.id).toBe(chain.head.id);
        expect(reclaimed.reclaimedFrom).toEqual({ workerId, workerName: "reclaim-dead" });

        const [stored] = await stateAdapter.getJobs({ jobIds: [chain.head.id] });
        expect(stored!.status).toBe("pending");
        expect(stored!.lastAttemptError).toBe("JobAttemptReclaimedError: test");
        expect(stored!.lastAttemptAt!.getTime()).toBe(reclaimed.lastAttemptAt!.getTime());

        const [reacquired] = await stateAdapter.startJobAttempts({
          workerId: "worker-2",
          typeNames: ["reclaim-dead"],
          limit: 1,
        });
        expect(reacquired.id).toBe(chain.head.id);
        expect(reacquired.attempt).toBe(2);
      },
    },
    {
      name: "deletes the dead worker and reclaims its remaining jobs as absent, one per call",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: "reclaim-many",
          typeNames: [],
          concurrency: 1,
          leaseMs: 1,
        });
        const chains = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "reclaim-many", input: null },
              { id: stateAdapter.config.generateId(), typeName: "reclaim-many", input: null },
              { id: stateAdapter.config.generateId(), typeName: "reclaim-many", input: null },
            ],
          }),
        );
        await stateAdapter.startJobAttempts({ workerId, typeNames: ["reclaim-many"], limit: 3 });
        await sleep(20);

        const [first] = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 1,
        });
        const [second] = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 1,
        });
        const [third] = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 1,
        });
        const [fourth] = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 1,
        });

        expect([first.id, second.id, third.id].sort()).toEqual(
          chains.map((chain) => chain.head.id).sort(),
        );
        expect(first.reclaimedFrom).toEqual({ workerId, workerName: "reclaim-many" });
        expect(second.reclaimedFrom).toEqual({ workerId, workerName: null });
        expect(third.reclaimedFrom).toEqual({ workerId, workerName: null });
        expect(fourth).toBeUndefined();
      },
    },
    {
      name: "reclaims up to limit jobs per call",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: "reclaim-limit",
          typeNames: [],
          concurrency: 1,
          leaseMs: 1,
        });
        const chains = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "reclaim-limit", input: null },
              { id: stateAdapter.config.generateId(), typeName: "reclaim-limit", input: null },
              { id: stateAdapter.config.generateId(), typeName: "reclaim-limit", input: null },
            ],
          }),
        );
        await stateAdapter.startJobAttempts({ workerId, typeNames: ["reclaim-limit"], limit: 3 });
        await sleep(20);

        const firstBatch = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 2,
        });
        const secondBatch = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 5,
        });

        expect(firstBatch.map((job) => job.reclaimedFrom)).toEqual([
          { workerId, workerName: "reclaim-limit" },
          { workerId, workerName: "reclaim-limit" },
        ]);
        expect(secondBatch.map((job) => job.reclaimedFrom)).toEqual([
          { workerId, workerName: null },
        ]);
        expect([...firstBatch, ...secondBatch].map((job) => job.id).sort()).toEqual(
          chains.map((chain) => chain.head.id).sort(),
        );
      },
    },
    {
      name: "deletes an expired worker holding nothing",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: "reclaim-idle",
          typeNames: [],
          concurrency: 1,
          leaseMs: 1,
        });
        await sleep(20);

        expect(
          await stateAdapter.reclaimExpiredJobAttempts({
            lastAttemptError: "JobAttemptReclaimedError: test",
            limit: 1,
          }),
        ).toEqual([]);

        const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "reclaim-idle", input: null }],
          }),
        );
        await stateAdapter.startJobAttempts({ workerId, typeNames: ["reclaim-idle"], limit: 1 });
        const [reclaimed] = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 1,
        });
        expect(reclaimed.id).toBe(chain.head.id);
        expect(reclaimed.reclaimedFrom).toEqual({ workerId, workerName: null });
      },
    },
    {
      name: "reclaims a job whose worker has no row",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "reclaim-absent", input: null },
            ],
          }),
        );
        await stateAdapter.startJobAttempts({ workerId, typeNames: ["reclaim-absent"], limit: 1 });

        const [reclaimed] = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 1,
        });

        expect(reclaimed.id).toBe(chain.head.id);
        expect(reclaimed.reclaimedFrom).toEqual({ workerId, workerName: null });
      },
    },
    {
      name: "reclaims jobs of every type",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 1,
        });
        const [chainA, chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "reclaim-type-a", input: null },
              { id: stateAdapter.config.generateId(), typeName: "reclaim-type-b", input: null },
            ],
          }),
        );
        await stateAdapter.startJobAttempts({
          workerId,
          typeNames: ["reclaim-type-a", "reclaim-type-b"],
          limit: 2,
        });
        await sleep(20);

        const [first] = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 1,
        });
        const [second] = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 1,
        });

        expect([first.id, second.id].sort()).toEqual([chainA.head.id, chainB.head.id].sort());
        expect([first.typeName, second.typeName].sort()).toEqual([
          "reclaim-type-a",
          "reclaim-type-b",
        ]);
      },
    },
    {
      name: "leaves the jobs of live workers running",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "reclaim-live", input: null }],
          }),
        );
        await stateAdapter.startJobAttempts({ workerId, typeNames: ["reclaim-live"], limit: 1 });

        expect(
          await stateAdapter.reclaimExpiredJobAttempts({
            lastAttemptError: "JobAttemptReclaimedError: test",
            limit: 1,
          }),
        ).toEqual([]);

        const [stored] = await stateAdapter.getJobs({ jobIds: [chain.head.id] });
        expect(stored!.status).toBe("running");
        expect(stored!.attemptBy).toBe(workerId);
        expect((await stateAdapter.extendWorkerLease({ workerId, leaseMs: 60_000 }))!.id).toBe(
          workerId,
        );
      },
    },
    {
      name: "returns no jobs when nothing is reclaimable",
      run: async ({ stateAdapter }, expect) => {
        expect(
          await stateAdapter.reclaimExpiredJobAttempts({
            lastAttemptError: "JobAttemptReclaimedError: test",
            limit: 1,
          }),
        ).toEqual([]);
      },
    },
    {
      name: "a reclaim rolled back with its transaction restores the worker and the job",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: "reclaim-rollback",
          typeNames: [],
          concurrency: 1,
          leaseMs: 1,
        });
        const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "reclaim-rollback", input: null },
            ],
          }),
        );
        await stateAdapter.startJobAttempts({
          workerId,
          typeNames: ["reclaim-rollback"],
          limit: 1,
        });
        await sleep(20);

        await expect(
          stateAdapter.withTransaction(async (txCtx) => {
            const [reclaimed] = await stateAdapter.reclaimExpiredJobAttempts({
              txCtx,
              lastAttemptError: "JobAttemptReclaimedError: test",
              limit: 1,
            });
            expect(reclaimed.id).toBe(chain.head.id);
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");

        const [stored] = await stateAdapter.getJobs({ jobIds: [chain.head.id] });
        expect(stored!.status).toBe("running");
        expect(stored!.attemptBy).toBe(workerId);

        const [reclaimed] = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 1,
        });
        expect(reclaimed.reclaimedFrom).toEqual({ workerId, workerName: "reclaim-rollback" });
      },
    },
    {
      name: "skips a worker whose renewal is held in an open transaction",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        if (transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 500,
        });
        const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "reclaim-renewing", input: null },
            ],
          }),
        );
        await stateAdapter.startJobAttempts({
          workerId,
          typeNames: ["reclaim-renewing"],
          limit: 1,
        });

        const renewed = Promise.withResolvers<void>();
        const renewalGate = Promise.withResolvers<void>();

        const renewalTx = stateAdapter.withTransaction(async (txCtx) => {
          const worker = await stateAdapter.extendWorkerLease({
            txCtx,
            workerId,
            leaseMs: 60_000,
          });
          renewed.resolve();
          await renewalGate.promise;
          return worker;
        });

        await renewed.promise;

        try {
          await sleep(600);
          expect(
            await stateAdapter.reclaimExpiredJobAttempts({
              lastAttemptError: "JobAttemptReclaimedError: test",
              limit: 1,
            }),
          ).toEqual([]);
        } finally {
          renewalGate.resolve();
        }
        expect((await renewalTx)!.id).toBe(workerId);

        expect(
          await stateAdapter.reclaimExpiredJobAttempts({
            lastAttemptError: "JobAttemptReclaimedError: test",
            limit: 1,
          }),
        ).toEqual([]);
        const [stored] = await stateAdapter.getJobs({ jobIds: [chain.head.id] });
        expect(stored!.status).toBe("running");
        expect(stored!.attemptBy).toBe(workerId);
      },
    },
    {
      name: "skips a job locked by an open transaction and reclaims it on a later call",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        if (transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: "reclaim-locked",
          typeNames: [],
          concurrency: 1,
          leaseMs: 1,
        });
        const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "reclaim-locked", input: null },
            ],
          }),
        );
        await stateAdapter.startJobAttempts({ workerId, typeNames: ["reclaim-locked"], limit: 1 });
        await sleep(20);

        const jobLocked = Promise.withResolvers<void>();
        const jobGate = Promise.withResolvers<void>();

        const lockerTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getJobs({ txCtx, jobIds: [chain.head.id], lock: "exclusive" });
          jobLocked.resolve();
          await jobGate.promise;
        });

        await jobLocked.promise;

        try {
          expect(
            await stateAdapter.reclaimExpiredJobAttempts({
              lastAttemptError: "JobAttemptReclaimedError: test",
              limit: 1,
            }),
          ).toEqual([]);
        } finally {
          jobGate.resolve();
          await lockerTx;
        }

        const [reclaimed] = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 1,
        });
        expect(reclaimed.id).toBe(chain.head.id);
        expect(reclaimed.reclaimedFrom).toEqual({ workerId, workerName: null });
      },
    },
    {
      name: "reclaims another job of a dead worker past one locked by an open transaction",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        if (transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: "reclaim-past-locked",
          typeNames: [],
          concurrency: 1,
          leaseMs: 1,
        });
        const [lockedChain, otherChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "reclaim-past-locked",
                input: null,
              },
              {
                id: stateAdapter.config.generateId(),
                typeName: "reclaim-past-locked",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.startJobAttempts({
          workerId,
          typeNames: ["reclaim-past-locked"],
          limit: 2,
        });
        await sleep(20);

        const jobLocked = Promise.withResolvers<void>();
        const jobGate = Promise.withResolvers<void>();

        const lockerTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getJobs({ txCtx, jobIds: [lockedChain.head.id], lock: "exclusive" });
          jobLocked.resolve();
          await jobGate.promise;
        });

        await jobLocked.promise;

        try {
          const [reclaimedOther] = await stateAdapter.reclaimExpiredJobAttempts({
            lastAttemptError: "JobAttemptReclaimedError: test",
            limit: 1,
          });
          expect(reclaimedOther.id).toBe(otherChain.head.id);
          expect(reclaimedOther.reclaimedFrom).toEqual({
            workerId,
            workerName: "reclaim-past-locked",
          });
        } finally {
          jobGate.resolve();
          await lockerTx;
        }

        const [reclaimedLocked] = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 1,
        });
        expect(reclaimedLocked.id).toBe(lockedChain.head.id);
        expect(reclaimedLocked.reclaimedFrom).toEqual({ workerId, workerName: null });
      },
    },
    {
      name: "reclaims on a later call a claim committed after its worker was deleted",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        if (transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: "reclaim-late-claim",
          typeNames: [],
          concurrency: 1,
          leaseMs: 1,
        });
        await sleep(20);
        const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "reclaim-late-claim", input: null },
            ],
          }),
        );

        const claimed = Promise.withResolvers<void>();
        const claimGate = Promise.withResolvers<void>();

        const claimTx = stateAdapter.withTransaction(async (txCtx) => {
          const [job] = await stateAdapter.startJobAttempts({
            txCtx,
            workerId,
            typeNames: ["reclaim-late-claim"],
            limit: 1,
          });
          claimed.resolve();
          await claimGate.promise;
          return job;
        });

        await claimed.promise;

        try {
          expect(
            await stateAdapter.reclaimExpiredJobAttempts({
              lastAttemptError: "JobAttemptReclaimedError: test",
              limit: 1,
            }),
          ).toEqual([]);
        } finally {
          claimGate.resolve();
        }
        expect((await claimTx).id).toBe(chain.head.id);

        const [reclaimed] = await stateAdapter.reclaimExpiredJobAttempts({
          lastAttemptError: "JobAttemptReclaimedError: test",
          limit: 1,
        });
        expect(reclaimed.id).toBe(chain.head.id);
        expect(reclaimed.reclaimedFrom).toEqual({ workerId, workerName: null });
      },
    },
  ],
};
