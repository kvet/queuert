import { describe, it, TestAPI } from "vitest";
import { StateAdapter } from "../state-adapter/state-adapter.js";
import { extendWithStatePostgres } from "../state-adapter/state-adapter.pg.spec-helper.js";
import { blockerSequencesTestSuite } from "../suites/blocker-sequences.test-suite.js";
import { deduplicationTestSuite } from "../suites/deduplication.test-suite.js";
import { deletionTestSuite } from "../suites/deletion.test-suite.js";
import { processTestSuite } from "../suites/process.test-suite.js";
import { reaperTestSuite } from "../suites/reaper.test-suite.js";
import { sequencesTestSuite } from "../suites/sequences.test-suite.js";
import { extendWithCommon, extendWithNoopNotify } from "../suites/spec-context.spec-helper.js";
import { stateResilienceTestSuite } from "../suites/state-resilience.test-suite.js";
import { waitSequenceCompletionTestSuite } from "../suites/wait-sequence-completion.test-suite.js";
import { workerTestSuite } from "../suites/worker.test-suite.js";
import { workerlessCompletionTestSuite } from "../suites/workerless-completion.test-suite.js";

const postgresNoopIt = extendWithNoopNotify(
  extendWithCommon(
    extendWithStatePostgres(it, import.meta.url) as unknown as TestAPI<{
      stateAdapter: StateAdapter<{ $test: true }>;
      flakyStateAdapter: StateAdapter<{ $test: true }>;
    }>,
  ),
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

describe("Sequences", () => {
  sequencesTestSuite({ it: postgresNoopIt });
});

describe("Blocker Sequences", () => {
  blockerSequencesTestSuite({ it: postgresNoopIt });
});

describe("Deduplication", () => {
  deduplicationTestSuite({ it: postgresNoopIt });
});

describe("Deletion", () => {
  deletionTestSuite({ it: postgresNoopIt });
});

describe("Wait Sequence Completion", () => {
  waitSequenceCompletionTestSuite({ it: postgresNoopIt });
});

describe("State Resilience", () => {
  stateResilienceTestSuite({ it: postgresNoopIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: postgresNoopIt });
});
