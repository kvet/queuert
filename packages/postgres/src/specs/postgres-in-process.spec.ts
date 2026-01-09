import { extendWithPostgres, TESTCONTAINER_RESOURCE_TYPES } from "@queuert/testcontainers";
import {
  blockerSequencesTestSuite,
  extendWithCommon,
  extendWithInProcessNotify,
  extendWithResourceLeakDetection,
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

describe("Sequences", () => {
  sequencesTestSuite({ it: postgresInProcessIt });
});

describe("Blocker Sequences", () => {
  blockerSequencesTestSuite({ it: postgresInProcessIt });
});

describe("Wait Sequence Completion", () => {
  waitSequenceCompletionTestSuite({ it: postgresInProcessIt });
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
