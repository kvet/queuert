import { type StateAdapter } from "queuert";
import { describe, expect, it } from "vitest";

import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";
import { stateAdapterConformanceTestSuite } from "../suites/state-adapter-conformance.test-suite.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

it("index");

describe("In-Process State Adapter Conformance", () => {
  const conformanceIt = it.extend<{
    stateAdapter: StateAdapter<{ $test: true }, string>;
  }>({
    stateAdapter: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(
          (await createInProcessStateAdapter()) as unknown as StateAdapter<{ $test: true }, string>,
        );
      },
      { scope: "test" },
    ],
  });

  conformanceIt("generates UUID job IDs", async ({ stateAdapter }) => {
    const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [{ typeName: "t", chainTypeName: "t", input: null }],
      }),
    );
    expect(UUID_PATTERN.test(job.id)).toBe(true);
    expect(UUID_PATTERN.test(job.chainId)).toBe(true);
  });

  conformanceIt("withSavepoint outside a transaction throws", async ({ stateAdapter }) => {
    let threw = false;
    try {
      await stateAdapter.withSavepoint({} as { $test: true }, async () => {});
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt as any });
});
