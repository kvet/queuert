import { extendWithPostgres } from "@queuert/testcontainers";
import { type StateAdapter } from "queuert";
import {
  blockerSequencesTestSuite,
  extendWithCommon,
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
import { describe, it, TestAPI } from "vitest";
import { extendWithPostgresNotify } from "./notify-adapter.pg.spec-helper.js";
import { extendWithStatePostgres } from "./state-adapter.pg.spec-helper.js";

const postgresPostgresIt = extendWithPostgresNotify(
  extendWithCommon(
    extendWithStatePostgres(extendWithPostgres(it, import.meta.url)) as unknown as TestAPI<{
      stateAdapter: StateAdapter<{ $test: true }, string>;
      flakyStateAdapter: StateAdapter<{ $test: true }, string>;
      postgresConnectionString: string;
    }>,
  ),
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

describe("Notify", () => {
  notifyTestSuite({ it: postgresPostgresIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: postgresPostgresIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: postgresPostgresIt });
});
