import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import {
  awaitChainTestSuite,
  blockerChainsTestSuite,
  chainsTestSuite,
  createChainsTestSuite,
  deduplicationTestSuite,
  deletionTestSuite,
  extendWithCommon,
  extendWithNotifyInProcess,
  extendWithResourceLeakDetection,
  notifyTestSuite,
  rescheduleJobTestSuite,
  schedulingTestSuite,
  stateResilienceTestSuite,
  workerlessCompletionTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";

import { extendWithStatePg } from "./state-adapter.pg.spec-helper.js";

const postgresInProcessIt = extendWithResourceLeakDetection(
  extendWithNotifyInProcess(
    extendWithCommon(extendWithStatePg(extendWithPostgres(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES },
);

// NOTE: hack for vitest plugin
it("index");

describe("Chains", () => {
  chainsTestSuite({ it: postgresInProcessIt });
});

describe("Create Chains", () => {
  createChainsTestSuite({ it: postgresInProcessIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: postgresInProcessIt });
});

describe("Deduplication", () => {
  deduplicationTestSuite({ it: postgresInProcessIt });
});

describe("Deletion", () => {
  deletionTestSuite({ it: postgresInProcessIt });
});

describe("Await Chain", () => {
  awaitChainTestSuite({ it: postgresInProcessIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: postgresInProcessIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: postgresInProcessIt });
});

describe("Reschedule Job", () => {
  rescheduleJobTestSuite({ it: postgresInProcessIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: postgresInProcessIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: postgresInProcessIt });
});
