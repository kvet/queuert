import { describe, it } from "vitest";
import { extendWithStateInProcess } from "../state-adapter/state-adapter.in-process.spec-helper.js";
import { blockerChainsTestSuite } from "../suites/blocker-chains.test-suite.js";
import { notifyTestSuite } from "../suites/notify.test-suite.js";
import { processModesTestSuite } from "../suites/process-modes.test-suite.js";
import { processTestSuite } from "../suites/process.test-suite.js";
import { reaperTestSuite } from "../suites/reaper.test-suite.js";
import { schedulingTestSuite } from "../suites/scheduling.test-suite.js";
import { chainsTestSuite } from "../suites/chains.test-suite.js";
import {
  extendWithCommon,
  extendWithNotifyInProcess,
  extendWithResourceLeakDetection,
} from "../suites/spec-context.spec-helper.js";
import { waitChainCompletionTestSuite } from "../suites/wait-chain-completion.test-suite.js";
import { workerTestSuite } from "../suites/worker.test-suite.js";
import { workerlessCompletionTestSuite } from "../suites/workerless-completion.test-suite.js";
import { stateResilienceTestSuite } from "../testing.js";

const inProcessInProcessIt = extendWithResourceLeakDetection(
  extendWithNotifyInProcess(extendWithCommon(extendWithStateInProcess(it))),
);

// NOTE: hack for vitest plugin
it("index");

describe("Process Modes", () => {
  processModesTestSuite({ it: inProcessInProcessIt });
});

describe("Process", () => {
  processTestSuite({ it: inProcessInProcessIt });
});

describe("Worker", () => {
  workerTestSuite({ it: inProcessInProcessIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: inProcessInProcessIt });
});

describe("Chains", () => {
  chainsTestSuite({ it: inProcessInProcessIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: inProcessInProcessIt });
});

describe("Wait Chain Completion", () => {
  waitChainCompletionTestSuite({ it: inProcessInProcessIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: inProcessInProcessIt, skipConcurrencyTests: true });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: inProcessInProcessIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: inProcessInProcessIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: inProcessInProcessIt });
});
