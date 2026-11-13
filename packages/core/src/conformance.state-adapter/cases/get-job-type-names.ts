import assert from "node:assert/strict";

import { caseBody, resource } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const getJobTypeNamesGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getJobTypeNames",
  cases: [
    {
      name: "getJobTypeNames returns empty array when no jobs exist",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const result = yield* step(stateAdapter.getJobTypeNames({}));
        assert.deepEqual(result, []);
      }),
    },
    {
      name: "getJobTypeNames returns distinct type names",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "zebra", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "alpha", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "zebra", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "mid", input: null },
              ],
            }),
          ),
        );

        const result = yield* step(stateAdapter.getJobTypeNames({}));
        assert.deepEqual(result.sort(), ["alpha", "mid", "zebra"]);
      }),
    },
    {
      name: "getJobTypeNames includes continuation job type names",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "head-type", input: null },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "continuation-type",
                  continueFromId: headChain.head.id,
                  input: null,
                },
              ],
            }),
          ),
        );

        const result = yield* step(stateAdapter.getJobTypeNames({}));
        assert.deepEqual(result.sort(), ["continuation-type", "head-type"]);
      }),
    },
  ],
};
