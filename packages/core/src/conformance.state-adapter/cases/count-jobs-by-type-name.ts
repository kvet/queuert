import assert from "node:assert/strict";

import { caseBody, resource } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const countJobsByTypeNameGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "countJobsByTypeName",
  cases: [
    {
      name: "countJobsByTypeName returns empty array for empty input",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const result = yield* step(stateAdapter.countJobsByTypeName({ typeNames: [] }));
        assert.deepEqual(result, []);
      }),
    },
    {
      name: "countJobsByTypeName returns zeros for unknown type names",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const result = yield* step(
          stateAdapter.countJobsByTypeName({ typeNames: ["nonexistent"] }),
        );
        assert.deepEqual(result, [
          {
            blocked: { count: 0, hasMore: false },
            pending: { count: 0, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
        ]);
      }),
    },
    {
      name: "countJobsByTypeName counts pending jobs",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "count-a", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "count-a", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "count-b", input: null },
              ],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.countJobsByTypeName({
            typeNames: ["count-a", "count-b", "count-c"],
          }),
        );

        assert.deepEqual(result, [
          {
            blocked: { count: 0, hasMore: false },
            pending: { count: 2, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
          {
            blocked: { count: 0, hasMore: false },
            pending: { count: 1, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
          {
            blocked: { count: 0, hasMore: false },
            pending: { count: 0, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
        ]);
      }),
    },
    {
      name: "countJobsByTypeName counts running jobs",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["count-run"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "count-run", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "count-run", input: null },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.startJobAttempts({
            typeNames: ["count-run"],
            workerId: worker.id,
            workerToken: worker.token,
            limit: 1,
          }),
        );

        const result = yield* step(stateAdapter.countJobsByTypeName({ typeNames: ["count-run"] }));

        assert.equal(result[0].pending.count, 1);
        assert.equal(result[0].running.count, 1);
      }),
    },
    {
      name: "countJobsByTypeName counts blocked jobs apart from pending ones",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain, blockedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "count-blocker", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "count-blocked", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "count-blocked", input: null },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: blockedChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.countJobsByTypeName({ typeNames: ["count-blocked"] }),
        );

        assert.equal(result[0].blocked.count, 1);
        assert.equal(result[0].pending.count, 1);
      }),
    },
    {
      name: "countJobsByTypeName counts completed jobs",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["count-done"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "count-done", input: null },
              ],
            }),
          ),
        );

        const [acquired] = yield* step(
          stateAdapter.startJobAttempts({
            typeNames: ["count-done"],
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

        const result = yield* step(stateAdapter.countJobsByTypeName({ typeNames: ["count-done"] }));

        assert.deepEqual(result, [
          {
            blocked: { count: 0, hasMore: false },
            pending: { count: 0, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 1, hasMore: false },
          },
        ]);
      }),
    },
    {
      name: "countJobsByTypeName preserves input order",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "count-z", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "count-a", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "count-a", input: null },
              ],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.countJobsByTypeName({
            typeNames: ["count-z", "count-a"],
          }),
        );

        assert.equal(result[0].pending.count, 1);
        assert.equal(result[1].pending.count, 2);
      }),
    },
  ],
};
