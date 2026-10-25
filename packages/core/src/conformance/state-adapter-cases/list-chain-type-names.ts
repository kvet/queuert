import { type ConformanceGroup } from "../runner.js";
import { transaction } from "../transaction.js";
import { type StateConformanceFixture } from "./types.js";

export const listChainTypeNamesGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "listChainTypeNames",
  cases: [
    {
      name: "listChainTypeNames returns empty array when no jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.listChainTypeNames({});
        expect(result).toEqual([]);
      },
    },
    {
      name: "listChainTypeNames returns distinct chain type names",
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

        const result = await stateAdapter.listChainTypeNames({});
        expect(result.sort()).toEqual(["alpha", "mid", "zebra"]);
      },
    },
    {
      name: "listChainTypeNames does not include continuation-only type names",
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

        const result = await stateAdapter.listChainTypeNames({});
        expect(result).toEqual(["head-type"]);
      },
    },
  ],
};
