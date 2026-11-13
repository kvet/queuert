import { caseBody, resource } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

/** Verifies the `close()` contract on the case's own adapter. */
export const closeGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "close",
  cases: [
    {
      name: "close is idempotent",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        yield* step(stateAdapter.close());
        yield* step(stateAdapter.close());
      }),
    },
  ],
};
