import assert from "node:assert/strict";

import { caseBody, resource } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const getChainTypeNamesGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getChainTypeNames",
  cases: [
    {
      name: "getChainTypeNames returns empty array when no jobs exist",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const result = yield* step(stateAdapter.getChainTypeNames({}));
        assert.deepEqual(result, []);
      }),
    },
    {
      name: "getChainTypeNames returns distinct chain type names",
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

        const result = yield* step(stateAdapter.getChainTypeNames({}));
        assert.deepEqual(result.sort(), ["alpha", "mid", "zebra"]);
      }),
    },
    {
      name: "getChainTypeNames does not include continuation-only type names",
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

        const result = yield* step(stateAdapter.getChainTypeNames({}));
        assert.deepEqual(result, ["head-type"]);
      }),
    },
  ],
};
