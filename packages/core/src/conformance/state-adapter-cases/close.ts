import type { ConformanceGroup } from "../runner.ts";
import type { StateAdapterConformanceContext } from "./types.ts";

/** Verifies the `close()` contract on the case's own adapter. */
export const closeGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "close",
  cases: [
    {
      name: "close is idempotent",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        await stateAdapter.close();
        await stateAdapter.close();
      },
    },
  ],
};
