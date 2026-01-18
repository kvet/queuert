import { extendWithPostgres, TESTCONTAINER_RESOURCE_TYPES } from "@queuert/testcontainers";
import {
  blockerChainsTestSuite,
  deduplicationTestSuite,
  deletionTestSuite,
  extendWithCommon,
  extendWithNotifyNoop,
  extendWithResourceLeakDetection,
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

const postgresNoopIt = extendWithResourceLeakDetection(
  extendWithNotifyNoop(
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
