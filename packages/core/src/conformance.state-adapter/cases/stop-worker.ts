import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { sleep } from "@queuert/helpers/sleep";
import { step } from "@queuert/helpers/steps";

import { inTransaction } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const stopWorkerGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "stopWorker",
  cases: [
    {
      name: "deletes the row and returns the deleted worker",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const started = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["stop-a"],
            concurrency: 2,
            leaseMs: 60_000,
          }),
        );
        const otherWorker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );

        const stopped = yield* step(
          stateAdapter.stopWorker({
            workerId: started.id,
            workerToken: started.token,
          }),
        );

        assert.equal(stopped!.id, started.id);
        assert.deepEqual(stopped!.typeNames, ["stop-a"]);
        assert.equal(stopped!.concurrency, 2);
        assert.equal(stopped!.startedAt.getTime(), started.startedAt.getTime());
        assert.equal(
          yield* step(
            stateAdapter.extendWorkerLease({
              workerId: started.id,
              workerToken: started.token,
              leaseMs: 60_000,
            }),
          ),
          undefined,
        );
        assert.equal(
          (yield* step(
            stateAdapter.extendWorkerLease({
              workerId: otherWorker.id,
              workerToken: otherWorker.token,
              leaseMs: 60_000,
            }),
          ))!.id,
          otherWorker.id,
        );
      }),
    },
    {
      name: "leaves jobs running under the worker untouched",
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
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "stop-running", input: null },
              ],
            }),
          ),
        );
        const [claimed] = yield* step(
          stateAdapter.startJobAttempts({
            typeNames: ["stop-running"],
            workerId: worker.id,
            workerToken: worker.token,
            limit: 1,
          }),
        );

        yield* step(
          stateAdapter.stopWorker({
            workerId: worker.id,
            workerToken: worker.token,
          }),
        );

        const [stored] = yield* step(stateAdapter.getJobs({ jobIds: [claimed.id] }));
        assert.equal(stored!.status, "running");
        assert.equal(stored!.attemptBy, worker.id);
      }),
    },
    {
      name: "a missing worker stops to undefined",
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

        assert.equal(
          yield* step(
            stateAdapter.stopWorker({
              workerId: worker.id,
              workerToken: worker.token,
            }),
          ),
          undefined,
        );
        assert.equal(
          yield* step(
            stateAdapter.stopWorker({
              workerId: stateAdapter.config.generateWorkerId(),
              workerToken: crypto.randomUUID(),
            }),
          ),
          undefined,
        );
      }),
    },
    {
      name: "returns undefined for a stale registration and keeps the current row",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const workerId = stateAdapter.config.generateWorkerId();
        const staleRun = yield* step(
          stateAdapter.startWorker({
            workerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(stateAdapter.stopWorker({ workerId, workerToken: staleRun.token }));
        yield* wait(sleep(5));
        const currentRun = yield* step(
          stateAdapter.startWorker({
            workerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        assert.notEqual(currentRun.startedAt.getTime(), staleRun.startedAt.getTime());

        assert.equal(
          yield* step(
            stateAdapter.stopWorker({
              workerId,
              workerToken: staleRun.token,
            }),
          ),
          undefined,
        );
        const [stored] = yield* step(stateAdapter.getWorkers({ workerIds: [workerId] }));
        assert.equal(stored!.startedAt.getTime(), currentRun.startedAt.getTime());

        const stopped = yield* step(
          stateAdapter.stopWorker({
            workerId,
            workerToken: currentRun.token,
          }),
        );
        assert.equal(stopped!.id, workerId);
        assert.equal(stopped!.startedAt.getTime(), currentRun.startedAt.getTime());
        assert.deepEqual(yield* step(stateAdapter.getWorkers({ workerIds: [workerId] })), [
          undefined,
        ]);
      }),
    },
    {
      name: "a stop rolled back with its transaction restores the worker",
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
          assertRejects(
            () =>
              inTransaction(stateAdapter, function* (txCtx) {
                yield* step(
                  stateAdapter.stopWorker({
                    txCtx,
                    workerId: worker.id,
                    workerToken: worker.token,
                  }),
                );
                throw new Error("rollback");
              }),
            /rollback/,
          ),
        );

        assert.equal(
          (yield* step(
            stateAdapter.extendWorkerLease({
              workerId: worker.id,
              workerToken: worker.token,
              leaseMs: 60_000,
            }),
          ))!.id,
          worker.id,
        );
      }),
    },
  ],
};
