import { type ConformanceGroup } from "../runner.js";
import { transaction } from "../transaction.js";
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
        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "zebra", input: null },
              { id: stateAdapter.config.generateId(), typeName: "alpha", input: null },
              { id: stateAdapter.config.generateId(), typeName: "zebra", input: null },
              { id: stateAdapter.config.generateId(), typeName: "mid", input: null },
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
        const [headChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "head-type", input: null }],
          }),
        );

        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "continuation-type",
                continueFromId: headChain.head.id,
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listJobTypeNames({});
        expect(result.sort()).toEqual(["continuation-type", "head-type"]);
      },
    },
  ],
};
