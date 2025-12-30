import { describe, it, TestAPI } from "vitest";
import { StateAdapter } from "../state-adapter/state-adapter.js";
import { extendWithStateInProcess } from "../state-adapter/state-adapter.in-process.spec-helper.js";
import { blockerSequencesTestSuite } from "../suites/blocker-sequences.test-suite.js";
import { processTestSuite } from "../suites/process.test-suite.js";
import { notifyTestSuite } from "../suites/notify.test-suite.js";
import { reaperTestSuite } from "../suites/reaper.test-suite.js";
import { sequencesTestSuite } from "../suites/sequences.test-suite.js";
import { extendWithCommon, extendWithInProcessNotify } from "../suites/spec-context.spec-helper.js";
import { waitSequenceCompletionTestSuite } from "../suites/wait-sequence-completion.test-suite.js";
import { workerTestSuite } from "../suites/worker.test-suite.js";
import { workerlessCompletionTestSuite } from "../suites/workerless-completion.test-suite.js";

const inProcessInProcessIt = extendWithInProcessNotify(
  extendWithCommon(
    extendWithStateInProcess(it) as unknown as TestAPI<{
      stateAdapter: StateAdapter<{ $test: true }>;
      flakyStateAdapter: StateAdapter<{ $test: true }>;
    }>,
  ),
);

describe("Process", () => {
  processTestSuite({ it: inProcessInProcessIt });
});

describe("Worker", () => {
  workerTestSuite({ it: inProcessInProcessIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: inProcessInProcessIt });
});

describe("Sequences", () => {
  sequencesTestSuite({ it: inProcessInProcessIt });
});

describe("Blocker Sequences", () => {
  blockerSequencesTestSuite({ it: inProcessInProcessIt });
});

describe("Wait Sequence Completion", () => {
  waitSequenceCompletionTestSuite({ it: inProcessInProcessIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: inProcessInProcessIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: inProcessInProcessIt });
});
