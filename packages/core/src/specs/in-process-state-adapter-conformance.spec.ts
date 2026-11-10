import { it as baseIt, describe, expect } from "vitest";

import {
  stateAdapterBaseGroups,
  stateAdapterCountCapGroups,
} from "../conformance/state-adapter-cases.ts";
import type { StateAdapterConformanceContext } from "../conformance/state-adapter-cases/types.ts";
import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.ts";
import {
  type ConformanceFixtures,
  conformanceTestSuite,
} from "../suites/conformance.test-suite.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const extendWithInProcessConformance = (options: { countCap?: number } = {}) =>
  baseIt.extend<ConformanceFixtures<StateAdapterConformanceContext>>({
    conformance: [
      // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
      async ({}, use) => {
        await use({
          createStateAdapter: async () => createInProcessStateAdapter(options),
          withNonTransactionContext: async (fn) => fn({}),
        });
      },
      { scope: "file" },
    ],
  });

const it = extendWithInProcessConformance();
const cappedIt = extendWithInProcessConformance({ countCap: 3 });

it("index");

it("generates UUID job IDs", async ({ conformance: { createStateAdapter } }) => {
  const stateAdapter = await createStateAdapter();
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

describe("In-Process State Adapter Conformance - Count Cap", () => {
  conformanceTestSuite({
    it: cappedIt,
    groups: stateAdapterCountCapGroups,
  });
});
