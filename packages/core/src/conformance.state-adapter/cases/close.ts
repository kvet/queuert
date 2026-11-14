import { dynamicSyncAsync, resource, step } from "@queuert/sync-async";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const closeGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "close",
  cases: [
    {
      name: "close is idempotent",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        yield* step(stateAdapter.close());
        yield* step(stateAdapter.close());
      }),
    },
  ],
};
