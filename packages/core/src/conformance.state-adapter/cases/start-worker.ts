import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { sleep } from "@queuert/helpers/sleep";
import { step } from "@queuert/helpers/steps";

import { inTransaction } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const startWorkerGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "startWorker",
  cases: [
    {
      name: "config.generateWorkerId produces unique ids that pass config.validateWorkerId",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const ids = Array.from({ length: 10 }, () => stateAdapter.config.generateWorkerId());
        assert.equal(new Set(ids).size, ids.length);
        for (const id of ids) {
          assert.equal(stateAdapter.config.validateWorkerId(id), true);
        }
      }),
    },
    {
      name: "starts a worker with a lease leaseMs from now",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const workerId = stateAdapter.config.generateWorkerId();
        const before = Date.now();
        const worker = yield* step(
          stateAdapter.startWorker({
            workerId,
            typeNames: ["send-welcome-email", "sync-to-crm"],
            concurrency: 4,
            leaseMs: 60_000,
          }),
        );
        const after = Date.now();

        assert.equal(worker.id, workerId);
        assert.deepEqual(worker.typeNames, ["send-welcome-email", "sync-to-crm"]);
        assert.equal(worker.concurrency, 4);
        assert.ok(worker.startedAt instanceof Date);
        assert.equal(typeof worker.token, "string");
        assert.ok(worker.startedAt.getTime() >= before - 1_000);
        assert.ok(worker.startedAt.getTime() <= after + 1_000);
        assert.ok(worker.leaseUntil.getTime() >= before + 60_000 - 1_000);
        assert.ok(worker.leaseUntil.getTime() <= after + 60_000 + 1_000);
      }),
    },
    {
      name: "rejects a worker id that already has a row, even one whose lease expired",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const workerId = stateAdapter.config.generateWorkerId();
        const worker = yield* step(
          stateAdapter.startWorker({
            workerId,
            typeNames: ["send-welcome-email"],
            concurrency: 1,
            leaseMs: 1,
          }),
        );
        yield* wait(sleep(20));

        yield* step(
          assertRejects(() =>
            stateAdapter.startWorker({
              workerId,
              typeNames: ["sync-to-crm"],
              concurrency: 2,
              leaseMs: 60_000,
            }),
          ),
        );

        const stopped = yield* step(
          stateAdapter.stopWorker({
            workerId,
            workerToken: worker.token,
          }),
        );
        assert.deepEqual(stopped!.typeNames, ["send-welcome-email"]);
        assert.equal(stopped!.concurrency, 1);
      }),
    },
    {
      name: "a worker started in a rolled-back transaction does not exist",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const workerId = stateAdapter.config.generateWorkerId();

        yield* step(
          assertRejects(
            () =>
              inTransaction(stateAdapter, function* (txCtx) {
                yield* step(
                  stateAdapter.startWorker({
                    txCtx,
                    workerId,
                    typeNames: [],
                    concurrency: 1,
                    leaseMs: 60_000,
                  }),
                );
                throw new Error("rollback");
              }),
            /rollback/,
          ),
        );

        assert.equal(
          yield* step(
            stateAdapter.extendWorkerLease({
              workerId,
              workerToken: crypto.randomUUID(),
              leaseMs: 60_000,
            }),
          ),
          undefined,
        );
      }),
    },
  ],
};
