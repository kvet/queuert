import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

export const getLatestChainJobForUpdateGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getLatestChainJobForUpdate",
  cases: [
    {
      name: "returns the latest job in a chain via getLatestChainJobForUpdate",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: rootJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-current",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "chain-current",
                input: null,
              },
            ],
          }),
        );

        const [{ job: continuation }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-current-step2",
                chainId: rootJob.chainId,
                chainIndex: 1,
                chainTypeName: "chain-current",
                input: null,
              },
            ],
          }),
        );

        const current = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.getLatestChainJobForUpdate({ txCtx, chainId: rootJob.chainId }),
        );

        expect(current).toBeDefined();
        expect(current!.id).toBe(continuation.id);
      },
    },
    {
      name: "returns undefined for nonexistent chain via getLatestChainJobForUpdate",
      run: async ({ stateAdapter }, expect) => {
        const current = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.getLatestChainJobForUpdate({ txCtx, chainId: crypto.randomUUID() }),
        );

        expect(current).toBeUndefined();
      },
    },
  ],
};
