import { describe, it } from "vitest";

import { extendWithStateInProcess } from "../state-adapter/state-adapter.in-process.spec-helper.ts";
import { awaitChainTestSuite } from "../suites/await-chain.test-suite.ts";
import { blockerChainsTestSuite } from "../suites/blocker-chains.test-suite.ts";
import { chainsTestSuite } from "../suites/chains.test-suite.ts";
import { createChainsTestSuite } from "../suites/create-chains.test-suite.ts";
import { notifyTestSuite } from "../suites/notify.test-suite.ts";
import { processErrorHandlingTestSuite } from "../suites/process-error-handling.test-suite.ts";
import { processTestSuite } from "../suites/process.test-suite.ts";
import { rescheduleJobTestSuite } from "../suites/reschedule-job.test-suite.ts";
import { schedulingTestSuite } from "../suites/scheduling.test-suite.ts";
import {
  extendWithCommon,
  extendWithNotifyInProcess,
  extendWithResourceLeakDetection,
} from "../suites/spec-context.spec-helper.ts";
import { workerTestSuite } from "../suites/worker.test-suite.ts";
import { workerlessCompletionTestSuite } from "../suites/workerless-completion.test-suite.ts";
import { notifyResilienceTestSuite, stateResilienceTestSuite } from "../testing.ts";

const inProcessInProcessIt = extendWithResourceLeakDetection(
  extendWithNotifyInProcess(extendWithCommon(extendWithStateInProcess(it))),
);

// NOTE: hack for vitest plugin
it("index");

describe("Process Error Handling", () => {
  processErrorHandlingTestSuite({ it: inProcessInProcessIt });
});

describe("Process", () => {
  processTestSuite({ it: inProcessInProcessIt });
});

describe("Worker", () => {
  workerTestSuite({ it: inProcessInProcessIt });
});

describe("Chains", () => {
  chainsTestSuite({ it: inProcessInProcessIt });
});

describe("Create Chains", () => {
  createChainsTestSuite({ it: inProcessInProcessIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: inProcessInProcessIt });
});

describe("Await Chain", () => {
  awaitChainTestSuite({ it: inProcessInProcessIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: inProcessInProcessIt });
});

describe("Notify Resilience", () => {
  notifyResilienceTestSuite({ it: inProcessInProcessIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: inProcessInProcessIt });
});

describe("Reschedule Job", () => {
  rescheduleJobTestSuite({ it: inProcessInProcessIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: inProcessInProcessIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: inProcessInProcessIt });
});
