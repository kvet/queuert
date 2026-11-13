import assert from "node:assert/strict";

import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const isTransactionGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "isTransaction",
  cases: [
    {
      name: "reports true for a withTransaction context",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const result = yield* step(
          stateAdapter.withTransaction((txCtx) => stateAdapter.isTransaction(txCtx)),
        );
        assert.equal(result, true);
      }),
    },
    {
      name: "reports false for a context outside a transaction",
      run: caseBody(function* ({ createStateAdapter, ...context }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const result = yield* wait(
          context.withNonTransactionContext((txCtx) => stateAdapter.isTransaction(txCtx)),
        );
        assert.equal(result, false);
      }),
    },
  ],
};
