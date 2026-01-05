import { describe, it, TestAPI } from "vitest";
import { extendWithStateInProcess } from "../state-adapter/state-adapter.in-process.spec-helper.js";
import { StateAdapter } from "../state-adapter/state-adapter.js";
import { blockerSequencesTestSuite } from "../suites/blocker-sequences.test-suite.js";
import { deduplicationTestSuite } from "../suites/deduplication.test-suite.js";
import { schedulingTestSuite } from "../suites/scheduling.test-suite.js";
import { deletionTestSuite } from "../suites/deletion.test-suite.js";
import { processTestSuite } from "../suites/process.test-suite.js";
import { reaperTestSuite } from "../suites/reaper.test-suite.js";
import { sequencesTestSuite } from "../suites/sequences.test-suite.js";
import { extendWithCommon, extendWithNoopNotify } from "../suites/spec-context.spec-helper.js";
import { waitSequenceCompletionTestSuite } from "../suites/wait-sequence-completion.test-suite.js";
import { workerTestSuite } from "../suites/worker.test-suite.js";
import { workerlessCompletionTestSuite } from "../suites/workerless-completion.test-suite.js";

const inProcessNoopIt = extendWithNoopNotify(
  extendWithCommon(
    extendWithStateInProcess(it) as unknown as TestAPI<{
      stateAdapter: StateAdapter<{ $test: true }, string>;
      flakyStateAdapter: StateAdapter<{ $test: true }, string>;
    }>,
  ),
);

describe("Process", () => {
  processTestSuite({ it: inProcessNoopIt });
});

describe("Worker", () => {
  workerTestSuite({ it: inProcessNoopIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: inProcessNoopIt });
});

describe("Sequences", () => {
  sequencesTestSuite({ it: inProcessNoopIt });
});

describe("Blocker Sequences", () => {
  blockerSequencesTestSuite({ it: inProcessNoopIt });
});

describe("Deduplication", () => {
  deduplicationTestSuite({ it: inProcessNoopIt });
});

describe("Deletion", () => {
  deletionTestSuite({ it: inProcessNoopIt });
});

describe("Wait Sequence Completion", () => {
  waitSequenceCompletionTestSuite({ it: inProcessNoopIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: inProcessNoopIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: inProcessNoopIt });
});
