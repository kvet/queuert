import {
  blockerChainsTestSuite,
  extendWithCommon,
  extendWithNotifyInProcess,
  extendWithResourceLeakDetection,
  notifyTestSuite,
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

const sqliteInProcessIt = extendWithResourceLeakDetection(
  extendWithNotifyInProcess(extendWithCommon(extendWithStateSqlite(it))),
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

describe("Chains", () => {
  chainsTestSuite({ it: sqliteInProcessIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: sqliteInProcessIt });
});

describe("Wait Chain Completion", () => {
  waitChainCompletionTestSuite({ it: sqliteInProcessIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: sqliteInProcessIt });
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
