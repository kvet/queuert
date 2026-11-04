import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const getJobTypeNamesGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "getJobTypeNames",
  cases: [
    {
      name: "getJobTypeNames returns empty array when no jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.getJobTypeNames({});
        expect(result).toEqual([]);
      },
    },
    {
      name: "getJobTypeNames returns distinct type names",
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

        const result = await stateAdapter.getJobTypeNames({});
        expect(result.sort()).toEqual(["alpha", "mid", "zebra"]);
      },
    },
    {
      name: "getJobTypeNames includes continuation job type names",
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

        const result = await stateAdapter.getJobTypeNames({});
        expect(result.sort()).toEqual(["continuation-type", "head-type"]);
      },
    },
  ],
};
