import {
  blockerSequencesTestSuite,
  deduplicationTestSuite,
  deletionTestSuite,
  extendWithCommon,
  extendWithInProcessNotify,
  extendWithStateInProcess,
  processTestSuite,
  reaperTestSuite,
  schedulingTestSuite,
  sequencesTestSuite,
  waitSequenceCompletionTestSuite,
  workerlessCompletionTestSuite,
  workerTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithOtelObservability } from "./observability-adapter.otel.spec-helper.js";

const otelIt = extendWithOtelObservability(
  extendWithInProcessNotify(extendWithCommon(extendWithStateInProcess(it))),
);

describe("Process", () => {
  processTestSuite({ it: otelIt });
});

describe("Worker", () => {
  workerTestSuite({ it: otelIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: otelIt });
});

describe("Sequences", () => {
  sequencesTestSuite({ it: otelIt });
});

describe("Blocker Sequences", () => {
  blockerSequencesTestSuite({ it: otelIt });
});

describe("Deduplication", () => {
  deduplicationTestSuite({ it: otelIt });
});

describe("Deletion", () => {
  deletionTestSuite({ it: otelIt });
});

describe("Wait Sequence Completion", () => {
  waitSequenceCompletionTestSuite({ it: otelIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: otelIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: otelIt });
});
