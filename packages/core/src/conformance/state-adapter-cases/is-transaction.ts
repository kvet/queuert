import type { ConformanceGroup } from "../runner.ts";
import type { StateAdapterConformanceContext } from "./types.ts";

export const isTransactionGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "isTransaction",
  cases: [
    {
      name: "reports true for a withTransaction context",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.isTransaction(txCtx),
        );
        expect(result).toBe(true);
      },
    },
    {
      name: "reports false for a context outside a transaction",
      run: async ({ createStateAdapter, withNonTransactionContext }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const result = await withNonTransactionContext(async (txCtx) =>
          stateAdapter.isTransaction(txCtx),
        );
        expect(result).toBe(false);
      },
    },
  ],
};
