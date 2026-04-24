import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

export const getJobForUpdateGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getJobForUpdate",
  cases: [
    {
      name: "returns job by ID via getJobForUpdate",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "update-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "update-test",
                input: { value: 1 },
              },
            ],
          }),
        );

        const retrieved = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.getJobForUpdate({ txCtx, jobId: created.id }),
        );

        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe(created.id);
        expect(retrieved!.input).toEqual({ value: 1 });
      },
    },
    {
      name: "returns undefined for nonexistent job via getJobForUpdate",
      run: async ({ stateAdapter }, expect) => {
        const retrieved = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.getJobForUpdate({ txCtx, jobId: crypto.randomUUID() }),
        );

        expect(retrieved).toBeUndefined();
      },
    },
  ],
};
