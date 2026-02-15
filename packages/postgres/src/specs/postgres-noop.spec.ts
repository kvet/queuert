import { TESTCONTAINER_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import {
  blockerChainsTestSuite,
  chainsTestSuite,
  deduplicationTestSuite,
  deletionTestSuite,
  extendWithCommon,
  extendWithNotifyNoop,
  extendWithResourceLeakDetection,
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
import { extendWithStatePostgres } from "./state-adapter.pg.spec-helper.js";

const postgresNoopIt = extendWithResourceLeakDetection(
  extendWithNotifyNoop(
    extendWithCommon(extendWithStatePostgres(extendWithPostgres(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES },
);

// NOTE: hack for vitest plugin
it("index");

describe("Process Error Handling", () => {
  processErrorHandlingTestSuite({ it: postgresNoopIt });
});

describe("Process Modes", () => {
  processModesTestSuite({ it: postgresNoopIt });
});

describe("Process", () => {
  processTestSuite({ it: postgresNoopIt });
});

describe("Worker", () => {
  workerTestSuite({ it: postgresNoopIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: postgresNoopIt });
});

describe("Chains", () => {
  chainsTestSuite({ it: postgresNoopIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: postgresNoopIt });
});

describe("Deduplication", () => {
  deduplicationTestSuite({ it: postgresNoopIt });
});

describe("Deletion", () => {
  deletionTestSuite({ it: postgresNoopIt });
});

describe("Wait Chain Completion", () => {
  waitChainCompletionTestSuite({ it: postgresNoopIt });
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
