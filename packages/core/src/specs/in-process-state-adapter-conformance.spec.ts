import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { it as baseIt, describe, expect } from "vitest";

import {
  stateAdapterBaseGroups,
  stateAdapterCountCapGroups,
} from "../conformance.state-adapter/groups.ts";
import type { StateAdapterConformanceContext } from "../conformance.state-adapter/types.ts";
import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const it = baseIt.extend(
  "conformance",
  { scope: "file" },
  async (): Promise<StateAdapterConformanceContext> => ({
    createStateAdapter: async () => createInProcessStateAdapter(),
    withNonTransactionContext: async (fn) => fn({ inTransaction: false }),
  }),
);

const cappedIt = baseIt.extend(
  "conformance",
  { scope: "file" },
  async (): Promise<StateAdapterConformanceContext> => ({
    createStateAdapter: async () => createInProcessStateAdapter({ countCap: 3 }),
    withNonTransactionContext: async (fn) => fn({ inTransaction: false }),
  }),
);

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
