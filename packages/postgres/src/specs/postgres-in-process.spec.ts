import { type StateAdapter } from "queuert";
import {
  blockerSequencesTestSuite,
  deferredStartTestSuite,
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
} from "queuert/testing";
import { extendWithPostgres } from "@queuert/testcontainers";
import { describe, it, TestAPI } from "vitest";
import { extendWithStatePostgres } from "./state-adapter.pg.spec-helper.js";

const postgresInProcessIt = extendWithInProcessNotify(
  extendWithCommon(
    extendWithStatePostgres(extendWithPostgres(it, import.meta.url)) as unknown as TestAPI<{
      stateAdapter: StateAdapter<{ $test: true }, string>;
      flakyStateAdapter: StateAdapter<{ $test: true }, string>;
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

describe("Deferred Start", () => {
  deferredStartTestSuite({ it: postgresInProcessIt });
});
