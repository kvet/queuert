import type { ConformanceGroup } from "../runner.ts";
import type { StateAdapterConformanceContext } from "./types.ts";

/** The largest `countCap` the cases exercise: they create about twice that many jobs. */
const MAX_EXERCISED_COUNT_CAP = 50;

/**
 * Cases that check the counts stop at `config.countCap`. Run them against an adapter created with
 * a small `countCap`: at the default the cases would have to create over 20,000 jobs.
 */
export const countCapGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "countCap",
  cases: [
    {
      name: "countChainsByTypeName and countJobsByTypeName stop counting at config.countCap",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const { countCap } = stateAdapter.config;
        if (countCap > MAX_EXERCISED_COUNT_CAP) {
          expect.fail(
            `countCap is ${countCap}: run the countCap cases against an adapter created with countCap <= ${MAX_EXERCISED_COUNT_CAP}`,
          );
        }
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              ...Array.from({ length: countCap + 1 }, () => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "over-cap",
                input: null,
              })),
              ...Array.from({ length: countCap }, () => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "at-cap",
                input: null,
              })),
            ],
          }),
        );

        expect(
          await stateAdapter.countChainsByTypeName({ typeNames: ["over-cap", "at-cap"] }),
        ).toEqual([
          { running: { count: countCap, hasMore: true }, completed: { count: 0, hasMore: false } },
          { running: { count: countCap, hasMore: false }, completed: { count: 0, hasMore: false } },
        ]);

        const [over, at] = await stateAdapter.countJobsByTypeName({
          typeNames: ["over-cap", "at-cap"],
        });
        expect(over.pending).toEqual({ count: countCap, hasMore: true });
        expect(at.pending).toEqual({ count: countCap, hasMore: false });
      },
    },
  ],
};
