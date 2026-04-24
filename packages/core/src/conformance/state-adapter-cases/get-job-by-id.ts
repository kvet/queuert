import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

export const getJobByIdGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getJobById",
  cases: [
    {
      name: "returns undefined for nonexistent job ID",
      run: async ({ stateAdapter }, expect) => {
        // Create a real job to get a valid ID format, then look up a derived nonexistent one
        const [{ job: real }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "lookup-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "lookup-test",
                input: null,
              },
            ],
          }),
        );
        const nonexistentId = real.id.slice(0, -1) + (real.id.endsWith("0") ? "1" : "0");
        const job = await stateAdapter.getJobById({ jobId: nonexistentId });
        expect(job).toBeUndefined();
      },
    },
  ],
};
