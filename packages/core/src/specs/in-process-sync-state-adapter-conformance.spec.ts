import { type StateAdapter } from "queuert";
import { describe, it } from "vitest";

import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";
import { stateAdapterConformanceTestSuite } from "../suites/state-adapter-conformance.test-suite.js";

it("index");

describe("In-Process State Adapter Conformance (sync mode)", () => {
  const conformanceIt = it.extend<{
    stateAdapter: StateAdapter<{ $test: true }, string, "sync">;
    transactionConcurrency: "concurrent" | "serialized";
    withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
  }>({
    transactionConcurrency: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use("serialized");
      },
      { scope: "test" },
    ],
    stateAdapter: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(
          createInProcessStateAdapter({ mode: "sync" }) as unknown as StateAdapter<
            { $test: true },
            string,
            "sync"
          >,
        );
      },
      { scope: "test" },
    ],
    withNonTransactionContext: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(async (fn) => fn({} as { $test: true }));
      },
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});
