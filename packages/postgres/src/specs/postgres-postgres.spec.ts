import { extendWithPostgres, TESTCONTAINER_RESOURCE_TYPES } from "@queuert/testcontainers";
import {
  blockerChainsTestSuite,
  extendWithCommon,
  extendWithResourceLeakDetection,
  notifyResilienceTestSuite,
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
import { extendWithNotifyPostgres } from "./notify-adapter.pg.spec-helper.js";
import { extendWithStatePostgres } from "./state-adapter.pg.spec-helper.js";

const postgresPostgresIt = extendWithResourceLeakDetection(
  extendWithNotifyPostgres(
    extendWithCommon(extendWithStatePostgres(extendWithPostgres(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES },
);

describe("Process", () => {
  processTestSuite({ it: postgresPostgresIt });
});

describe("Worker", () => {
  workerTestSuite({ it: postgresPostgresIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: postgresPostgresIt });
});

describe("Chains", () => {
  chainsTestSuite({ it: postgresPostgresIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: postgresPostgresIt });
});

describe("Wait Chain Completion", () => {
  waitChainCompletionTestSuite({ it: postgresPostgresIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: postgresPostgresIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: postgresPostgresIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: postgresPostgresIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: postgresPostgresIt });
});

describe("Notify Resilience", () => {
  notifyResilienceTestSuite({ it: postgresPostgresIt });
});
