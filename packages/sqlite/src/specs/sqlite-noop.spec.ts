import { describe, it, TestAPI } from "vitest";
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
  workerTestSuite,
  workerlessCompletionTestSuite,
} from "@queuert/core/testing";
import { extendWithStateSqlite } from "../state-adapter/state-adapter.sqlite.spec-helper.js";

const sqliteNoopIt = extendWithNoopNotify(
  extendWithCommon(
    extendWithStateSqlite(it, import.meta.url) as unknown as TestAPI<{
      stateAdapter: StateAdapter<{ $test: true }>;
      flakyStateAdapter: StateAdapter<{ $test: true }>;
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
