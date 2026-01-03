import { type StateAdapter } from "@queuert/core";
import {
  blockerSequencesTestSuite,
  extendWithCommon,
  extendWithNoopNotify,
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

const sqliteNoopIt = extendWithNoopNotify(
  extendWithCommon(
    extendWithStateSqlite(it) as unknown as TestAPI<{
      stateAdapter: StateAdapter<{ $test: true }, string>;
      flakyStateAdapter: StateAdapter<{ $test: true }, string>;
    }>,
  ),
);

describe("Process", () => {
  processTestSuite({ it: sqliteNoopIt });
});

describe("Worker", () => {
  workerTestSuite({ it: sqliteNoopIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: sqliteNoopIt });
});

describe("Sequences", () => {
  sequencesTestSuite({ it: sqliteNoopIt });
});

describe("Blocker Sequences", () => {
  blockerSequencesTestSuite({ it: sqliteNoopIt });
});

describe("Wait Sequence Completion", () => {
  waitSequenceCompletionTestSuite({ it: sqliteNoopIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: sqliteNoopIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: sqliteNoopIt });
});
