import { describe, it, TestAPI } from "vitest";
import { StateAdapter } from "../state-adapter/state-adapter.js";
import { extendWithStatePostgres } from "../state-adapter/state-adapter.pg.spec-helper.js";
import { blockerSequencesTestSuite } from "../suites/blocker-sequences.test-suite.js";
import { processTestSuite } from "../suites/process.test-suite.js";
import { notifyTestSuite } from "../suites/notify.test-suite.js";
import { reaperTestSuite } from "../suites/reaper.test-suite.js";
import { sequencesTestSuite } from "../suites/sequences.test-suite.js";
import { extendWithCommon, extendWithInProcessNotify } from "../suites/spec-context.spec-helper.js";
import { stateResilienceTestSuite } from "../suites/state-resilience.test-suite.js";
import { waitSequenceCompletionTestSuite } from "../suites/wait-sequence-completion.test-suite.js";
import { workerTestSuite } from "../suites/worker.test-suite.js";
import { workerlessCompletionTestSuite } from "../suites/workerless-completion.test-suite.js";

const postgresInProcessIt = extendWithInProcessNotify(
  extendWithCommon(
    extendWithStatePostgres(it, import.meta.url) as unknown as TestAPI<{
      stateAdapter: StateAdapter<{ $test: true }>;
      flakyStateAdapter: StateAdapter<{ $test: true }>;
    }>,
  ),
);

describe("Process", () => {
  processTestSuite({ it: postgresInProcessIt });
});

describe("Worker", () => {
  workerTestSuite({ it: postgresInProcessIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: postgresInProcessIt });
});

describe("Sequences", () => {
  sequencesTestSuite({ it: postgresInProcessIt });
});

describe("Blocker Sequences", () => {
  blockerSequencesTestSuite({ it: postgresInProcessIt });
});

describe("Wait Sequence Completion", () => {
  waitSequenceCompletionTestSuite({ it: postgresInProcessIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: postgresInProcessIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: postgresInProcessIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: postgresInProcessIt });
});
