import assert from "node:assert/strict";

import { dynamicSyncAsync, resource, step } from "@queuert/sync-async";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

const MAX_EXERCISED_COUNT_CAP = 50;

export const countCapGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "countCap",
  cases: [
    {
      name: "countChainsByTypeName and countJobsByTypeName stop counting at config.countCap",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const { countCap } = stateAdapter.config;
        if (countCap > MAX_EXERCISED_COUNT_CAP) {
          throw new Error(
            `countCap is ${countCap}: run the countCap cases against an adapter created with countCap <= ${MAX_EXERCISED_COUNT_CAP}`,
          );
        }
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                ...Array.from({ length: countCap + 1 }, () => ({
                  id: stateAdapter.config.generateJobId(),
                  typeName: "over-cap",
                  input: null,
                })),
                ...Array.from({ length: countCap }, () => ({
                  id: stateAdapter.config.generateJobId(),
                  typeName: "at-cap",
                  input: null,
                })),
              ],
            }),
          ),
        );

        assert.deepEqual(
          yield* step(stateAdapter.countChainsByTypeName({ typeNames: ["over-cap", "at-cap"] })),
          [
            {
              running: { count: countCap, hasMore: true },
              completed: { count: 0, hasMore: false },
            },
            {
              running: { count: countCap, hasMore: false },
              completed: { count: 0, hasMore: false },
            },
          ],
        );

        const [over, at] = yield* step(
          stateAdapter.countJobsByTypeName({
            typeNames: ["over-cap", "at-cap"],
          }),
        );
        assert.deepEqual(over.pending, { count: countCap, hasMore: true });
        assert.deepEqual(at.pending, { count: countCap, hasMore: false });
      }),
    },
  ],
};
