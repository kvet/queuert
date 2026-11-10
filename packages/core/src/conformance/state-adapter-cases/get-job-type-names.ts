import type { ConformanceGroup } from "../runner.ts";
import type { StateAdapterConformanceContext } from "./types.ts";

export const getJobTypeNamesGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getJobTypeNames",
  cases: [
    {
      name: "getJobTypeNames returns empty array when no jobs exist",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const result = await stateAdapter.getJobTypeNames({});
        expect(result).toEqual([]);
      },
    },
    {
      name: "getJobTypeNames returns distinct type names",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

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
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

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
