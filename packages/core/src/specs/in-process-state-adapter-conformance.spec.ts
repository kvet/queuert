import { type StateAdapter } from "queuert";
import { describe, expect, it } from "vitest";

import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";
import { stateAdapterConformanceTestSuite } from "../suites/state-adapter-conformance.test-suite.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

it("index");

describe("In-Process State Adapter Conformance", () => {
  const conformanceIt = it.extend<{
    stateAdapter: StateAdapter<{ $test: true }, string>;
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
          (await createInProcessStateAdapter()) as unknown as StateAdapter<{ $test: true }, string>,
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

  conformanceIt("generates UUID job IDs", async ({ stateAdapter }) => {
    const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [{ id: stateAdapter.config.generateId(), typeName: "t", input: null }],
      }),
    );
    expect(UUID_PATTERN.test(stateChain.head.id)).toBe(true);
    expect(UUID_PATTERN.test(stateChain.head.chainId)).toBe(true);
  });

  conformanceIt("withSavepoint outside a transaction throws", async ({ stateAdapter }) => {
    await expect(
      stateAdapter.withSavepoint({} as { $test: true }, async () => {}),
    ).rejects.toThrow();
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});
