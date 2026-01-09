import { extendWithPostgres, TESTCONTAINER_RESOURCE_TYPES } from "@queuert/testcontainers";
import {
  blockerSequencesTestSuite,
  deduplicationTestSuite,
  deletionTestSuite,
  extendWithCommon,
  extendWithNoopNotify,
  extendWithResourceLeakDetection,
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

const postgresNoopIt = extendWithResourceLeakDetection(
  extendWithNoopNotify(
    extendWithCommon(extendWithStatePostgres(extendWithPostgres(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES },
);

describe("Process", () => {
  processTestSuite({ it: postgresNoopIt });
});

describe("Worker", () => {
  workerTestSuite({ it: postgresNoopIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: postgresNoopIt });
});

describe("Sequences", () => {
  sequencesTestSuite({ it: postgresNoopIt });
});

describe("Blocker Sequences", () => {
  blockerSequencesTestSuite({ it: postgresNoopIt });
});

describe("Deduplication", () => {
  deduplicationTestSuite({ it: postgresNoopIt });
});

describe("Deletion", () => {
  deletionTestSuite({ it: postgresNoopIt });
});

describe("Wait Sequence Completion", () => {
  waitSequenceCompletionTestSuite({ it: postgresNoopIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: postgresNoopIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: postgresNoopIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: postgresNoopIt });
});
