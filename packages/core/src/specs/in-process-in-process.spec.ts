import { describe, it } from "vitest";

import { extendWithStateInProcess } from "../state-adapter/state-adapter.in-process.spec-helper.js";
import { attemptReclaimerTestSuite } from "../suites/attempt-reclaimer.test-suite.js";
import { awaitChainTestSuite } from "../suites/await-chain.test-suite.js";
import { blockerChainsTestSuite } from "../suites/blocker-chains.test-suite.js";
import { chainsTestSuite } from "../suites/chains.test-suite.js";
import { clientQueriesTestSuite } from "../suites/client-queries.test-suite.js";
import { createChainsTestSuite } from "../suites/create-chains.test-suite.js";
import { notifyTestSuite } from "../suites/notify.test-suite.js";
import { processErrorHandlingTestSuite } from "../suites/process-error-handling.test-suite.js";
import { processModesTestSuite } from "../suites/process-modes.test-suite.js";
import { processTestSuite } from "../suites/process.test-suite.js";
import { rescheduleJobTestSuite } from "../suites/reschedule-job.test-suite.js";
import { schedulingTestSuite } from "../suites/scheduling.test-suite.js";
import {
  extendWithCommon,
  extendWithNotifyInProcess,
  extendWithResourceLeakDetection,
} from "../suites/spec-context.spec-helper.js";
import { workerTestSuite } from "../suites/worker.test-suite.js";
import { workerlessCompletionTestSuite } from "../suites/workerless-completion.test-suite.js";
import { notifyResilienceTestSuite, stateResilienceTestSuite } from "../testing.js";

const inProcessInProcessIt = extendWithResourceLeakDetection(
  extendWithNotifyInProcess(extendWithCommon(extendWithStateInProcess(it))),
);

// NOTE: hack for vitest plugin
it("index");

describe("Process Error Handling", () => {
  processErrorHandlingTestSuite({ it: inProcessInProcessIt });
});

describe("Process Modes", () => {
  processModesTestSuite({ it: inProcessInProcessIt });
});

describe("Process", () => {
  processTestSuite({ it: inProcessInProcessIt });
});

describe("Worker", () => {
  workerTestSuite({ it: inProcessInProcessIt });
});

describe("Attempt Reclamation", () => {
  attemptReclaimerTestSuite({ it: inProcessInProcessIt });
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

describe("Client Queries", () => {
  clientQueriesTestSuite({ it: inProcessInProcessIt });
});
