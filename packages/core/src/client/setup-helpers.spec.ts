import { describe, expect, test } from "vitest";

import { defineJobTypes } from "../job-types/define-job-types.ts";
import { createInProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";
import type { StateJob } from "../state-adapter/state-adapter.ts";
import { createHelpers } from "./setup-helpers.ts";

const unreadableJob = new Proxy({} as StateJob, {
  get: () => {
    throw new Error("payload read");
  },
});

describe("createHelpers", () => {
  test("drops observability events before reading their payloads when neither log nor observability adapter is configured", () => {
    const { observabilityHelper } = createHelpers({
      stateAdapter: createInProcessStateAdapter(),
      jobTypes: defineJobTypes<{ foo: { entry: true; input: null; output: null } }>(),
    });

    expect(() => {
      observabilityHelper.jobCreated(unreadableJob, { blockers: [] });
    }).not.toThrow();
  });

  test("builds observability event payloads when a log is configured", () => {
    const { observabilityHelper } = createHelpers({
      stateAdapter: createInProcessStateAdapter(),
      jobTypes: defineJobTypes<{ foo: { entry: true; input: null; output: null } }>(),
      log: () => {},
    });

    expect(() => {
      observabilityHelper.jobCreated(unreadableJob, { blockers: [] });
    }).toThrow("payload read");
  });
});
