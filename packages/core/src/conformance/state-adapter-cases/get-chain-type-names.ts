import type { ConformanceGroup } from "../runner.ts";
import type { StateConformanceFixture } from "./types.ts";

export const getChainTypeNamesGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "getChainTypeNames",
  cases: [
    {
      name: "getChainTypeNames returns empty array when no jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.getChainTypeNames({});
        expect(result).toEqual([]);
      },
    },
    {
      name: "getChainTypeNames returns distinct chain type names",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "zebra", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "alpha", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "zebra", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "mid", input: null },
            ],
          }),
        );

        const result = await stateAdapter.getChainTypeNames({});
        expect(result.sort()).toEqual(["alpha", "mid", "zebra"]);
      },
    },
    {
      name: "getChainTypeNames does not include continuation-only type names",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "head-type", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
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
        );

        const result = await stateAdapter.getChainTypeNames({});
        expect(result).toEqual(["head-type"]);
      },
    },
  ],
};
