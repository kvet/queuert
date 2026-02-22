import {
  blockerChainsTestSuite,
  chainsTestSuite,
  deduplicationTestSuite,
  deletionTestSuite,
  extendWithCommon,
  extendWithNotifyInProcess,
  extendWithResourceLeakDetection,
  notifyTestSuite,
  schedulingTestSuite,
  stateResilienceTestSuite,
  waitChainCompletionTestSuite,
  workerlessCompletionTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithStateSqlite } from "./state-adapter.sqlite.spec-helper.js";

const sqliteInProcessIt = extendWithResourceLeakDetection(
  extendWithNotifyInProcess(extendWithCommon(extendWithStateSqlite(it))),
);

// NOTE: hack for vitest plugin
it("index");

describe("Chains", () => {
  chainsTestSuite({ it: sqliteInProcessIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: sqliteInProcessIt });
});

describe("Deduplication", () => {
  deduplicationTestSuite({ it: sqliteInProcessIt });
});

describe("Deletion", () => {
  deletionTestSuite({ it: sqliteInProcessIt });
});

describe("Wait Chain Completion", () => {
  waitChainCompletionTestSuite({ it: sqliteInProcessIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: sqliteInProcessIt, skipConcurrencyTests: true });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: sqliteInProcessIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: sqliteInProcessIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: sqliteInProcessIt });
});
