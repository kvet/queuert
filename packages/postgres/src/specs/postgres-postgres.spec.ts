import { TESTCONTAINER_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import {
  blockerChainsTestSuite,
  chainsTestSuite,
  extendWithCommon,
  extendWithResourceLeakDetection,
  notifyResilienceTestSuite,
  notifyTestSuite,
  processErrorHandlingTestSuite,
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
import { extendWithNotifyPostgres } from "./notify-adapter.pg.spec-helper.js";
import { extendWithStatePostgres } from "./state-adapter.pg.spec-helper.js";

const postgresPostgresIt = extendWithResourceLeakDetection(
  extendWithNotifyPostgres(
    extendWithCommon(extendWithStatePostgres(extendWithPostgres(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES },
);

// NOTE: hack for vitest plugin
it("index");

describe("Process Error Handling", () => {
  processErrorHandlingTestSuite({ it: postgresPostgresIt });
});

describe("Process Modes", () => {
  processModesTestSuite({ it: postgresPostgresIt });
});

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
