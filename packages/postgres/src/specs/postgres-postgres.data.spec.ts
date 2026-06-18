import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import {
  blockerChainsTestSuite,
  chainsTestSuite,
  deduplicationTestSuite,
  deletionTestSuite,
  extendWithCommon,
  extendWithResourceLeakDetection,
  notifyResilienceTestSuite,
  notifyTestSuite,
  schedulingTestSuite,
  startChainsTestSuite,
  stateResilienceTestSuite,
  rescheduleJobTestSuite,
  awaitChainTestSuite,
  workerlessCompletionTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";

import { extendWithNotifyPg } from "./notify-adapter.pg.spec-helper.js";
import { extendWithStatePg } from "./state-adapter.pg.spec-helper.js";

const postgresPostgresIt = extendWithResourceLeakDetection(
  extendWithNotifyPg(extendWithCommon(extendWithStatePg(extendWithPostgres(it, import.meta.url)))),
  { additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES },
);

// NOTE: hack for vitest plugin
it("index");

describe("Chains", () => {
  chainsTestSuite({ it: postgresPostgresIt });
});

describe("Start Chains", () => {
  startChainsTestSuite({ it: postgresPostgresIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: postgresPostgresIt });
});

describe("Deduplication", () => {
  deduplicationTestSuite({ it: postgresPostgresIt });
});

describe("Deletion", () => {
  deletionTestSuite({ it: postgresPostgresIt });
});

describe("Await Chain", () => {
  awaitChainTestSuite({ it: postgresPostgresIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: postgresPostgresIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: postgresPostgresIt });
});

describe("Reschedule Job", () => {
  rescheduleJobTestSuite({ it: postgresPostgresIt });
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
