import { describe, it, TestAPI } from "vitest";
import { type StateAdapter } from "@queuert/core";
import {
  blockerSequencesTestSuite,
  deduplicationTestSuite,
  deletionTestSuite,
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
import { extendWithStatePostgres } from "../state-adapter/state-adapter.pg.spec-helper.js";

const postgresNoopIt = extendWithNoopNotify(
  extendWithCommon(
    extendWithStatePostgres(it, import.meta.url) as unknown as TestAPI<{
      stateAdapter: StateAdapter<{ $test: true }>;
      flakyStateAdapter: StateAdapter<{ $test: true }>;
    }>,
  ),
);

describe("Process", () => {
  processTestSuite({ it: postgresNoopIt });
});

describe("Worker", () => {
  workerTestSuite({ it: postgresNoopIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: postgresNoopIt });
});

describe("Sequences", () => {
  sequencesTestSuite({ it: postgresNoopIt });
});

describe("Blocker Sequences", () => {
  blockerSequencesTestSuite({ it: postgresNoopIt });
});

describe("Deduplication", () => {
  deduplicationTestSuite({ it: postgresNoopIt });
});

describe("Deletion", () => {
  deletionTestSuite({ it: postgresNoopIt });
});

describe("Wait Sequence Completion", () => {
  waitSequenceCompletionTestSuite({ it: postgresNoopIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: postgresNoopIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: postgresNoopIt });
});
