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
  workerlessCompletionTestSuite,
  workerTestSuite,
} from "@queuert/core/testing";
import { describe, it, TestAPI } from "vitest";
import { extendWithStateSqlite } from "../state-adapter/state-adapter.sqlite.spec-helper.js";

const sqliteInProcessIt = extendWithInProcessNotify(
  extendWithCommon(
    extendWithStateSqlite(it) as unknown as TestAPI<{
      stateAdapter: StateAdapter<{ $test: true }, string>;
      flakyStateAdapter: StateAdapter<{ $test: true }, string>;
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
