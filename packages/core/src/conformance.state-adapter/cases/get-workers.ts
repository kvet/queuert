import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers/sleep";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const getWorkersGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getWorkers",
  cases: [
    {
      name: "returns an empty array for empty ids",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        assert.deepEqual(await stateAdapter.getWorkers({ workerIds: [] }), []);
      },
    },
    {
      name: "returns undefined for an unknown id",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        assert.deepEqual(
          await stateAdapter.getWorkers({ workerIds: [stateAdapter.config.generateWorkerId()] }),
          [undefined],
        );
      },
    },
    {
      name: "returns workers in input order with their type names and concurrency",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const firstWorkerId = stateAdapter.config.generateWorkerId();
        const secondWorkerId = stateAdapter.config.generateWorkerId();
        const missingWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: firstWorkerId,
          typeNames: ["send-welcome-email"],
          concurrency: 2,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: secondWorkerId,
          typeNames: ["sync-to-crm", "render-invoice-pdf"],
          concurrency: 5,
          leaseMs: 60_000,
        });

        const workers = await stateAdapter.getWorkers({
          workerIds: [secondWorkerId, missingWorkerId, firstWorkerId],
        });

        assert.deepEqual(
          workers.map((worker) =>
            worker
              ? {
                  id: worker.id,
                  typeNames: worker.typeNames,
                  concurrency: worker.concurrency,
                }
              : undefined,
          ),
          [
            {
              id: secondWorkerId,
              typeNames: ["sync-to-crm", "render-invoice-pdf"],
              concurrency: 5,
            },
            undefined,
            {
              id: firstWorkerId,
              typeNames: ["send-welcome-email"],
              concurrency: 2,
            },
          ],
        );
        assert.ok(workers[0]!.startedAt instanceof Date);
        assert.ok(workers[0]!.leaseUntil instanceof Date);
        assert.equal(workers[0]!.expired, false);
      },
    },
    {
      name: "returns an unreclaimed worker whose lease is no longer live, with its leaseUntil",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const started = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: [],
          concurrency: 1,
          leaseMs: 0,
        });

        const [worker] = await stateAdapter.getWorkers({ workerIds: [started.id] });

        assert.equal(worker!.leaseUntil.getTime(), started.leaseUntil.getTime());
        assert.ok(worker!.leaseUntil.getTime() <= Date.now() + 1_000);
        assert.equal(worker!.expired, true);
      },
    },
    {
      name: "returns undefined for a stopped worker",
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

        assert.deepEqual(await stateAdapter.getWorkers({ workerIds: [worker.id] }), [undefined]);
      },
    },
    {
      name: "reports expired once the lease passes",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 200,
        });

        assert.equal((await stateAdapter.getWorkers({ workerIds: [workerId] }))[0]!.expired, false);

        await sleep(250);

        assert.equal((await stateAdapter.getWorkers({ workerIds: [workerId] }))[0]!.expired, true);
      },
    },
    {
      name: "lock: exclusive returns the workers inside a transaction",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const workerId = stateAdapter.config.generateWorkerId();
        const missingWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          typeNames: ["send-welcome-email"],
          concurrency: 2,
          leaseMs: 60_000,
        });

        const workers = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.getWorkers({
            txCtx,
            workerIds: [workerId, missingWorkerId],
            lock: "exclusive",
          }),
        );

        assert.deepEqual(
          workers.map((worker) =>
            worker
              ? {
                  id: worker.id,
                  typeNames: worker.typeNames,
                  concurrency: worker.concurrency,
                  expired: worker.expired,
                }
              : undefined,
          ),
          [
            { id: workerId, typeNames: ["send-welcome-email"], concurrency: 2, expired: false },
            undefined,
          ],
        );
      },
    },
    {
      name: "lock: exclusive blocks a concurrent locked read until the holding tx commits",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });

        const holderGate = Promise.withResolvers<void>();
        const lockHeld = Promise.withResolvers<void>();

        const holderTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getWorkers({ txCtx, workerIds: [workerId], lock: "exclusive" });
          lockHeld.resolve();
          await holderGate.promise;
        });

        await lockHeld.promise;

        const waiterTx = stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.getWorkers({ txCtx, workerIds: [workerId], lock: "exclusive" }),
        );

        assert.equal(
          await Promise.race([
            waiterTx.then(() => "resolved"),
            sleep(LOCK_BLOCK_OBSERVATION_MS).then(() => "waiting"),
          ]),
          "waiting",
        );

        holderGate.resolve();
        await holderTx;

        const [observed] = await waiterTx;
        assert.equal(observed!.id, workerId);
      },
    },
    {
      name: "reads a lease that ended during an open transaction as expired",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const workerId = stateAdapter.config.generateWorkerId();

        const worker = await stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.startWorker({
            txCtx,
            workerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 100,
          });
          await sleep(300);
          const [read] = await stateAdapter.getWorkers({ txCtx, workerIds: [workerId] });
          return read;
        });

        assert.equal(worker!.expired, true);
      },
    },
  ],
};
