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
  createChainsTestSuite,
  stateResilienceTestSuite,
  rescheduleJobTestSuite,
  awaitChainTestSuite,
  workerlessCompletionTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";

import { extendWithStatePg } from "./state-adapter.pg.spec-helper.js";

const postgresNoopIt = extendWithResourceLeakDetection(
  extendWithNotifyNoop(
    extendWithCommon(extendWithStatePg(extendWithPostgres(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES },
);

// NOTE: hack for vitest plugin
it("index");

describe("Chains", () => {
  chainsTestSuite({ it: postgresNoopIt });
});

describe("Create Chains", () => {
  createChainsTestSuite({ it: postgresNoopIt });
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

describe("Await Chain", () => {
  awaitChainTestSuite({ it: postgresNoopIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: postgresNoopIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: postgresNoopIt });
});

describe("Reschedule Job", () => {
  rescheduleJobTestSuite({ it: postgresNoopIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: postgresNoopIt });
});
