import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const getNextJobAvailableInMsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "getNextJobAvailableInMs",
  cases: [
    {
      name: "returns 0 for immediately available pending job",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "avail-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "avail-test",
                input: null,
              },
            ],
          }),
        );

        const ms = await stateAdapter.getNextJobAvailableInMs({ typeNames: ["avail-test"] });
        expect(ms).toBe(0);
      },
    },
    {
      name: "returns milliseconds until next scheduled job",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "future-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "future-test",
                input: null,
                schedule: { afterMs: 5000 },
              },
            ],
          }),
        );

        const ms = await stateAdapter.getNextJobAvailableInMs({ typeNames: ["future-test"] });
        expect(ms).not.toBeNull();
        expect(ms!).toBeGreaterThan(3000);
        expect(ms!).toBeLessThanOrEqual(5100);
      },
    },
    {
      name: "returns null when no pending jobs of given type exist",
      run: async ({ stateAdapter }, expect) => {
        const ms = await stateAdapter.getNextJobAvailableInMs({
          typeNames: ["nonexistent-type"],
        });
        expect(ms).toBeNull();
      },
    },
  ],
};
