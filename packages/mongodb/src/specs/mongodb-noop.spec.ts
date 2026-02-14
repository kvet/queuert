import { TESTCONTAINER_RESOURCE_TYPES, extendWithMongodb } from "@queuert/testcontainers";
import {
  blockerChainsTestSuite,
  chainsTestSuite,
  extendWithCommon,
  extendWithNotifyNoop,
  extendWithResourceLeakDetection,
  processModesTestSuite,
  processTestSuite,
  reaperTestSuite,
  schedulingTestSuite,
  stateResilienceTestSuite,
  waitChainCompletionTestSuite,
  workerTestSuite,
  workerlessCompletionTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithStateMongodb } from "./state-adapter.mongodb.spec-helper.js";

const mongodbNoopIt = extendWithResourceLeakDetection(
  extendWithNotifyNoop(
    extendWithCommon(extendWithStateMongodb(extendWithMongodb(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES },
);

// NOTE: hack for vitest plugin
it("index");

describe("Process Modes", () => {
  processModesTestSuite({ it: mongodbNoopIt });
});

describe("Process", () => {
  processTestSuite({ it: mongodbNoopIt });
});

describe("Worker", () => {
  workerTestSuite({ it: mongodbNoopIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: mongodbNoopIt });
});

describe("Chains", () => {
  chainsTestSuite({ it: mongodbNoopIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: mongodbNoopIt });
});

describe("Wait Chain Completion", () => {
  waitChainCompletionTestSuite({ it: mongodbNoopIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: mongodbNoopIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: mongodbNoopIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: mongodbNoopIt });
});
