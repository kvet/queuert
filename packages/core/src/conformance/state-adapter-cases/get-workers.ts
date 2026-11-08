import { sleep } from "@queuert/helpers";

import type { ConformanceGroup } from "../runner.ts";
import type { StateConformanceFixture } from "./types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const getWorkersGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "getWorkers",
  cases: [
    {
      name: "returns an empty array for empty ids",
      run: async ({ stateAdapter }, expect) => {
        expect(await stateAdapter.getWorkers({ workerIds: [] })).toEqual([]);
      },
    },
    {
      name: "returns undefined for an unknown id",
      run: async ({ stateAdapter }, expect) => {
        expect(
          await stateAdapter.getWorkers({ workerIds: [stateAdapter.config.generateWorkerId()] }),
        ).toEqual([undefined]);
      },
    },
    {
      name: "returns workers in input order with their type names and concurrency",
      run: async ({ stateAdapter }, expect) => {
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

        expect(
          workers.map((worker) =>
            worker
              ? {
                  id: worker.id,
                  typeNames: worker.typeNames,
                  concurrency: worker.concurrency,
                }
              : undefined,
          ),
        ).toEqual([
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
        ]);
        expect(workers[0]!.startedAt).toBeInstanceOf(Date);
        expect(workers[0]!.leaseUntil).toBeInstanceOf(Date);
        expect(workers[0]!.expired).toBe(false);
      },
    },
    {
      name: "returns an unreclaimed worker whose lease is no longer live, with its leaseUntil",
      run: async ({ stateAdapter }, expect) => {
        const started = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: [],
          concurrency: 1,
          leaseMs: 0,
        });

        const [worker] = await stateAdapter.getWorkers({ workerIds: [started.id] });

        expect(worker!.leaseUntil.getTime()).toBe(started.leaseUntil.getTime());
        expect(worker!.leaseUntil.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
        expect(worker!.expired).toBe(true);
      },
    },
    {
      name: "returns undefined for a stopped worker",
      run: async ({ stateAdapter }, expect) => {
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

        expect(await stateAdapter.getWorkers({ workerIds: [worker.id] })).toEqual([undefined]);
      },
    },
    {
      name: "reports expired once the lease passes",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 200,
        });

        expect((await stateAdapter.getWorkers({ workerIds: [workerId] }))[0]!.expired).toBe(false);

        await sleep(250);

        expect((await stateAdapter.getWorkers({ workerIds: [workerId] }))[0]!.expired).toBe(true);
      },
    },
    {
      name: "lock: exclusive returns the workers inside a transaction",
      run: async ({ stateAdapter }, expect) => {
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

        expect(
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
        ).toEqual([
          { id: workerId, typeNames: ["send-welcome-email"], concurrency: 2, expired: false },
          undefined,
        ]);
      },
    },
    {
      name: "lock: exclusive blocks a concurrent locked read until the holding tx commits",
      run: async ({ stateAdapter }, expect) => {
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

        expect(
          await Promise.race([
            waiterTx.then(() => "resolved"),
            sleep(LOCK_BLOCK_OBSERVATION_MS).then(() => "waiting"),
          ]),
        ).toBe("waiting");

        holderGate.resolve();
        await holderTx;

        const [observed] = await waiterTx;
        expect(observed!.id).toBe(workerId);
      },
    },
    {
      name: "reads a lease that ended during an open transaction as expired",
      run: async ({ stateAdapter }, expect) => {
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

        expect(worker!.expired).toBe(true);
      },
    },
  ],
};
