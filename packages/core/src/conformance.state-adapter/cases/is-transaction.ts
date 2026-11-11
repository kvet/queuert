import assert from "node:assert/strict";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const isTransactionGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "isTransaction",
  cases: [
    {
      name: "reports true for a withTransaction context",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.isTransaction(txCtx),
        );
        assert.equal(result, true);
      },
    },
    {
      name: "reports false for a context outside a transaction",
      run: async ({ createStateAdapter, withNonTransactionContext }) => {
        await using stateAdapter = await createStateAdapter();

        const result = await withNonTransactionContext(async (txCtx) =>
          stateAdapter.isTransaction(txCtx),
        );
        assert.equal(result, false);
      },
    },
  ],
};
