import {
  blockerChainsTestSuite,
  chainsTestSuite,
  deduplicationTestSuite,
  deletionTestSuite,
  extendWithCommon,
  extendWithNotifyNoop,
  extendWithResourceLeakDetection,
  schedulingTestSuite,
  startChainsTestSuite,
  stateResilienceTestSuite,
  waitChainCompletionTestSuite,
  workerlessCompletionTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithStateSqlite } from "./state-adapter.sqlite.spec-helper.js";

const sqliteNoopIt = extendWithResourceLeakDetection(
  extendWithNotifyNoop(extendWithCommon(extendWithStateSqlite(it))),
);

// NOTE: hack for vitest plugin
it("index");

describe("Chains", () => {
  chainsTestSuite({ it: sqliteNoopIt });
});

describe("Start Chains", () => {
  startChainsTestSuite({ it: sqliteNoopIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: sqliteNoopIt });
});

describe("Deduplication", () => {
  deduplicationTestSuite({ it: sqliteNoopIt });
});

describe("Deletion", () => {
  deletionTestSuite({ it: sqliteNoopIt });
});

describe("Wait Chain Completion", () => {
  waitChainCompletionTestSuite({ it: sqliteNoopIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: sqliteNoopIt, skipConcurrencyTests: true });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: sqliteNoopIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: sqliteNoopIt });
});
