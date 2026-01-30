import { TESTCONTAINER_RESOURCE_TYPES, extendWithMysql } from "@queuert/testcontainers";
import {
  blockerChainsTestSuite,
  chainsTestSuite,
  extendWithCommon,
  extendWithNotifyInProcess,
  extendWithResourceLeakDetection,
  notifyTestSuite,
  processTestSuite,
  reaperTestSuite,
  schedulingTestSuite,
  stateResilienceTestSuite,
  waitChainCompletionTestSuite,
  workerTestSuite,
  workerlessCompletionTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithStateMysql } from "./state-adapter.mysql.spec-helper.js";

const mysqlInProcessIt = extendWithResourceLeakDetection(
  extendWithNotifyInProcess(
    extendWithCommon(extendWithStateMysql(extendWithMysql(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES },
);

describe("Process", () => {
  processTestSuite({ it: mysqlInProcessIt });
});

describe("Worker", () => {
  workerTestSuite({ it: mysqlInProcessIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: mysqlInProcessIt });
});

describe("Chains", () => {
  chainsTestSuite({ it: mysqlInProcessIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: mysqlInProcessIt });
});

describe("Wait Chain Completion", () => {
  waitChainCompletionTestSuite({ it: mysqlInProcessIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: mysqlInProcessIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: mysqlInProcessIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: mysqlInProcessIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: mysqlInProcessIt });
});
