import { it as baseIt, describe, expect } from "vitest";

import { stateAdapterBaseGroups } from "../conformance/state-adapter-cases.ts";
import type { StateConformanceFixture } from "../conformance/state-adapter-cases/types.ts";
import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.ts";
import {
  type ConformanceFixtures,
  conformanceTestSuite,
} from "../suites/conformance.test-suite.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const it = baseIt.extend<ConformanceFixtures<StateConformanceFixture>>({
  conformance: [
    // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
    async ({}, use) => {
      let current = createInProcessStateAdapter();
      await use({
        stateAdapter: new Proxy(current, {
          get: (_target, key) => Reflect.get(current, key),
        }),
        withNonTransactionContext: async (fn) => fn({}),
        reset: async () => {
          current = createInProcessStateAdapter();
        },
      });
    },
    { scope: "file" },
  ],
});

it("index");

it("generates UUID job IDs", async ({ conformance: { stateAdapter } }) => {
  const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.createJobs({
      txCtx,
      jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "t", input: null }],
    }),
  );
  expect(UUID_PATTERN.test(stateChain.head.id)).toBe(true);
  expect(UUID_PATTERN.test(stateChain.head.chainId)).toBe(true);
});

describe("In-Process State Adapter Conformance", () => {
  conformanceTestSuite({ it, groups: stateAdapterBaseGroups });
});
