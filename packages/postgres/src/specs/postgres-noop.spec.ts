import { type StateAdapter } from "queuert";
import {
  blockerSequencesTestSuite,
  deduplicationTestSuite,
  deferredStartTestSuite,
  deletionTestSuite,
  extendWithCommon,
  extendWithNoopNotify,
  processTestSuite,
  reaperTestSuite,
  sequencesTestSuite,
  stateResilienceTestSuite,
  waitSequenceCompletionTestSuite,
  workerlessCompletionTestSuite,
  workerTestSuite,
} from "queuert/testing";
import { extendWithPostgres } from "@queuert/testcontainers";
import { describe, it, TestAPI } from "vitest";
import { extendWithStatePostgres } from "./state-adapter.pg.spec-helper.js";

const postgresNoopIt = extendWithNoopNotify(
  extendWithCommon(
    extendWithStatePostgres(extendWithPostgres(it, import.meta.url)) as unknown as TestAPI<{
      stateAdapter: StateAdapter<{ $test: true }, string>;
      flakyStateAdapter: StateAdapter<{ $test: true }, string>;
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

describe("Deferred Start", () => {
  deferredStartTestSuite({ it: postgresNoopIt });
});
