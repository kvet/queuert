import assert from "node:assert/strict";

import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { sleep } from "@queuert/helpers/sleep";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const getWorkersGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getWorkers",
  cases: [
    {
      name: "returns an empty array for empty ids",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        assert.deepEqual(yield* step(stateAdapter.getWorkers({ workerIds: [] })), []);
      }),
    },
    {
      name: "returns undefined for an unknown id",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        assert.deepEqual(
          yield* step(
            stateAdapter.getWorkers({ workerIds: [stateAdapter.config.generateWorkerId()] }),
          ),
          [undefined],
        );
      }),
    },
    {
      name: "returns workers in input order with their type names and concurrency",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const firstWorkerId = stateAdapter.config.generateWorkerId();
        const secondWorkerId = stateAdapter.config.generateWorkerId();
        const missingWorkerId = stateAdapter.config.generateWorkerId();
        yield* step(
          stateAdapter.startWorker({
            workerId: firstWorkerId,
            typeNames: ["send-welcome-email"],
            concurrency: 2,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.startWorker({
            workerId: secondWorkerId,
            typeNames: ["sync-to-crm", "render-invoice-pdf"],
            concurrency: 5,
            leaseMs: 60_000,
          }),
        );

        const workers = yield* step(
          stateAdapter.getWorkers({
            workerIds: [secondWorkerId, missingWorkerId, firstWorkerId],
          }),
        );

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
      }),
    },
    {
      name: "returns an unreclaimed worker whose lease is no longer live, with its leaseUntil",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const started = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: [],
            concurrency: 1,
            leaseMs: 0,
          }),
        );

        const [worker] = yield* step(stateAdapter.getWorkers({ workerIds: [started.id] }));

        assert.equal(worker!.leaseUntil.getTime(), started.leaseUntil.getTime());
        assert.ok(worker!.leaseUntil.getTime() <= Date.now() + 1_000);
        assert.equal(worker!.expired, true);
      }),
    },
    {
      name: "returns undefined for a stopped worker",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.stopWorker({
            workerId: worker.id,
            workerToken: worker.token,
          }),
        );

        assert.deepEqual(yield* step(stateAdapter.getWorkers({ workerIds: [worker.id] })), [
          undefined,
        ]);
      }),
    },
    {
      name: "reports expired once the lease passes",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const workerId = stateAdapter.config.generateWorkerId();
        yield* step(
          stateAdapter.startWorker({
            workerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 200,
          }),
        );

        assert.equal(
          (yield* step(stateAdapter.getWorkers({ workerIds: [workerId] })))[0]!.expired,
          false,
        );

        yield* wait(sleep(250));

        assert.equal(
          (yield* step(stateAdapter.getWorkers({ workerIds: [workerId] })))[0]!.expired,
          true,
        );
      }),
    },
    {
      name: "lock: exclusive returns the workers inside a transaction",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const workerId = stateAdapter.config.generateWorkerId();
        const missingWorkerId = stateAdapter.config.generateWorkerId();
        yield* step(
          stateAdapter.startWorker({
            workerId,
            typeNames: ["send-welcome-email"],
            concurrency: 2,
            leaseMs: 60_000,
          }),
        );

        const workers = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.getWorkers({
              txCtx,
              workerIds: [workerId, missingWorkerId],
              lock: "exclusive",
            }),
          ),
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
      }),
    },
  ],
};

export const getWorkersHeldTransactionGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getWorkers",
  cases: [
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

        const waiterTx = Promise.resolve(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.getWorkers({ txCtx, workerIds: [workerId], lock: "exclusive" }),
          ),
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
  ],
};
