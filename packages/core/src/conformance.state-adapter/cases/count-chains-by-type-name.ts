import assert from "node:assert/strict";

import { dynamicSyncAsync, resource, step } from "@queuert/sync-async";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const countChainsByTypeNameGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "countChainsByTypeName",
  cases: [
    {
      name: "countChainsByTypeName returns empty array for empty input",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const result = yield* step(stateAdapter.countChainsByTypeName({ typeNames: [] }));
        assert.deepEqual(result, []);
      }),
    },
    {
      name: "countChainsByTypeName returns zeros for unknown type names",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const result = yield* step(
          stateAdapter.countChainsByTypeName({ typeNames: ["nonexistent"] }),
        );
        assert.deepEqual(result, [
          {
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
        ]);
      }),
    },
    {
      name: "countChainsByTypeName counts running chains",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "chain-count-a", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "chain-count-a", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "chain-count-b", input: null },
              ],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.countChainsByTypeName({
            typeNames: ["chain-count-a", "chain-count-b", "chain-count-c"],
          }),
        );

        assert.deepEqual(result, [
          { running: { count: 2, hasMore: false }, completed: { count: 0, hasMore: false } },
          { running: { count: 1, hasMore: false }, completed: { count: 0, hasMore: false } },
          { running: { count: 0, hasMore: false }, completed: { count: 0, hasMore: false } },
        ]);
      }),
    },
    {
      name: "countChainsByTypeName counts completed chains",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["chain-done"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "chain-done", input: null },
              ],
            }),
          ),
        );

        const [acquired] = yield* step(
          stateAdapter.startJobAttempts({
            batchLimits: { "chain-done": 1 },
            workerId: worker.id,
            workerToken: worker.token,
            limit: 1,
          }),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: acquired.id, output: null }],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.countChainsByTypeName({ typeNames: ["chain-done"] }),
        );

        assert.deepEqual(result, [
          { running: { count: 0, hasMore: false }, completed: { count: 1, hasMore: false } },
        ]);
      }),
    },
    {
      name: "countChainsByTypeName preserves input order",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "chain-z", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "chain-a", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "chain-a", input: null },
              ],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.countChainsByTypeName({
            typeNames: ["chain-z", "chain-a"],
          }),
        );

        assert.equal(result[0].running.count, 1);
        assert.equal(result[1].running.count, 2);
      }),
    },
  ],
};
