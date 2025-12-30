import { describe, it, TestAPI } from "vitest";
import { type StateAdapter } from "@queuert/core";
import {
  blockerSequencesTestSuite,
  extendWithCommon,
  extendWithInProcessNotify,
  notifyTestSuite,
  processTestSuite,
  reaperTestSuite,
  sequencesTestSuite,
  stateResilienceTestSuite,
  waitSequenceCompletionTestSuite,
  workerTestSuite,
  workerlessCompletionTestSuite,
} from "@queuert/core/testing";
import { extendWithStatePostgres } from "../state-adapter/state-adapter.pg.spec-helper.js";

const postgresInProcessIt = extendWithInProcessNotify(
  extendWithCommon(
    extendWithStatePostgres(it, import.meta.url) as unknown as TestAPI<{
      stateAdapter: StateAdapter<{ $test: true }>;
      flakyStateAdapter: StateAdapter<{ $test: true }>;
    }>,
  ),
);

describe("Process", () => {
  processTestSuite({ it: postgresInProcessIt });
});

describe("Worker", () => {
  workerTestSuite({ it: postgresInProcessIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: postgresInProcessIt });
});

describe("Sequences", () => {
  sequencesTestSuite({ it: postgresInProcessIt });
});

describe("Blocker Sequences", () => {
  blockerSequencesTestSuite({ it: postgresInProcessIt });
});

describe("Wait Sequence Completion", () => {
  waitSequenceCompletionTestSuite({ it: postgresInProcessIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: postgresInProcessIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: postgresInProcessIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: postgresInProcessIt });
});
