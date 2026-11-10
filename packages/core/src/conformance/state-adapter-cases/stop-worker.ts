import { sleep } from "@queuert/helpers";

import type { ConformanceGroup } from "../runner.ts";
import type { StateAdapterConformanceContext } from "./types.ts";

export const stopWorkerGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "stopWorker",
  cases: [
    {
      name: "deletes the row and returns the deleted worker",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const started = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["stop-a"],
          concurrency: 2,
          leaseMs: 60_000,
        });
        const otherWorker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });

        const stopped = await stateAdapter.stopWorker({
          workerId: started.id,
          workerToken: started.token,
        });

        expect(stopped!.id).toBe(started.id);
        expect(stopped!.typeNames).toEqual(["stop-a"]);
        expect(stopped!.concurrency).toBe(2);
        expect(stopped!.startedAt.getTime()).toBe(started.startedAt.getTime());
        expect(
          await stateAdapter.extendWorkerLease({
            workerId: started.id,
            workerToken: started.token,
            leaseMs: 60_000,
          }),
        ).toBeUndefined();
        expect(
          (await stateAdapter.extendWorkerLease({
            workerId: otherWorker.id,
            workerToken: otherWorker.token,
            leaseMs: 60_000,
          }))!.id,
        ).toBe(otherWorker.id);
      },
    },
    {
      name: "leaves jobs running under the worker untouched",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "stop-running", input: null },
            ],
          }),
        );
        const [claimed] = await stateAdapter.startJobAttempts({
          typeNames: ["stop-running"],
          workerId: worker.id,
          workerToken: worker.token,
          limit: 1,
        });

        await stateAdapter.stopWorker({
          workerId: worker.id,
          workerToken: worker.token,
        });

        const [stored] = await stateAdapter.getJobs({ jobIds: [claimed.id] });
        expect(stored!.status).toBe("running");
        expect(stored!.attemptBy).toBe(worker.id);
      },
    },
    {
      name: "a missing worker stops to undefined",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.stopWorker({
          workerId: worker.id,
          workerToken: worker.token,
        });

        expect(
          await stateAdapter.stopWorker({
            workerId: worker.id,
            workerToken: worker.token,
          }),
        ).toBeUndefined();
        expect(
          await stateAdapter.stopWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            workerToken: crypto.randomUUID(),
          }),
        ).toBeUndefined();
      },
    },
    {
      name: "returns undefined for a stale registration and keeps the current row",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const workerId = stateAdapter.config.generateWorkerId();
        const staleRun = await stateAdapter.startWorker({
          workerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.stopWorker({ workerId, workerToken: staleRun.token });
        await sleep(5);
        const currentRun = await stateAdapter.startWorker({
          workerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        expect(currentRun.startedAt.getTime()).not.toBe(staleRun.startedAt.getTime());

        expect(
          await stateAdapter.stopWorker({
            workerId,
            workerToken: staleRun.token,
          }),
        ).toBeUndefined();
        const [stored] = await stateAdapter.getWorkers({ workerIds: [workerId] });
        expect(stored!.startedAt.getTime()).toBe(currentRun.startedAt.getTime());

        const stopped = await stateAdapter.stopWorker({
          workerId,
          workerToken: currentRun.token,
        });
        expect(stopped!.id).toBe(workerId);
        expect(stopped!.startedAt.getTime()).toBe(currentRun.startedAt.getTime());
        expect(await stateAdapter.getWorkers({ workerIds: [workerId] })).toEqual([undefined]);
      },
    },
    {
      name: "a stop rolled back with its transaction restores the worker",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });

        await expect(
          stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.stopWorker({
              txCtx,
              workerId: worker.id,
              workerToken: worker.token,
            });
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");

        expect(
          (await stateAdapter.extendWorkerLease({
            workerId: worker.id,
            workerToken: worker.token,
            leaseMs: 60_000,
          }))!.id,
        ).toBe(worker.id);
      },
    },
  ],
};
