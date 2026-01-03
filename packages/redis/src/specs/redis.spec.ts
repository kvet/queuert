import { type StateAdapter } from "@queuert/core";
import {
  blockerSequencesTestSuite,
  extendWithCommon,
  extendWithStateInProcess,
  notifyTestSuite,
  processTestSuite,
  reaperTestSuite,
  sequencesTestSuite,
  waitSequenceCompletionTestSuite,
  workerlessCompletionTestSuite,
  workerTestSuite,
} from "@queuert/core/testing";
import { describe, it, TestAPI } from "vitest";
import { extendWithRedisNotify } from "../notify-adapter/notify-adapter.redis.spec-helper.js";

const inProcessInProcessIt = extendWithRedisNotify(
  extendWithCommon(
    extendWithStateInProcess(it) as unknown as TestAPI<{
      stateAdapter: StateAdapter<{ $test: true }, string>;
      flakyStateAdapter: StateAdapter<{ $test: true }, string>;
    }>,
  ),
  import.meta.url,
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
