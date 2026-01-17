import {
  blockerChainsTestSuite,
  extendWithCommon,
  extendWithNoopNotify,
  extendWithResourceLeakDetection,
  processTestSuite,
  reaperTestSuite,
  schedulingTestSuite,
  chainsTestSuite,
  stateResilienceTestSuite,
  waitChainCompletionTestSuite,
  workerlessCompletionTestSuite,
  workerTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithStateSqlite } from "./state-adapter.sqlite.spec-helper.js";

const sqliteNoopIt = extendWithResourceLeakDetection(
  extendWithNoopNotify(extendWithCommon(extendWithStateSqlite(it))),
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

describe("Chains", () => {
  chainsTestSuite({ it: sqliteNoopIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: sqliteNoopIt });
});

describe("Wait Chain Completion", () => {
  waitChainCompletionTestSuite({ it: sqliteNoopIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: sqliteNoopIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: sqliteNoopIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: sqliteNoopIt });
});
