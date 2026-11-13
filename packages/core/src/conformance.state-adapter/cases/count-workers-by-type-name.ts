import assert from "node:assert/strict";

import { caseBody, resource } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const countWorkersByTypeNameGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "countWorkersByTypeName",
  cases: [
    {
      name: "returns an empty array for empty type names",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        assert.deepEqual(yield* step(stateAdapter.countWorkersByTypeName({ typeNames: [] })), []);
      }),
    },
    {
      name: "counts the workers processing each type, in input order",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["send-welcome-email", "sync-to-crm"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["sync-to-crm"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );

        assert.deepEqual(
          yield* step(
            stateAdapter.countWorkersByTypeName({
              typeNames: ["sync-to-crm", "ship-order", "send-welcome-email"],
            }),
          ),
          [
            { live: 2, expired: 0 },
            { live: 0, expired: 0 },
            { live: 1, expired: 0 },
          ],
        );
      }),
    },
    {
      name: "counts a worker whose lease is no longer live as expired",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["render-invoice-pdf"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["render-invoice-pdf"],
            concurrency: 1,
            leaseMs: 0,
          }),
        );

        assert.deepEqual(
          yield* step(stateAdapter.countWorkersByTypeName({ typeNames: ["render-invoice-pdf"] })),
          [{ live: 1, expired: 1 }],
        );
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

        assert.deepEqual(
          yield* step(stateAdapter.countWorkersByTypeName({ typeNames: ["capture-payment"] })),
          [{ live: 0, expired: 0 }],
        );
      }),
    },
  ],
};
