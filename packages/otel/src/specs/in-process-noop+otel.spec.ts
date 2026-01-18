import {
  blockerChainsTestSuite,
  deduplicationTestSuite,
  deletionTestSuite,
  extendWithCommon,
  extendWithNotifyInProcess,
  extendWithStateInProcess,
  processTestSuite,
  reaperTestSuite,
  schedulingTestSuite,
  chainsTestSuite,
  waitChainCompletionTestSuite,
  workerlessCompletionTestSuite,
  workerTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithObservabilityOtel } from "./observability-adapter.otel.spec-helper.js";

const otelIt = extendWithObservabilityOtel(
  extendWithNotifyInProcess(extendWithCommon(extendWithStateInProcess(it))),
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

describe("Chains", () => {
  chainsTestSuite({ it: otelIt });
});

describe("Blocker Chains", () => {
  blockerChainsTestSuite({ it: otelIt });
});

describe("Deduplication", () => {
  deduplicationTestSuite({ it: otelIt });
});

describe("Deletion", () => {
  deletionTestSuite({ it: otelIt });
});

describe("Wait Chain Completion", () => {
  waitChainCompletionTestSuite({ it: otelIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: otelIt });
});

describe("Scheduling", () => {
  schedulingTestSuite({ it: otelIt });
});
