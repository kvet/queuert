import { type StateAdapter } from "queuert";
import { stateAdapterConformanceTestSuite } from "../suites/state-adapter-conformance.test-suite.js";
import { describe, it } from "vitest";
import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

it("index");

describe("In-Process State Adapter Conformance", () => {
  const conformanceIt = it.extend<{
    stateAdapter: StateAdapter<{ $test: true }, string>;
    validateId: (id: string) => boolean;
  }>({
    stateAdapter: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(
          createInProcessStateAdapter() as unknown as StateAdapter<{ $test: true }, string>,
        );
      },
      { scope: "test" },
    ],
    validateId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use((id: string) => UUID_PATTERN.test(id)),
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt as any });
});
