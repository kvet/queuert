import assert from "node:assert/strict";

import { caseBody, resource } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const getStartAttemptDelayMsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getStartAttemptDelayMs",
  cases: [
    {
      name: "returns 0 for an immediately available pending job",
      run: caseBody(function* ({ createStateAdapter }) {
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
      run: caseBody(function* ({ createStateAdapter }) {
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
      run: caseBody(function* ({ createStateAdapter }) {
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
      run: caseBody(function* ({ createStateAdapter }) {
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
      run: caseBody(function* ({ createStateAdapter }) {
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
      run: caseBody(function* ({ createStateAdapter }) {
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

          let release: (() => void) | undefined;
          const gate = new Promise<void>((r) => {
            release = r;
          });
          let signalTxReady: (() => void) | undefined;
          const txReady = new Promise<void>((r) => {
            signalTxReady = r;
          });

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
              signalTxReady!();
              await gate;
              throw new Error("rollback");
            })
            .catch(() => {});

          await txReady;
          const readPromise = stateAdapter.getStartAttemptDelayMs({ typeNames: ["iso-next"] });
          release!();
          await txPromise;

          const observed = await readPromise;
          assert.equal(observed, null);
        },
      },
    ],
  };
