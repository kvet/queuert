import { extendWithPostgres, TESTCONTAINER_RESOURCE_TYPES } from "@queuert/testcontainers";
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
import { describe, it } from "vitest";
import { extendWithStatePostgres } from "./state-adapter.pg.spec-helper.js";

const postgresInProcessIt = extendWithResourceLeakDetection(
  extendWithInProcessNotify(
    extendWithCommon(extendWithStatePostgres(extendWithPostgres(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES },
);

describe("Process", () => {
  processTestSuite({ it: postgresInProcessIt });
});

describe("Worker", () => {
  workerTestSuite({ it: postgresInProcessIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: postgresInProcessIt });
});

describe("Chains", () => {
  chainsTestSuite({ it: postgresInProcessIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: postgresInProcessIt });
});

describe("Wait Chain Completion", () => {
  waitChainCompletionTestSuite({ it: postgresInProcessIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: postgresInProcessIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: postgresInProcessIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: postgresInProcessIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: postgresInProcessIt });
});
