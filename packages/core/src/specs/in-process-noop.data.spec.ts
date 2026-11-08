import { describe, it } from "vitest";

import { extendWithStateInProcess } from "../state-adapter/state-adapter.in-process.spec-helper.ts";
import { awaitChainTestSuite } from "../suites/await-chain.test-suite.ts";
import { blockerChainsTestSuite } from "../suites/blocker-chains.test-suite.ts";
import { chainsTestSuite } from "../suites/chains.test-suite.ts";
import { clientQueriesTestSuite } from "../suites/client-queries.test-suite.ts";
import { createChainsTestSuite } from "../suites/create-chains.test-suite.ts";
import { deduplicationTestSuite } from "../suites/deduplication.test-suite.ts";
import { deletionTestSuite } from "../suites/deletion.test-suite.ts";
import { rescheduleJobTestSuite } from "../suites/reschedule-job.test-suite.ts";
import { schedulingTestSuite } from "../suites/scheduling.test-suite.ts";
import {
  extendWithCommon,
  extendWithResourceLeakDetection,
} from "../suites/spec-context.spec-helper.ts";
import { validationTestSuite } from "../suites/validation.test-suite.ts";
import { workerlessCompletionTestSuite } from "../suites/workerless-completion.test-suite.ts";
import { stateResilienceTestSuite } from "../testing.ts";

const inProcessNoopIt = extendWithResourceLeakDetection(
  extendWithCommon(extendWithStateInProcess(it)),
);

// NOTE: hack for vitest plugin
it("index");

describe("Chains", () => {
  chainsTestSuite({ it: inProcessNoopIt });
});

describe("Create Chains", () => {
  createChainsTestSuite({ it: inProcessNoopIt });
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

describe("Client Queries", () => {
  clientQueriesTestSuite({ it: inProcessNoopIt });
});
