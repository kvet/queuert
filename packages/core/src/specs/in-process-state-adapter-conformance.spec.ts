import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { it as baseIt, describe, expect } from "vitest";

import {
  stateAdapterBaseGroups,
  stateAdapterCountCapGroups,
} from "../conformance.state-adapter/groups.ts";
import type { StateAdapterConformanceContext } from "../conformance.state-adapter/types.ts";
import {
  createInProcessStateAdapter,
  createSyncInProcessStateAdapter,
} from "../state-adapter.in-process/state-adapter.in-process.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const it = baseIt.extend(
  "conformance",
  { scope: "file" },
  async (): Promise<StateAdapterConformanceContext> => ({
    createStateAdapter: async () => createInProcessStateAdapter(),
    withNonTransactionContext: async (fn) => fn({ outsideTransaction: true }),
  }),
);

const syncIt = baseIt.extend(
  "conformance",
  { scope: "file" },
  async (): Promise<StateAdapterConformanceContext> => ({
    createStateAdapter: () => createSyncInProcessStateAdapter(),
    withNonTransactionContext: (fn) => fn({ outsideTransaction: true }),
  }),
);

const cappedIt = baseIt.extend(
  "conformance",
  { scope: "file" },
  async (): Promise<StateAdapterConformanceContext> => ({
    createStateAdapter: async () => createInProcessStateAdapter({ countCap: 3 }),
    withNonTransactionContext: async (fn) => fn({ outsideTransaction: true }),
  }),
);

it("index");

it("generates UUID job IDs", async ({ conformance: { createStateAdapter } }) => {
  const stateAdapter = await createStateAdapter();
  const [stateChain] = await stateAdapter.withTransaction((txCtx) =>
    stateAdapter.createJobs({
      txCtx,
      jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "t", input: null }],
    }),
  );
  expect(UUID_PATTERN.test(stateChain.head.id)).toBe(true);
  expect(UUID_PATTERN.test(stateChain.head.chainId)).toBe(true);
});

it("stamps every job of one createJobs call with the same createdAt", async ({
  conformance: { createStateAdapter },
}) => {
  const stateAdapter = await createStateAdapter();
  const chains = await stateAdapter.withTransaction((txCtx) =>
    stateAdapter.createJobs({
      txCtx,
      jobs: Array.from({ length: 5000 }, () => ({
        id: stateAdapter.config.generateJobId(),
        typeName: "t",
        input: null,
      })),
    }),
  );
  expect(new Set(chains.map((chain) => chain.head.createdAt.getTime())).size).toBe(1);
});

describe("In-Process State Adapter Conformance", () => {
  conformanceTestSuite({ it, groups: stateAdapterBaseGroups, mode: "async" });
});

describe("Sync In-Process State Adapter Conformance", () => {
  conformanceTestSuite({ it: syncIt, groups: stateAdapterBaseGroups, mode: "sync" });
});

describe("In-Process State Adapter Conformance - Count Cap", () => {
  conformanceTestSuite({
    it: cappedIt,
    groups: stateAdapterCountCapGroups,
    mode: "async",
  });
});
