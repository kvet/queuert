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

import { extendWithStateSqlite } from "./state-adapter.sqlite.spec-helper.js";

const sqliteNoopIt = extendWithResourceLeakDetection(
  extendWithNotifyNoop(extendWithCommon(extendWithStateSqlite(it))),
);

// NOTE: hack for vitest plugin
it("index");

describe("Chains", () => {
  chainsTestSuite({ it: sqliteNoopIt });
});

describe("Create Chains", () => {
  createChainsTestSuite({ it: sqliteNoopIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: sqliteNoopIt });
});

describe("Deduplication", () => {
  deduplicationTestSuite({ it: sqliteNoopIt });
});

describe("Deletion", () => {
  deletionTestSuite({ it: sqliteNoopIt });
});

describe("Await Chain", () => {
  awaitChainTestSuite({ it: sqliteNoopIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: sqliteNoopIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: sqliteNoopIt });
});

describe("Reschedule Job", () => {
  rescheduleJobTestSuite({ it: sqliteNoopIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: sqliteNoopIt });
});
