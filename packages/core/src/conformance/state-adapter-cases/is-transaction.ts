import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const isTransactionGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "isTransaction",
  cases: [
    {
      name: "reports true for a withTransaction context",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.isTransaction(txCtx),
        );
        expect(result).toBe(true);
      },
    },
    {
      name: "reports false for a context outside a transaction",
      run: async ({ stateAdapter, withNonTransactionContext }, expect) => {
        if (!withNonTransactionContext) {
          expect.skip("requires withNonTransactionContext");
          return;
        }
        const result = await withNonTransactionContext(async (txCtx) =>
          stateAdapter.isTransaction(txCtx),
        );
        expect(result).toBe(false);
      },
    },
  ],
};
