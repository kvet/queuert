import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

/**
 * Verifies `close()` contract: idempotent, provider resources released.
 *
 * Each case constructs its own adapter-scoped context via the harness; closing
 * the adapter here does not interfere with other tests because vitest fixtures
 * are test-scoped.
 */
export const closeGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "close",
  cases: [
    {
      name: "close is idempotent",
      run: async ({ stateAdapter }) => {
        await stateAdapter.close();
        await stateAdapter.close();
      },
    },
  ],
};
