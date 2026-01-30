import { TESTCONTAINER_RESOURCE_TYPES, extendWithMariadb } from "@queuert/testcontainers";
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
import { extendWithStateMariadb } from "./state-adapter.mariadb.spec-helper.js";

const mariadbInProcessIt = extendWithResourceLeakDetection(
  extendWithNotifyInProcess(
    extendWithCommon(extendWithStateMariadb(extendWithMariadb(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES },
);

describe("Process", () => {
  processTestSuite({ it: mariadbInProcessIt });
});

describe("Worker", () => {
  workerTestSuite({ it: mariadbInProcessIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: mariadbInProcessIt });
});

describe("Chains", () => {
  chainsTestSuite({ it: mariadbInProcessIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: mariadbInProcessIt });
});

describe("Wait Chain Completion", () => {
  waitChainCompletionTestSuite({ it: mariadbInProcessIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: mariadbInProcessIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: mariadbInProcessIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: mariadbInProcessIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: mariadbInProcessIt });
});
