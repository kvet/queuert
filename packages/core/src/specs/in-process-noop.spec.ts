import { describe, it } from "vitest";
import { extendWithStateInProcess } from "../state-adapter/state-adapter.in-process.spec-helper.js";
import { blockerChainsTestSuite } from "../suites/blocker-chains.test-suite.js";
import { deduplicationTestSuite } from "../suites/deduplication.test-suite.js";
import { deletionTestSuite } from "../suites/deletion.test-suite.js";
import { processTestSuite } from "../suites/process.test-suite.js";
import { reaperTestSuite } from "../suites/reaper.test-suite.js";
import { schedulingTestSuite } from "../suites/scheduling.test-suite.js";
import { chainsTestSuite } from "../suites/chains.test-suite.js";
import {
  extendWithCommon,
  extendWithNoopNotify,
  extendWithResourceLeakDetection,
} from "../suites/spec-context.spec-helper.js";
import { waitChainCompletionTestSuite } from "../suites/wait-chain-completion.test-suite.js";
import { workerTestSuite } from "../suites/worker.test-suite.js";
import { workerlessCompletionTestSuite } from "../suites/workerless-completion.test-suite.js";

const inProcessNoopIt = extendWithResourceLeakDetection(
  extendWithNoopNotify(extendWithCommon(extendWithStateInProcess(it))),
);

describe("Process", () => {
  processTestSuite({ it: inProcessNoopIt });
});

describe("Worker", () => {
  workerTestSuite({ it: inProcessNoopIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: inProcessNoopIt });
});

describe("Chains", () => {
  chainsTestSuite({ it: inProcessNoopIt });
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

describe("Wait Chain Completion", () => {
  waitChainCompletionTestSuite({ it: inProcessNoopIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: inProcessNoopIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: inProcessNoopIt });
});
