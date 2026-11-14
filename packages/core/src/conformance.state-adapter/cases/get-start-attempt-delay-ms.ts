import assert from "node:assert/strict";

import { dynamicSyncAsync, resource, step } from "@queuert/sync-async";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const getStartAttemptDelayMsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getStartAttemptDelayMs",
  cases: [
    {
      name: "returns 0 for an immediately available pending job",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "avail-test", input: null },
              ],
            }),
          ),
        );

        const ms = yield* step(stateAdapter.getStartAttemptDelayMs({ typeNames: ["avail-test"] }));
        assert.equal(ms!, 0);
      }),
    },
    {
      name: "returns milliseconds until next scheduled job",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "future-test",
                  input: null,
                  schedule: { afterMs: 5000 },
                },
              ],
            }),
          ),
        );

        const ms = yield* step(stateAdapter.getStartAttemptDelayMs({ typeNames: ["future-test"] }));
        assert.notEqual(ms, null);
        assert.ok(ms! > 3000);
        assert.ok(ms! <= 5100);
      }),
    },
    {
      name: "returns the full delay for a job scheduled 30 days ahead",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "far-future-test",
                  input: null,
                  schedule: { at: new Date(Date.now() + thirtyDaysMs) },
                },
              ],
            }),
          ),
        );

        const ms = yield* step(
          stateAdapter.getStartAttemptDelayMs({ typeNames: ["far-future-test"] }),
        );
        assert.equal(typeof ms, "number");
        assert.ok(ms! > thirtyDaysMs - 5000);
        assert.ok(ms! < thirtyDaysMs + 1000);
      }),
    },
    {
      name: "returns 0 when a ready-now job exists alongside a future-scheduled one",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "mixed-test", input: null },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "mixed-test",
                  input: null,
                  schedule: { afterMs: 5000 },
                },
              ],
            }),
          ),
        );

        const ms = yield* step(stateAdapter.getStartAttemptDelayMs({ typeNames: ["mixed-test"] }));
        assert.equal(ms!, 0);
      }),
    },
    {
      name: "returns null when no pending jobs of given type exist",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const ms = yield* step(
          stateAdapter.getStartAttemptDelayMs({
            typeNames: ["nonexistent-type"],
          }),
        );
        assert.equal(ms!, null);
      }),
    },
    {
      name: "returns null when the only job is blocked",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "delay-blocker", input: null },
              ],
            }),
          ),
        );

        const [blockedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "delay-blocked",
                  input: null,
                  schedule: { afterMs: 5000 },
                },
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

        const ms = yield* step(
          stateAdapter.getStartAttemptDelayMs({
            typeNames: ["delay-blocked"],
          }),
        );
        assert.equal(ms!, null);
      }),
    },
  ],
};

export const getStartAttemptDelayMsConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "getStartAttemptDelayMs",
    cases: [
      {
        name: "non-transactional getStartAttemptDelayMs does not observe an uncommitted insert",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const { promise: gate, resolve: release } = Promise.withResolvers<void>();
          const { promise: txReady, resolve: signalTxReady } = Promise.withResolvers<void>();

          const txPromise = stateAdapter
            .withTransaction(async (txCtx) => {
              await stateAdapter.createJobs({
                txCtx,
                jobs: [
                  {
                    id: stateAdapter.config.generateJobId(),
                    typeName: "iso-next",
                    input: null,
                    schedule: { afterMs: 5000 },
                  },
                ],
              });
              signalTxReady();
              await gate;
              throw new Error("rollback");
            })
            .catch(() => {});

          await txReady;
          const readPromise = stateAdapter.getStartAttemptDelayMs({ typeNames: ["iso-next"] });
          release();
          await txPromise;

          const observed = await readPromise;
          assert.equal(observed, null);
        },
      },
    ],
  };
