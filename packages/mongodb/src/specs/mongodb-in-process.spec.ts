import { extendWithMongodb, TESTCONTAINER_RESOURCE_TYPES } from "@queuert/testcontainers";
import {
  blockerChainsTestSuite,
  extendWithCommon,
  extendWithInProcessNotify,
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
import { afterAll, beforeAll, describe, it as baseIt } from "vitest";
import { extendWithStateMongodb } from "./state-adapter.mongodb.spec-helper.js";

// Suppress unhandled rejections from flaky connection test cleanup
// These occur when worker cleanup races with in-flight MongoDB operations
// that are intentionally failing due to the flaky test setup
const suppressedErrors: Error[] = [];
const rejectionHandler = (error: Error) => {
  if (error?.message === "connection reset") {
    suppressedErrors.push(error);
  }
};

beforeAll(() => {
  process.on("unhandledRejection", rejectionHandler);
});

afterAll(() => {
  process.off("unhandledRejection", rejectionHandler);
});

const mongodbInProcessIt = extendWithResourceLeakDetection(
  extendWithInProcessNotify(
    extendWithCommon(extendWithStateMongodb(extendWithMongodb(baseIt, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES },
);

describe("Process", () => {
  processTestSuite({ it: mongodbInProcessIt });
});

describe("Worker", () => {
  workerTestSuite({ it: mongodbInProcessIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: mongodbInProcessIt });
});

describe("Chains", () => {
  chainsTestSuite({ it: mongodbInProcessIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: mongodbInProcessIt });
});

describe("Wait Chain Completion", () => {
  waitChainCompletionTestSuite({ it: mongodbInProcessIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: mongodbInProcessIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: mongodbInProcessIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: mongodbInProcessIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: mongodbInProcessIt });
});
