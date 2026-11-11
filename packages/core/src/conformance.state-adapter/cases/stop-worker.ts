import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const stopWorkerGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "stopWorker",
  cases: [
    {
      name: "deletes the row and returns the deleted worker",
      run: async ({ createStateAdapter }) => {
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

        assert.equal(stopped!.id, started.id);
        assert.deepEqual(stopped!.typeNames, ["stop-a"]);
        assert.equal(stopped!.concurrency, 2);
        assert.equal(stopped!.startedAt.getTime(), started.startedAt.getTime());
        assert.equal(
          await stateAdapter.extendWorkerLease({
            workerId: started.id,
            workerToken: started.token,
            leaseMs: 60_000,
          }),
          undefined,
        );
        assert.equal(
          (await stateAdapter.extendWorkerLease({
            workerId: otherWorker.id,
            workerToken: otherWorker.token,
            leaseMs: 60_000,
          }))!.id,
          otherWorker.id,
        );
      },
    },
    {
      name: "leaves jobs running under the worker untouched",
      run: async ({ createStateAdapter }) => {
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
        assert.equal(stored!.status, "running");
        assert.equal(stored!.attemptBy, worker.id);
      },
    },
    {
      name: "a missing worker stops to undefined",
      run: async ({ createStateAdapter }) => {
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

        assert.equal(
          await stateAdapter.stopWorker({
            workerId: worker.id,
            workerToken: worker.token,
          }),
          undefined,
        );
        assert.equal(
          await stateAdapter.stopWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            workerToken: crypto.randomUUID(),
          }),
          undefined,
        );
      },
    },
    {
      name: "returns undefined for a stale registration and keeps the current row",
      run: async ({ createStateAdapter }) => {
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
        assert.notEqual(currentRun.startedAt.getTime(), staleRun.startedAt.getTime());

        assert.equal(
          await stateAdapter.stopWorker({
            workerId,
            workerToken: staleRun.token,
          }),
          undefined,
        );
        const [stored] = await stateAdapter.getWorkers({ workerIds: [workerId] });
        assert.equal(stored!.startedAt.getTime(), currentRun.startedAt.getTime());

        const stopped = await stateAdapter.stopWorker({
          workerId,
          workerToken: currentRun.token,
        });
        assert.equal(stopped!.id, workerId);
        assert.equal(stopped!.startedAt.getTime(), currentRun.startedAt.getTime());
        assert.deepEqual(await stateAdapter.getWorkers({ workerIds: [workerId] }), [undefined]);
      },
    },
    {
      name: "a stop rolled back with its transaction restores the worker",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });

        await assert.rejects(
          stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.stopWorker({
              txCtx,
              workerId: worker.id,
              workerToken: worker.token,
            });
            throw new Error("rollback");
          }),
          /rollback/,
        );

        assert.equal(
          (await stateAdapter.extendWorkerLease({
            workerId: worker.id,
            workerToken: worker.token,
            leaseMs: 60_000,
          }))!.id,
          worker.id,
        );
      },
    },
  ],
};
