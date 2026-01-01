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
import { extendWithStateSqlite } from "../state-adapter/state-adapter.sqlite.spec-helper.js";

const sqliteInProcessIt = extendWithInProcessNotify(
  extendWithCommon(
    extendWithStateSqlite(it, import.meta.url) as unknown as TestAPI<{
      stateAdapter: StateAdapter<{ $test: true }>;
      flakyStateAdapter: StateAdapter<{ $test: true }>;
    }>,
  ),
);

describe("Process", () => {
  processTestSuite({ it: sqliteInProcessIt });
});

describe("Worker", () => {
  workerTestSuite({ it: sqliteInProcessIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: sqliteInProcessIt });
});

describe("Sequences", () => {
  sequencesTestSuite({ it: sqliteInProcessIt });
});

describe("Blocker Sequences", () => {
  blockerSequencesTestSuite({ it: sqliteInProcessIt });
});

describe("Wait Sequence Completion", () => {
  waitSequenceCompletionTestSuite({ it: sqliteInProcessIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: sqliteInProcessIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: sqliteInProcessIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: sqliteInProcessIt });
});
