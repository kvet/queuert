import {
  blockerChainsTestSuite,
  chainsTestSuite,
  clientQueriesTestSuite,
  deduplicationTestSuite,
  deletionTestSuite,
  extendWithCommon,
  extendWithNotifyInProcess,
  extendWithResourceLeakDetection,
  notifyTestSuite,
  schedulingTestSuite,
  createChainsTestSuite,
  stateResilienceTestSuite,
  rescheduleJobTestSuite,
  awaitChainTestSuite,
  workerlessCompletionTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";

import { extendWithStateSqlite } from "./state-adapter.sqlite.spec-helper.js";

const sqliteInProcessIt = extendWithResourceLeakDetection(
  extendWithNotifyInProcess(extendWithCommon(extendWithStateSqlite(it))),
);

// NOTE: hack for vitest plugin
it("index");

describe("Chains", () => {
  chainsTestSuite({ it: sqliteInProcessIt });
});

describe("Create Chains", () => {
  createChainsTestSuite({ it: sqliteInProcessIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: sqliteInProcessIt });
});

describe("Deduplication", () => {
  deduplicationTestSuite({ it: sqliteInProcessIt });
});

describe("Deletion", () => {
  deletionTestSuite({ it: sqliteInProcessIt });
});

describe("Await Chain", () => {
  awaitChainTestSuite({ it: sqliteInProcessIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: sqliteInProcessIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: sqliteInProcessIt });
});

describe("Reschedule Job", () => {
  rescheduleJobTestSuite({ it: sqliteInProcessIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: sqliteInProcessIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: sqliteInProcessIt });
});

describe("Client Queries", () => {
  clientQueriesTestSuite({ it: sqliteInProcessIt });
});
