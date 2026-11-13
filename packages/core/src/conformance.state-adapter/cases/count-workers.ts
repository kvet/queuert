import assert from "node:assert/strict";

import { caseBody, resource } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const countWorkersGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "countWorkers",
  cases: [
    {
      name: "returns zeros when no worker has a row",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        assert.deepEqual(yield* step(stateAdapter.countWorkers({})), { live: 0, expired: 0 });
      }),
    },
    {
      name: "counts the workers with a live lease and the expired ones",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["reserve-stock"],
            concurrency: 3,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["ship-order"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["ship-order"],
            concurrency: 2,
            leaseMs: 0,
          }),
        );

        assert.deepEqual(yield* step(stateAdapter.countWorkers({})), { live: 2, expired: 1 });
      }),
    },
    {
      name: "does not count a stopped worker",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["capture-payment"],
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

        assert.deepEqual(yield* step(stateAdapter.countWorkers({})), { live: 0, expired: 0 });
      }),
    },
  ],
};
