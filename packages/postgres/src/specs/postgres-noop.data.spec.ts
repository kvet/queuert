import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import {
  blockerChainsTestSuite,
  chainsTestSuite,
  deduplicationTestSuite,
  deletionTestSuite,
  extendWithCommon,
  extendWithNotifyNoop,
  extendWithResourceLeakDetection,
  schedulingTestSuite,
  startChainsTestSuite,
  stateResilienceTestSuite,
  triggerJobTestSuite,
  waitChainCompletionTestSuite,
  workerlessCompletionTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";

import { extendWithStatePostgres } from "./state-adapter.pg.spec-helper.js";

const postgresNoopIt = extendWithResourceLeakDetection(
  extendWithNotifyNoop(
    extendWithCommon(extendWithStatePostgres(extendWithPostgres(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES },
);

// NOTE: hack for vitest plugin
it("index");

describe("Chains", () => {
  chainsTestSuite({ it: postgresNoopIt });
});

describe("Start Chains", () => {
  startChainsTestSuite({ it: postgresNoopIt });
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

describe("Trigger Job", () => {
  triggerJobTestSuite({ it: postgresNoopIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: postgresNoopIt });
});
