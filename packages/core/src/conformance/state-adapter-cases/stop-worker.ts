import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const stopWorkerGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "stopWorker",
  cases: [
    {
      name: "deletes the row and reclaims every job running under the worker",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        const otherWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: "lifecycle-stop",
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: otherWorkerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "stop-a", input: null },
              { id: stateAdapter.config.generateId(), typeName: "stop-b", input: null },
              { id: stateAdapter.config.generateId(), typeName: "stop-other", input: null },
            ],
          }),
        );
        const [claimedA] = await stateAdapter.startJobAttempts({
          workerId,
          typeNames: ["stop-a"],
          limit: 1,
        });
        const [claimedB] = await stateAdapter.startJobAttempts({
          workerId,
          typeNames: ["stop-b"],
          limit: 1,
        });
        const [claimedOther] = await stateAdapter.startJobAttempts({
          workerId: otherWorkerId,
          typeNames: ["stop-other"],
          limit: 1,
        });

        const before = Date.now();
        const reclaimed = await stateAdapter.stopWorker({
          workerId,
          lastAttemptError: "JobAttemptReclaimedError: stopped",
        });

        expect(reclaimed.map((job) => job.id).sort()).toEqual([claimedA.id, claimedB.id].sort());
        for (const job of reclaimed) {
          expect(job.status).toBe("pending");
          expect(job.attempt).toBe(1);
          expect(job.attemptAt).toBeNull();
          expect(job.attemptBy).toBeNull();
          expect(job.lastAttemptError).toBe("JobAttemptReclaimedError: stopped");
          expect(job.lastAttemptAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
          expect(job.reclaimedFrom).toEqual({ workerId, workerName: "lifecycle-stop" });
        }

        expect(await stateAdapter.extendWorkerLease({ workerId, leaseMs: 60_000 })).toBeUndefined();

        const [storedA, storedOther] = await stateAdapter.getJobs({
          jobIds: [claimedA.id, claimedOther.id],
        });
        expect(storedA!.status).toBe("pending");
        expect(storedA!.lastAttemptError).toBe("JobAttemptReclaimedError: stopped");
        expect(storedOther!.status).toBe("running");
        expect(storedOther!.attemptBy).toBe(otherWorkerId);
      },
    },
    {
      name: "is safe when the row is already gone",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });

        expect(
          await stateAdapter.stopWorker({ workerId, lastAttemptError: "JobAttemptReclaimedError" }),
        ).toEqual([]);
        expect(
          await stateAdapter.stopWorker({ workerId, lastAttemptError: "JobAttemptReclaimedError" }),
        ).toEqual([]);
        expect(
          await stateAdapter.stopWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            lastAttemptError: "JobAttemptReclaimedError",
          }),
        ).toEqual([]);
      },
    },
    {
      name: "reclaims jobs left under a worker whose row is already gone",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "stop-absent", input: null }],
          }),
        );
        const [claimed] = await stateAdapter.startJobAttempts({
          workerId,
          typeNames: ["stop-absent"],
          limit: 1,
        });

        const reclaimed = await stateAdapter.stopWorker({
          workerId,
          lastAttemptError: "JobAttemptReclaimedError: stopped",
        });

        expect(reclaimed.map((job) => job.id)).toEqual([claimed.id]);
        expect(reclaimed[0].reclaimedFrom).toEqual({ workerId, workerName: null });
      },
    },
    {
      name: "a stop rolled back with its transaction restores the worker and its jobs",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          name: null,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "stop-rollback", input: null },
            ],
          }),
        );
        const [claimed] = await stateAdapter.startJobAttempts({
          workerId,
          typeNames: ["stop-rollback"],
          limit: 1,
        });

        await expect(
          stateAdapter.withTransaction(async (txCtx) => {
            const reclaimed = await stateAdapter.stopWorker({
              txCtx,
              workerId,
              lastAttemptError: "JobAttemptReclaimedError: stopped",
            });
            expect(reclaimed).toHaveLength(1);
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");

        const [stored] = await stateAdapter.getJobs({ jobIds: [claimed.id] });
        expect(stored!.status).toBe("running");
        expect(stored!.attemptBy).toBe(workerId);
        expect((await stateAdapter.extendWorkerLease({ workerId, leaseMs: 60_000 }))!.id).toBe(
          workerId,
        );
      },
    },
  ],
};
