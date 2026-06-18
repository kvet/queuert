import { describe, it } from "vitest";

import { extendWithStateInProcess } from "../state-adapter/state-adapter.in-process.spec-helper.js";
import { awaitChainTestSuite } from "../suites/await-chain.test-suite.js";
import { blockerChainsTestSuite } from "../suites/blocker-chains.test-suite.js";
import { chainsTestSuite } from "../suites/chains.test-suite.js";
import { deduplicationTestSuite } from "../suites/deduplication.test-suite.js";
import { deletionTestSuite } from "../suites/deletion.test-suite.js";
import { rescheduleJobTestSuite } from "../suites/reschedule-job.test-suite.js";
import { schedulingTestSuite } from "../suites/scheduling.test-suite.js";
import {
  extendWithCommon,
  extendWithNotifyNoop,
  extendWithResourceLeakDetection,
} from "../suites/spec-context.spec-helper.js";
import { startChainsTestSuite } from "../suites/start-chains.test-suite.js";
import { validationTestSuite } from "../suites/validation.test-suite.js";
import { workerlessCompletionTestSuite } from "../suites/workerless-completion.test-suite.js";
import { stateResilienceTestSuite } from "../testing.js";

const inProcessNoopIt = extendWithResourceLeakDetection(
  extendWithNotifyNoop(extendWithCommon(extendWithStateInProcess(it))),
);

// NOTE: hack for vitest plugin
it("index");

describe("Chains", () => {
  chainsTestSuite({ it: inProcessNoopIt });
});

describe("Start Chains", () => {
  startChainsTestSuite({ it: inProcessNoopIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: inProcessNoopIt });
});

describe("Deduplication", () => {
  deduplicationTestSuite({ it: inProcessNoopIt });
});

describe("Deletion", () => {
  deletionTestSuite({ it: inProcessNoopIt });
});

describe("Await Chain", () => {
  awaitChainTestSuite({ it: inProcessNoopIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: inProcessNoopIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: inProcessNoopIt });
});

describe("Reschedule Job", () => {
  rescheduleJobTestSuite({ it: inProcessNoopIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: inProcessNoopIt });
});

describe("Validation", () => {
  validationTestSuite({ it: inProcessNoopIt });
});
