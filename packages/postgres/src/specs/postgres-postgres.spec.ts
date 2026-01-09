import { extendWithPostgres, TESTCONTAINER_RESOURCE_TYPES } from "@queuert/testcontainers";
import {
  blockerSequencesTestSuite,
  extendWithCommon,
  extendWithResourceLeakDetection,
  notifyResilienceTestSuite,
  notifyTestSuite,
  processTestSuite,
  reaperTestSuite,
  schedulingTestSuite,
  sequencesTestSuite,
  stateResilienceTestSuite,
  waitSequenceCompletionTestSuite,
  workerlessCompletionTestSuite,
  workerTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithPostgresNotify } from "./notify-adapter.pg.spec-helper.js";
import { extendWithStatePostgres } from "./state-adapter.pg.spec-helper.js";

const postgresPostgresIt = extendWithResourceLeakDetection(
  extendWithPostgresNotify(
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

describe("Sequences", () => {
  sequencesTestSuite({ it: postgresPostgresIt });
});

describe("Blocker Sequences", () => {
  blockerSequencesTestSuite({ it: postgresPostgresIt });
});

describe("Wait Sequence Completion", () => {
  waitSequenceCompletionTestSuite({ it: postgresPostgresIt });
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
