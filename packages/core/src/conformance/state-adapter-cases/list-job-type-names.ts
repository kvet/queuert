import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const listJobTypeNamesGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "listJobTypeNames",
  cases: [
    {
      name: "listJobTypeNames returns empty array when no jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.listJobTypeNames({});
        expect(result).toEqual([]);
      },
    },
    {
      name: "listJobTypeNames returns distinct type names",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              { typeName: "zebra", input: null },
              { typeName: "alpha", input: null },
              { typeName: "zebra", input: null },
              { typeName: "mid", input: null },
            ],
          }),
        );

        const result = await stateAdapter.listJobTypeNames({});
        expect(result.sort()).toEqual(["alpha", "mid", "zebra"]);
      },
    },
    {
      name: "listJobTypeNames includes continuation job type names",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "root-type", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: { typeName: "cont-type", continueFromId: root.id, input: null },
          }),
        );

        const result = await stateAdapter.listJobTypeNames({});
        expect(result.sort()).toEqual(["cont-type", "root-type"]);
      },
    },
  ],
};
